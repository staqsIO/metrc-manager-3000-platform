import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { logMetrcErr } from '@/services/metrc/metrc-errors';
import { calculateAgeDays, getAgeCategory } from '@/services/metrc/types';
import type { MetrcFacility, Prisma } from '@prisma/client';
import {
  getActivePackagesFromDb,
  getActiveLocationsFromDb,
  PACKAGE_SNAPSHOT_SELECT,
  snapshotToMetrcPackage,
} from '@/services/metrc/snapshot-utils';
import { getLongTermStorageLocations } from '@/shared/constants/aging-exclusions';
import {
  detectFIFOViolations,
  analyzeAgingDistribution,
  generateAgingRecommendations,
  detectSlowMoving,
} from '@/services/engines/fifo-engine';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import {
  checkPackageAdjustment,
  checkPackageFinish,
  checkPackageNoteChange,
  checkPackageRemediation,
} from '@/services/metrc/verification-checks';


const AGING_NOTE_DEFAULTS: Record<string, string> = {
  discount: 'Flagged: Discount - aging inventory',
  expedite_testing: 'Flagged: Expedite lab testing',
  fifo_priority: 'FIFO Priority - use first',
  remediate: 'Flagged: Remediation required',
};

export const inventoryRouter = createTRPCRouter({
  /**
   * Get all active packages for a facility, with computed age fields.
   */
  getActive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      category: z.string().optional(),
      ageCategory: z.enum(['fresh', 'normal', 'aging', 'critical']).optional(),
      sortBy: z.string().optional().default('PackagedDate'),
      sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(200).optional().default(50),
    }))
    .query(async ({ ctx, input }) => {
      // FOR-1485 Phase 1: DB-side pagination + filters + sort.
      //
      // Replaces in-memory load+filter+sort+slice over the full active set, which
      // hit ~25MB JSON wire transfer and minutes-long page loads on facilities with
      // 60K+ active packages.
      const facilityId = ctx.facility.id;

      const where: Prisma.PackageSnapshotWhereInput = {
        facilityId,
        isActive: true,
      };

      if (input.category) where.itemCategory = input.category;

      // ageCategory → packagedDate range. Buckets match `getAgingSummary`.
      // Also excludes long-term storage locations (seed banks, genetics) so a
      // user clicking "Critical (90d+)" sees actionable packages, not the
      // facility's permanent genetics library. Matches the bucket counts shown
      // in getAgingSummary.
      if (input.ageCategory) {
        const now = new Date();
        const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
        if (input.ageCategory === 'fresh') where.packagedDate = { gte: daysAgo(30) };
        else if (input.ageCategory === 'normal') where.packagedDate = { gte: daysAgo(60), lt: daysAgo(30) };
        else if (input.ageCategory === 'aging') where.packagedDate = { gte: daysAgo(90), lt: daysAgo(60) };
        else where.packagedDate = { lt: daysAgo(90) }; // critical

        const excludedLocations = await getLongTermStorageLocations(ctx.prisma, facilityId);
        if (excludedLocations.length > 0) where.locationName = { notIn: excludedLocations };
      }

      // Multi-word search: each word must appear in at least one searchable field
      // (translated to AND-of-OR ILIKE clauses Prisma maps to Postgres-side filtering).
      if (input.search) {
        const words = input.search.trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          where.AND = words.map((word) => ({
            OR: [
              { itemName: { contains: word, mode: 'insensitive' as const } },
              { packageLabel: { contains: word, mode: 'insensitive' as const } },
              { itemCategory: { contains: word, mode: 'insensitive' as const } },
              { itemStrainName: { contains: word, mode: 'insensitive' as const } },
              { locationName: { contains: word, mode: 'insensitive' as const } },
            ],
          }));
        }
      }

      // Map UI sortBy keys (PascalCase from MetrcPackage) → DB columns (camelCase Prisma).
      // Anything not in the map falls back to packagedDate to keep behavior stable.
      const sortFieldMap: Record<string, keyof Prisma.PackageSnapshotOrderByWithRelationInput> = {
        PackagedDate: 'packagedDate',
        ItemName: 'itemName',
        Quantity: 'quantity',
        Label: 'packageLabel',
        ItemCategory: 'itemCategory',
        ItemStrainName: 'itemStrainName',
        LocationName: 'locationName',
        ageDays: 'packagedDate', // ageDays is the inverse of packagedDate; flip dir below
      };
      const sortField = sortFieldMap[input.sortBy] ?? 'packagedDate';
      const sortDir = input.sortBy === 'ageDays'
        ? (input.sortDir === 'asc' ? 'desc' : 'asc')
        : input.sortDir;

      // Three queries in parallel: paged rows, total count, distinct category list.
      // Categories list is unfiltered by user search/category/age — it must reflect
      // every category present so the dropdown shows all options.
      const [snapshots, total, categoryGroups] = await Promise.all([
        ctx.prisma.packageSnapshot.findMany({
          where,
          orderBy: { [sortField]: sortDir },
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          select: PACKAGE_SNAPSHOT_SELECT,
        }),
        ctx.prisma.packageSnapshot.count({ where }),
        ctx.prisma.packageSnapshot.groupBy({
          by: ['itemCategory'],
          where: { facilityId, isActive: true },
        }),
      ]);

      const items = snapshots.map((s) => {
        const pkg = snapshotToMetrcPackage(s);
        const ageDays = calculateAgeDays(pkg.PackagedDate);
        return { ...pkg, ageDays, ageCategory: getAgeCategory(ageDays) };
      });

      const categories = categoryGroups
        .map((g) => g.itemCategory)
        .filter((c): c is string => !!c)
        .sort();

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
        categories,
      };
    }),

  /**
   * Get aging summary (bucket counts + totals) — uses COUNT queries, not full row loads.
   *
   * Excludes long-term storage locations (seed banks, genetics libraries,
   * mother stock, tissue culture) from the four aging buckets. `total` is the
   * raw active count and INCLUDES long-term storage so the headline "Active"
   * count stays honest. `excludedFromAging` is returned so the UI can show
   * "X packages in long-term storage excluded" if the discrepancy matters.
   */
  getAgingSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const now = new Date();
      const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
      const facilityId = ctx.facility.id;

      const excludedLocations = await getLongTermStorageLocations(ctx.prisma, facilityId);
      const baseAging: Prisma.PackageSnapshotWhereInput = {
        facilityId,
        isActive: true,
        ...(excludedLocations.length > 0 ? { locationName: { notIn: excludedLocations } } : {}),
      };

      // 4 parallel count queries using indexes — no row data loaded.
      // Bucket counts apply the long-term-storage exclusion; `total` does not.
      // `excludedFromAging` reports how many active packages were filtered out
      // so the UI can disclose the discrepancy.
      const [fresh, normal, aging, critical, total, excludedFromAging] = await Promise.all([
        ctx.prisma.packageSnapshot.count({ where: { ...baseAging, packagedDate: { gte: daysAgo(30) } } }),
        ctx.prisma.packageSnapshot.count({ where: { ...baseAging, packagedDate: { gte: daysAgo(60), lt: daysAgo(30) } } }),
        ctx.prisma.packageSnapshot.count({ where: { ...baseAging, packagedDate: { gte: daysAgo(90), lt: daysAgo(60) } } }),
        ctx.prisma.packageSnapshot.count({ where: { ...baseAging, packagedDate: { lt: daysAgo(90) } } }),
        ctx.prisma.packageSnapshot.count({ where: { facilityId, isActive: true } }),
        excludedLocations.length > 0
          ? ctx.prisma.packageSnapshot.count({
              where: { facilityId, isActive: true, locationName: { in: excludedLocations } },
            })
          : Promise.resolve(0),
      ]);

      return { fresh, normal, aging, critical, total, excludedFromAging };
    }),

  /**
   * Get lab testing summary counts for active packages — uses groupBy, not full row loads.
   */
  getLabTestingSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const groups = await ctx.prisma.packageSnapshot.groupBy({
        by: ['labTestingState'],
        where: { facilityId: ctx.facility.id, isActive: true },
        _count: true,
      });

      let passed = 0, failed = 0, pending = 0, submitted = 0, total = 0;
      for (const g of groups) {
        total += g._count;
        switch (g.labTestingState) {
          case 'TestPassed': passed = g._count; break;
          case 'TestFailed': failed = g._count; break;
          case 'NotSubmitted': pending = g._count; break;
          case 'SubmittedForTesting': submitted = g._count; break;
        }
      }

      return { passed, failed, pending, submitted, total };
    }),

  /**
   * Get a single package by ID
   */
  getPackage: facilityProcedure
    .input(z.object({ facilityId: z.string(), packageId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { snapshotToMetrcPackage } = await import('@/services/metrc/snapshot-utils');
      const snapshot = await ctx.prisma.packageSnapshot.findFirst({
        where: { facilityId: input.facilityId, metrcPackageId: input.packageId },
      });
      if (!snapshot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Package ${input.packageId} not found` });
      }
      const pkg = snapshotToMetrcPackage(snapshot);
      const ageDays = calculateAgeDays(pkg.PackagedDate);
      return { ...pkg, ageDays, ageCategory: getAgeCategory(ageDays) };
    }),

  /**
   * Get a single package by label string (used by package quick-peek modal)
   */
  getPackageByLabel: facilityProcedure
    .input(z.object({ facilityId: z.string(), packageLabel: z.string() }))
    .query(async ({ ctx, input }) => {
      const { snapshotToMetrcPackage } = await import('@/services/metrc/snapshot-utils');
      const snapshot = await ctx.prisma.packageSnapshot.findFirst({
        where: { facilityId: input.facilityId, packageLabel: input.packageLabel },
      });
      if (!snapshot) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      const pkg = snapshotToMetrcPackage(snapshot);
      const ageDays = calculateAgeDays(pkg.PackagedDate);
      return { ...pkg, ageDays, ageCategory: getAgeCategory(ageDays) };
    }),

  /**
   * Adjust packages (preview -> confirm -> execute with verification)
   */
  adjustPackages: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      adjustments: z.array(z.object({
        Label: z.string(),
        Quantity: z.number(),
        UnitOfMeasureName: z.string(),
        AdjustmentReason: z.string(),
      })),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      if (!input.confirmed) {
        // Preview: read from snapshot DB (same source as dashboard)
        const allPackages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
        const previews = [];
        for (const adj of input.adjustments) {
          const pkg = allPackages.find(p => p.Label === adj.Label);
          previews.push({
            Label: adj.Label,
            ItemName: pkg?.ItemName ?? 'Unknown',
            currentQuantity: pkg?.Quantity ?? 0,
            newQuantity: adj.Quantity,
            reason: adj.AdjustmentReason,
          });
        }

        const adjLabels = input.adjustments.map(a => a.Label);
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PACKAGE_ADJUST',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: adjLabels,
            targetCount: adjLabels.length,
            previewData: previews as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, previews };
      }

      // Execute: write client calls Metrc inline (mutations must reach Metrc in real time)
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState from live Metrc (write path)
      const allPkgs = await writeClient.getActivePackages();
      const execLabels = input.adjustments.map(a => a.Label);
      const targets = execLabels.map(label => allPkgs.find(p => p.Label === label)).filter(Boolean);
      const beforeState = targets.map(p => ({ Id: p!.Id, Label: p!.Label, Quantity: p!.Quantity, LastModified: p!.LastModified }));
      const expectedQuantities: Record<string, number> = {};
      for (const adj of input.adjustments) {
        expectedQuantities[adj.Label] = adj.Quantity;
      }

      // Metrc API expects Quantity as a delta, but input.adjustments.Quantity is the new absolute value.
      // Compute deltas for the API call.
      const adjustmentsWithDelta = input.adjustments.map(adj => {
        const current = allPkgs.find(p => p.Label === adj.Label);
        const delta = current ? adj.Quantity - current.Quantity : adj.Quantity;
        return {
          Label: adj.Label,
          Quantity: delta,
          UnitOfMeasureName: adj.UnitOfMeasureName,
          AdjustmentReason: adj.AdjustmentReason,
        };
      });

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PACKAGE_ADJUST',
        targetType: 'PACKAGE',
        targetIds: execLabels,
        targetCount: execLabels.length,
        executeFn: () => writeClient.adjustPackages(adjustmentsWithDelta as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const afterPkgs = await writeClient.getActivePackages();
          const afterTargets = afterPkgs.filter(p => execLabels.includes(p.Label));
          return checkPackageAdjustment(beforeState, afterTargets, expectedQuantities);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, count: input.adjustments.length, verified: result.verified };
    }),

  /**
   * Finish packages (with verification)
   */
  finishPackages: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      labels: z.array(z.string()),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      if (!input.confirmed) {
        // Preview: read from snapshot DB (same source as dashboard)
        const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
        const previews = input.labels.map(label => {
          const pkg = packages.find(p => p.Label === label);
          return {
            Label: label,
            ItemName: pkg?.ItemName ?? 'Unknown',
            Quantity: pkg?.Quantity ?? 0,
            action: 'finish',
          };
        });

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'PACKAGE_FINISH',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.labels,
            targetCount: input.labels.length,
            previewData: previews as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, previews };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState
      const allPkgs = await writeClient.getActivePackages();
      const beforeState = input.labels.map(label => {
        const pkg = allPkgs.find(p => p.Label === label);
        return { Label: label, Id: pkg?.Id, Quantity: pkg?.Quantity, LastModified: pkg?.LastModified };
      });

      const finishData = input.labels.map(label => ({ Label: label }));
      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'PACKAGE_FINISH',
        targetType: 'PACKAGE',
        targetIds: input.labels,
        targetCount: input.labels.length,
        executeFn: () => writeClient.finishPackages(finishData as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const activeAfter = await writeClient.getActivePackages();
          return checkPackageFinish(input.labels, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, count: input.labels.length, verified: result.verified };
    }),

  /**
   * Get action history for a facility
   */
  getActionHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(50).optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const [items, total] = await Promise.all([
        ctx.prisma.actionLog.findMany({
          where: { facilityId: input.facilityId },
          orderBy: { createdAt: 'desc' },
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
        }),
        ctx.prisma.actionLog.count({
          where: { facilityId: input.facilityId },
        }),
      ]);

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  /**
   * Execute an aging action (discount, sample_out, destroy, remediate, expedite_testing, fifo_priority)
   */
  executeAgingAction: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      actionType: z.enum(['discount', 'sample_out', 'destroy', 'remediate', 'expedite_testing', 'fifo_priority']),
      packageLabel: z.string(),
      confirmed: z.boolean().default(false),
      newQuantity: z.number().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      // Preview reads from snapshot DB; execution uses write client below
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const pkg = packages.find(p => p.Label === input.packageLabel);

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Package ${input.packageLabel} not found` });
      }

      // Build description of what the action will do
      const noteMap: Record<string, string> = {
        ...AGING_NOTE_DEFAULTS,
        fifo_priority: input.note ?? AGING_NOTE_DEFAULTS.fifo_priority!,
      };

      let description: string;
      switch (input.actionType) {
        case 'discount':
        case 'expedite_testing':
        case 'fifo_priority':
          description = `Change package note to: "${input.note ?? noteMap[input.actionType]}"`;
          break;
        case 'remediate':
          description = `Flag package for remediation`;
          break;
        case 'sample_out': {
          const qty = input.newQuantity ?? Math.round(pkg.Quantity * 0.9 * 100) / 100;
          description = `Adjust quantity from ${pkg.Quantity} to ${qty} ${pkg.UnitOfMeasureName} (sample out ${Math.round(pkg.Quantity - qty)} ${pkg.UnitOfMeasureName})`;
          break;
        }
        case 'destroy':
          description = `Finish/destroy package (remove from active inventory). This is irreversible.`;
          break;
      }

      if (!input.confirmed) {
        // Preview mode
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: `AGING_${input.actionType.toUpperCase()}`,
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: [input.packageLabel],
            targetCount: 1,
            previewData: {
              packageLabel: pkg.Label,
              itemName: pkg.ItemName,
              currentQuantity: pkg.Quantity,
              unitOfMeasure: pkg.UnitOfMeasureName,
              description,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'preview' as const,
          preview: {
            packageLabel: pkg.Label,
            itemName: pkg.ItemName,
            currentQuantity: pkg.Quantity,
            unitOfMeasure: pkg.UnitOfMeasureName,
            description,
          },
        };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Execute with verification
      const noteText = input.note ?? AGING_NOTE_DEFAULTS[input.actionType] ?? '';
      const beforeState = { Label: pkg.Label, Quantity: pkg.Quantity, Note: pkg.Note, ContainsRemediatedProduct: pkg.ContainsRemediatedProduct, LastModified: pkg.LastModified };

      const executeFn = async () => {
        switch (input.actionType) {
          case 'discount':
          case 'expedite_testing':
          case 'fifo_priority':
            await writeClient.changePackageNote([{ Label: pkg.Label, Note: noteText }]);
            break;
          case 'remediate':
            await writeClient.remediatePackages([{ Label: pkg.Label }]);
            break;
          case 'sample_out': {
            const newQty = input.newQuantity ?? Math.round(pkg.Quantity * 0.9 * 100) / 100;
            const delta = -(pkg.Quantity - newQty);
            await writeClient.adjustPackages([{
              Label: pkg.Label,
              Quantity: delta,
              UnitOfMeasure: pkg.UnitOfMeasureName,
              AdjustmentReason: 'Manager Sample for QC/Prod Dev',
            }]);
            break;
          }
          case 'destroy':
            await writeClient.finishPackages([{ Label: pkg.Label }]);
            break;
        }
      };

      const verifyFn = async () => {
        const afterPkgs = await writeClient.getActivePackages();
        switch (input.actionType) {
          case 'discount':
          case 'expedite_testing':
          case 'fifo_priority':
            return checkPackageNoteChange(
              [{ Label: pkg.Label, LastModified: pkg.LastModified }],
              afterPkgs.filter(p => p.Label === pkg.Label),
              { [pkg.Label]: noteText },
            );
          case 'remediate':
            return checkPackageRemediation(
              [{ Label: pkg.Label, LastModified: pkg.LastModified }],
              afterPkgs.filter(p => p.Label === pkg.Label),
            );
          case 'sample_out': {
            const expectedQty = input.newQuantity ?? Math.round(pkg.Quantity * 0.9 * 100) / 100;
            return checkPackageAdjustment(
              [{ Label: pkg.Label, Quantity: pkg.Quantity, LastModified: pkg.LastModified }],
              afterPkgs.filter(p => p.Label === pkg.Label),
              { [pkg.Label]: expectedQty },
            );
          }
          case 'destroy':
            return checkPackageFinish([pkg.Label], afterPkgs);
        }
      };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: `AGING_${input.actionType.toUpperCase()}`,
        targetType: 'PACKAGE',
        targetIds: [input.packageLabel],
        targetCount: 1,
        executeFn,
        beforeState,
        verifyFn,
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified };
    }),

  /**
   * Get mutation history for a specific package (ActionLog entries referencing its label)
   */
  getPackageHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabel: z.string().min(1).max(50),
      limit: z.number().min(1).max(50).optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.actionLog.findMany({
        where: {
          facilityId: input.facilityId,
          targetIds: { has: input.packageLabel },
        },
        select: {
          id: true,
          actionType: true,
          status: true,
          targetCount: true,
          executedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),

  /**
   * Detect FIFO violations (newer packages pulled before older)
   */
  fifoViolations: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const violations = detectFIFOViolations(packages);

      return {
        violations,
        totalViolations: violations.length,
        worstDaysDifference: violations.length > 0 ? violations[0].daysDifference : 0,
      };
    }),

  /**
   * Full aging distribution analysis
   */
  agingDistribution: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      return analyzeAgingDistribution(packages);
    }),

  /**
   * Aging recommendations (discount, sample-out, destroy, etc.)
   */
  agingRecommendations: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const recommendations = generateAgingRecommendations(packages);

      const byType = {
        discount: recommendations.filter(r => r.type === 'discount').length,
        sample_out: recommendations.filter(r => r.type === 'sample_out').length,
        destroy: recommendations.filter(r => r.type === 'destroy').length,
        remediate: recommendations.filter(r => r.type === 'remediate').length,
        expedite_testing: recommendations.filter(r => r.type === 'expedite_testing').length,
      };

      return {
        recommendations,
        totalRecommendations: recommendations.length,
        byType,
      };
    }),

  /**
   * Bulk execute aging actions (discount, sample_out, destroy, remediate, expedite_testing, fifo_priority)
   * Groups actions by type and batches Metrc API calls for efficiency.
   */
  bulkExecuteAgingAction: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      actions: z.array(z.object({
        actionType: z.enum(['discount', 'sample_out', 'destroy', 'remediate', 'expedite_testing', 'fifo_priority']),
        packageLabel: z.string(),
        note: z.string().optional(),
        newQuantity: z.number().positive().optional(),
      })).min(1).max(100),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      // Preview reads from snapshot DB; execution uses write client below
      const allPackages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);

      // Build lookup map
      const pkgMap = new Map(allPackages.map(p => [p.Label, p]));

      // Validate all packages exist
      const missing = input.actions.filter(a => !pkgMap.has(a.packageLabel));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Packages not found: ${missing.map(m => m.packageLabel).join(', ')}`,
        });
      }

      // Group actions by type
      const groups: Record<string, typeof input.actions> = {};
      for (const action of input.actions) {
        if (!groups[action.actionType]) groups[action.actionType] = [];
        groups[action.actionType]!.push(action);
      }

      const allLabels = input.actions.map(a => a.packageLabel);

      if (!input.confirmed) {
        // Preview mode
        const summary = Object.entries(groups).map(([type, actions]) => ({
          actionType: type,
          count: actions.length,
          packages: actions.map(a => {
            const pkg = pkgMap.get(a.packageLabel)!;
            return {
              label: a.packageLabel,
              itemName: pkg.ItemName,
              quantity: pkg.Quantity,
              unitOfMeasure: pkg.UnitOfMeasureName,
            };
          }),
        }));

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'AGING_BULK',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: allLabels,
            targetCount: allLabels.length,
            previewData: summary as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, summary };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState for all affected packages
      const beforeState = allLabels.map(label => {
        const pkg = pkgMap.get(label)!;
        return { Label: pkg.Label, Quantity: pkg.Quantity, Note: pkg.Note, ContainsRemediatedProduct: pkg.ContainsRemediatedProduct, LastModified: pkg.LastModified };
      });

      // Execute — batch by action type with partial-failure tracking
      const results: { type: string; status: 'success' | 'error'; count: number; error?: string }[] = [];

      for (const [type, actions] of Object.entries(groups)) {
        try {
          switch (type) {
            case 'discount':
            case 'expedite_testing':
            case 'fifo_priority':
              await writeClient.changePackageNote(
                actions.map(a => ({
                  Label: a.packageLabel,
                  Note: a.note ?? AGING_NOTE_DEFAULTS[type] ?? '',
                }))
              );
              break;
            case 'remediate':
              await writeClient.remediatePackages(
                actions.map(a => ({ Label: a.packageLabel }))
              );
              break;
            case 'sample_out':
              await writeClient.adjustPackages(
                actions.map(a => {
                  const pkg = pkgMap.get(a.packageLabel)!;
                  const newQty = a.newQuantity ?? Math.round(pkg.Quantity * 0.9 * 100) / 100;
                  const delta = -(pkg.Quantity - newQty);
                  return {
                    Label: a.packageLabel,
                    Quantity: delta,
                    UnitOfMeasure: pkg.UnitOfMeasureName,
                    AdjustmentReason: 'Manager Sample for QC/Prod Dev',
                  };
                }) as unknown as Record<string, unknown>[]
              );
              break;
            case 'destroy':
              await writeClient.finishPackages(
                actions.map(a => ({ Label: a.packageLabel })) as unknown as Record<string, unknown>[]
              );
              break;
          }
          results.push({ type, status: 'success', count: actions.length });
        } catch (err) {
          results.push({ type, status: 'error', count: actions.length, error: (err as Error).message });
        }
      }

      const allSucceeded = results.every(r => r.status === 'success');
      const anySucceeded = results.some(r => r.status === 'success');

      // Create ActionLog with beforeState
      const actionLog = await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'AGING_BULK',
          status: allSucceeded ? 'COMPLETED' : anySucceeded ? 'PARTIALLY_COMPLETED' : 'FAILED',
          targetType: 'PACKAGE',
          targetIds: allLabels,
          targetCount: allLabels.length,
          executedAt: new Date(),
          beforeState: beforeState as unknown as Prisma.InputJsonValue,
          previewData: results as unknown as Prisma.InputJsonValue,
          errorMessage: !allSucceeded
            ? results.filter(r => r.status === 'error').map(f => `${f.type}: ${f.error}`).join('; ')
            : undefined,
        },
      });

      // Bulk verification — verify successful groups (even on partial failure)
      const successfulTypes = new Set(results.filter(r => r.status === 'success').map(r => r.type));
      if (successfulTypes.size > 0) {
        try {
          const afterPkgs = await writeClient.getActivePackages();
          const afterMap = new Map(afterPkgs.map(p => [p.Label, p]));
          const allDiscrepancies: Array<{ entityId: string; field: string; expected: string; actual: string }> = [];

          for (const [type, actions] of Object.entries(groups)) {
            if (!successfulTypes.has(type)) continue; // Skip failed groups
            const labels = actions.map(a => a.packageLabel);
            switch (type) {
              case 'discount':
              case 'expedite_testing':
              case 'fifo_priority': {
                const expectedNotes: Record<string, string> = {};
                for (const a of actions) {
                  expectedNotes[a.packageLabel] = a.note ?? AGING_NOTE_DEFAULTS[type] ?? '';
                }
                const check = checkPackageNoteChange(
                  labels.map(l => ({ Label: l, LastModified: pkgMap.get(l)!.LastModified })),
                  labels.map(l => afterMap.get(l)).filter(Boolean) as typeof afterPkgs,
                  expectedNotes,
                );
                allDiscrepancies.push(...check.discrepancies);
                break;
              }
              case 'remediate': {
                const check = checkPackageRemediation(
                  labels.map(l => ({ Label: l, LastModified: pkgMap.get(l)!.LastModified })),
                  labels.map(l => afterMap.get(l)).filter(Boolean) as typeof afterPkgs,
                );
                allDiscrepancies.push(...check.discrepancies);
                break;
              }
              case 'sample_out': {
                const expectedQtys: Record<string, number> = {};
                for (const a of actions) {
                  const p = pkgMap.get(a.packageLabel)!;
                  expectedQtys[a.packageLabel] = a.newQuantity ?? Math.round(p.Quantity * 0.9 * 100) / 100;
                }
                const check = checkPackageAdjustment(
                  labels.map(l => ({ Label: l, Quantity: pkgMap.get(l)!.Quantity, LastModified: pkgMap.get(l)!.LastModified })),
                  labels.map(l => afterMap.get(l)).filter(Boolean) as typeof afterPkgs,
                  expectedQtys,
                );
                allDiscrepancies.push(...check.discrepancies);
                break;
              }
              case 'destroy': {
                const check = checkPackageFinish(labels, afterPkgs);
                allDiscrepancies.push(...check.discrepancies);
                break;
              }
            }
          }

          const verified = allDiscrepancies.length === 0;
          const verificationStatus = allSucceeded
            ? (verified ? 'VERIFIED' : 'UNVERIFIED')
            : 'PARTIALLY_COMPLETED'; // Keep partial status but add verification metadata
          await ctx.prisma.actionLog.update({
            where: { id: actionLog.id },
            data: {
              status: verificationStatus,
              afterState: allDiscrepancies.length > 0
                ? { discrepancies: allDiscrepancies } as unknown as Prisma.InputJsonValue
                : undefined,
              metadata: {
                verifiedAt: new Date().toISOString(),
                successfulGroupsVerified: verified,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        } catch {
          // Verification failed — mark UNVERIFIED, don't throw
          await ctx.prisma.actionLog.update({
            where: { id: actionLog.id },
            data: {
              status: allSucceeded ? 'UNVERIFIED' : 'PARTIALLY_COMPLETED',
              metadata: { verificationError: 'Verification read failed', verifiedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      if (!allSucceeded) {
        const failed = results.filter(r => r.status === 'error');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Partial failure: ${failed.map(f => `${f.type} (${f.error})`).join('; ')}. Successful batches have been applied.`,
        });
      }

      // Read actual verification status from the ActionLog (may have been updated by verification above)
      const finalLog = await ctx.prisma.actionLog.findUnique({ where: { id: actionLog.id }, select: { status: true } });
      const bulkVerified = finalLog?.status === 'VERIFIED';
      return { status: 'completed' as const, count: input.actions.length, verified: bulkVerified };
    }),

  /**
   * Manual reconciliation: re-verify recent ActionLogs against current Metrc state.
   */
  verifyRecentActions: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      hoursBack: z.number().min(1).max(168).optional().default(24),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verification must hit live Metrc for authoritative state
      const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const since = new Date(Date.now() - input.hoursBack * 60 * 60 * 1000);

      // Query recent actionlogs that need verification
      const logs = await ctx.prisma.actionLog.findMany({
        where: {
          facilityId: input.facilityId,
          status: { in: ['COMPLETED', 'UNVERIFIED'] },
          executedAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      if (logs.length === 0) {
        return { total: 0, verified: 0, unverified: 0, failed: 0 };
      }

      // Fetch current state (one bulk read per entity type)
      const hasPackages = logs.some(l => l.targetType === 'PACKAGE');
      const hasHarvests = logs.some(l => l.targetType === 'HARVEST');
      const hasPlantBatches = logs.some(l => l.targetType === 'PLANT_BATCH');

      const [activePkgs, activeHarvests, activeBatches] = await Promise.all([
        hasPackages ? client.getActivePackages().catch(logMetrcErr('inventory', 'getActivePackages')) : Promise.resolve([]),
        hasHarvests ? client.getActiveHarvests().catch(logMetrcErr('inventory', 'getActiveHarvests')) : Promise.resolve([]),
        hasPlantBatches ? client.getActivePlantBatches().catch(logMetrcErr('inventory', 'getActivePlantBatches')) : Promise.resolve([]),
      ]);

      const pkgMap = new Map(activePkgs.map(p => [p.Label, p]));
      const harvestMap = new Map(activeHarvests.map(h => [h.Id, h]));
      const batchMap = new Map(activeBatches.map(b => [b.Id, b]));

      let verified = 0;
      let unverified = 0;
      let failed = 0;

      for (const log of logs) {
        try {
          // For PACKAGE finish actions: verify packages are no longer active
          if (log.actionType.includes('FINISH') && log.targetType === 'PACKAGE') {
            const stillActive = log.targetIds.filter(label => pkgMap.has(label));
            const isVerified = stillActive.length === 0;
            await ctx.prisma.actionLog.update({
              where: { id: log.id },
              data: {
                status: isVerified ? 'VERIFIED' : 'UNVERIFIED',
                metadata: { reconciledAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
              },
            });
            if (isVerified) { verified++; } else { unverified++; }
            continue;
          }

          // For HARVEST finish: verify harvest has FinishedDate
          if (log.actionType === 'HARVEST_FINISH') {
            const ids = log.targetIds.map(Number).filter(n => !isNaN(n));
            if (ids.length === 0) { unverified++; continue; }
            const allFinished = ids.every(id => {
              const h = harvestMap.get(id);
              return !h || !!h.FinishedDate; // not in active or has FinishedDate
            });
            await ctx.prisma.actionLog.update({
              where: { id: log.id },
              data: {
                status: allFinished ? 'VERIFIED' : 'UNVERIFIED',
                metadata: { reconciledAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
              },
            });
            if (allFinished) { verified++; } else { unverified++; }
            continue;
          }

          // For PLANTBATCH destroy: verify count decreased
          if (log.actionType === 'PLANTBATCH_DESTROY' && log.beforeState) {
            const before = log.beforeState as { Count?: number };
            const id = Number(log.targetIds[0]);
            const batch = batchMap.get(id);
            const isVerified = !batch || (before.Count !== undefined && batch.Count < before.Count);
            await ctx.prisma.actionLog.update({
              where: { id: log.id },
              data: {
                status: isVerified ? 'VERIFIED' : 'UNVERIFIED',
                metadata: { reconciledAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
              },
            });
            if (isVerified) { verified++; } else { unverified++; }
            continue;
          }

          // For PACKAGE adjustments/notes/remediation: check LastModified changed
          if (log.targetType === 'PACKAGE' && log.beforeState) {
            // beforeState may be a single object (from executeAgingAction) or an array (from bulk actions)
            const raw = log.beforeState as Record<string, unknown> | Array<Record<string, unknown>>;
            const beforeArr = Array.isArray(raw)
              ? (raw as Array<{ Label: string; LastModified?: string }>)
              : [raw as { Label: string; LastModified?: string }];
            if (beforeArr.length === 0 || !beforeArr[0]?.Label) {
              unverified++;
              continue;
            }
            const allModified = beforeArr.every(b => {
              const after = pkgMap.get(b.Label);
              return !after || !b.LastModified || after.LastModified !== b.LastModified;
            });
            await ctx.prisma.actionLog.update({
              where: { id: log.id },
              data: {
                status: allModified ? 'VERIFIED' : 'UNVERIFIED',
                metadata: { reconciledAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
              },
            });
            if (allModified) { verified++; } else { unverified++; }
            continue;
          }

          // No beforeState — can only mark as verified if targets show signs of modification
          // For safety, leave status as-is
          unverified++;
        } catch {
          failed++;
        }
      }

      return { total: logs.length, verified, unverified, failed };
    }),

  /**
   * Slow-moving inventory detection
   */
  slowMoving: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      slowDays: z.number().optional(),
      stagnantDays: z.number().optional(),
      deadDays: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const results = detectSlowMoving(packages, {
        slow: input.slowDays ?? 45,
        stagnant: input.stagnantDays ?? 75,
        dead: input.deadDays ?? 120,
      });

      const byTier = {
        slow: results.filter(r => r.tier === 'slow').length,
        stagnant: results.filter(r => r.tier === 'stagnant').length,
        dead: results.filter(r => r.tier === 'dead').length,
      };

      return {
        packages: results,
        totalSlowMoving: results.length,
        byTier,
      };
    }),

  /**
   * Get active locations for a facility (lightweight, for dropdowns).
   */
  getLocations: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      // Snapshot-first: read from LocationSnapshot DB — zero Metrc API calls.
      return getActiveLocationsFromDb(ctx.prisma, ctx.facility.id);
    }),

  /**
   * Diagnostic: search across active, inactive, and on-hold package endpoints.
   * Uses raw GET to hit endpoints the client library doesn't expose.
   * Helps locate packages that disappeared from the active view.
   */
  diagnosePackages: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      const { MetrcClient } = await import('@metrc-formul8-os/client');
      const { patchClientForV2 } = await import('@/services/metrc/metrc-v2-client');
      const { decrypt } = await import('@/lib/encryption');

      const environment = facility.metrcEnvironment as 'sandbox' | 'production';
      if (environment !== 'sandbox' && environment !== 'production') {
        return { error: 'Diagnostics only available for sandbox/production' };
      }

      const encVendor = environment === 'sandbox'
        ? facility.encryptedSandboxVendorApiKey
        : facility.encryptedVendorApiKey;
      const encUser = environment === 'sandbox'
        ? facility.encryptedSandboxUserApiKey
        : facility.encryptedUserApiKey;

      if (!encVendor || !encUser) {
        return { error: 'Missing API credentials' };
      }

      const rawClient = patchClientForV2(new MetrcClient({
        stateCode: facility.stateCode,
        licenseNumber: facility.licenseNumber,
        vendorApiKey: decrypt(encVendor),
        userApiKey: decrypt(encUser),
        environment,
        authMethod: 'basic',
        debug: true,
      }));

      // Cast to access the raw get method
      const c = rawClient as unknown as { get: (endpoint: string, params?: Record<string, string>) => Promise<unknown> };

      const searchLower = input.search?.toLowerCase() ?? '';

      type PkgSummary = {
        Id: number;
        Label: string;
        ItemName: string;
        ItemCategory: string;
        Quantity: number;
        UnitOfMeasureName: string;
        PackageStatus: string;
        LastModified: string;
      };

      const summarize = (raw: unknown): PkgSummary[] => {
        if (!Array.isArray(raw)) return [];
        return raw.map((p: Record<string, unknown>) => ({
          Id: p.Id as number,
          Label: (p.Label as string) ?? '',
          ItemName: (p.ItemName ?? (p.Item as Record<string, unknown>)?.Name ?? '') as string,
          ItemCategory: (p.ItemCategory ?? (p.Item as Record<string, unknown>)?.ProductCategoryName ?? '') as string,
          Quantity: (p.Quantity as number) ?? 0,
          UnitOfMeasureName: (p.UnitOfMeasureName ?? (p.Item as Record<string, unknown>)?.UnitOfMeasureName ?? '') as string,
          PackageStatus: (p.PackageType as string) ?? 'Unknown',
          LastModified: (p.LastModified as string) ?? '',
        }));
      };

      const filter = (pkgs: PkgSummary[]): PkgSummary[] => {
        if (!searchLower) return pkgs;
        return pkgs.filter(p =>
          p.ItemName.toLowerCase().includes(searchLower) ||
          p.Label.toLowerCase().includes(searchLower) ||
          p.ItemCategory.toLowerCase().includes(searchLower)
        );
      };

      const results: Record<string, unknown> = {
        facilityId: facility.id,
        facilityName: facility.name,
        environment,
        search: input.search ?? '(none)',
        timestamp: new Date().toISOString(),
      };

      // Hit all three package status endpoints
      for (const [label, endpoint] of [
        ['active', '/packages/v1/active'],
        ['inactive', '/packages/v1/inactive'],
        ['onhold', '/packages/v1/onhold'],
      ] as const) {
        try {
          const raw = await c.get(endpoint);
          const all = summarize(raw);
          const matched = filter(all);
          results[label] = {
            totalCount: all.length,
            matchedCount: matched.length,
            matched: matched.slice(0, 50), // cap at 50 to avoid huge responses
          };
        } catch (err: unknown) {
          results[label] = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      console.log('[inventory:diagnosePackages]', JSON.stringify(results, null, 2));
      return results;
    }),

  /**
   * Broad diagnostic: probe ALL Metrc endpoint types to see what has data.
   * Helps diagnose credential/permission issues vs genuine empty data.
   */
  diagnoseFacility: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;

      const { MetrcClient } = await import('@metrc-formul8-os/client');
      const { patchClientForV2 } = await import('@/services/metrc/metrc-v2-client');
      const { decrypt } = await import('@/lib/encryption');

      const environment = facility.metrcEnvironment as 'sandbox' | 'production';
      if (environment !== 'sandbox' && environment !== 'production') {
        return { error: 'Diagnostics only available for sandbox/production' };
      }

      const encVendor = environment === 'sandbox'
        ? facility.encryptedSandboxVendorApiKey
        : facility.encryptedVendorApiKey;
      const encUser = environment === 'sandbox'
        ? facility.encryptedSandboxUserApiKey
        : facility.encryptedUserApiKey;

      if (!encVendor || !encUser) {
        return { error: 'Missing API credentials' };
      }

      const rawClient = patchClientForV2(new MetrcClient({
        stateCode: facility.stateCode,
        licenseNumber: facility.licenseNumber,
        vendorApiKey: decrypt(encVendor),
        userApiKey: decrypt(encUser),
        environment,
        authMethod: 'basic',
      }));

      const c = rawClient as unknown as { get: (endpoint: string) => Promise<unknown> };

      const countArray = (raw: unknown): number =>
        Array.isArray(raw) ? raw.length : 0;

      const probe = async (label: string, endpoint: string): Promise<{ label: string; count: number; error?: string; sample?: unknown }> => {
        try {
          const raw = await c.get(endpoint);
          const count = countArray(raw);
          return {
            label,
            count,
            sample: Array.isArray(raw) && raw.length > 0 ? raw[0] : undefined,
          };
        } catch (err: unknown) {
          return { label, count: -1, error: err instanceof Error ? err.message : String(err) };
        }
      };

      // Probe all endpoint types in parallel
      const probes = await Promise.allSettled([
        probe('active_packages', '/packages/v1/active'),
        probe('inactive_packages', '/packages/v1/inactive'),
        probe('onhold_packages', '/packages/v1/onhold'),
        probe('outgoing_transfers', '/transfers/v1/outgoing'),
        probe('incoming_transfers', '/transfers/v1/incoming'),
        probe('rejected_transfers', '/transfers/v1/rejected'),
        probe('active_locations', '/facilities/v1/locations'),
        probe('lab_test_states', '/labtests/v1/states'),
        probe('items', '/items/v1/active'),
      ]);

      const results: Record<string, unknown> = {
        facilityId: facility.id,
        facilityName: facility.name,
        licenseNumber: facility.licenseNumber,
        stateCode: facility.stateCode,
        facilityType: facility.facilityType,
        environment,
        timestamp: new Date().toISOString(),
        endpoints: probes.map(r =>
          r.status === 'fulfilled' ? r.value : { label: 'unknown', count: -1, error: 'Promise rejected' }
        ),
      };

      console.log('[inventory:diagnoseFacility]', JSON.stringify(results, null, 2));
      return results;
    }),

  /**
   * Get packages by status (active, inactive, or onhold).
   * Active delegates to the cached client; inactive/onhold use raw GET.
   */
  getByStatus: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.enum(['active', 'inactive', 'onhold']).default('active'),
      search: z.string().optional(),
      category: z.string().optional(),
      location: z.string().optional(),
      ageCategory: z.enum(['fresh', 'normal', 'aging', 'critical']).optional(),
      sortBy: z.string().optional().default('PackagedDate'),
      sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(200).optional().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const { snapshotToMetrcPackage } = await import('@/services/metrc/snapshot-utils');

      // Phase 1: read ALL statuses from PackageSnapshot DB.
      // Active packages have isActive=true, inactive have isActive=false.
      // On-hold packages have isOnHold=true (can be active or inactive).
      const isActiveFilter = input.status === 'active' ? true
        : input.status === 'inactive' ? false
        : undefined; // onhold: any isActive value
      const isOnHoldFilter = input.status === 'onhold' ? true : undefined;

      const snapshots = await ctx.prisma.packageSnapshot.findMany({
        where: {
          facilityId: input.facilityId,
          ...(isActiveFilter !== undefined ? { isActive: isActiveFilter } : {}),
          ...(isOnHoldFilter !== undefined ? { isOnHold: isOnHoldFilter } : {}),
        },
      });

      const allMapped = snapshots.map(snapshotToMetrcPackage);

      let packages = allMapped.map(pkg => {
        const ageDays = calculateAgeDays(pkg.PackagedDate);
        return { ...pkg, ageDays, ageCategory: getAgeCategory(ageDays) };
      });

      // Collect categories and locations before filtering
      const allCategories = Array.from(new Set(packages.map(p => p.ItemCategory).filter(Boolean))).sort();
      const allLocations = Array.from(new Set(packages.map(p => p.LocationName).filter(Boolean))).sort();

      if (input.search) {
        const { normSearch, multiWordMatch } = await import('@/shared/utils/search');
        const searchNorm = normSearch(input.search);
        packages = packages.filter(pkg =>
          multiWordMatch([
            normSearch(pkg.ItemName),
            normSearch(pkg.Label),
            normSearch(pkg.ItemCategory ?? ''),
            normSearch(pkg.ItemStrainName ?? ''),
            normSearch(pkg.LocationName ?? ''),
          ], searchNorm)
        );
      }

      if (input.category) {
        packages = packages.filter(pkg => pkg.ItemCategory === input.category);
      }

      if (input.location) {
        packages = packages.filter(pkg => pkg.LocationName === input.location);
      }

      if (input.ageCategory) {
        packages = packages.filter(pkg => pkg.ageCategory === input.ageCategory);
      }

      // Sort
      const sortKey = input.sortBy as keyof typeof packages[0];
      packages.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return input.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal);
        const bStr = String(bVal);
        return input.sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      });

      const total = packages.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = packages.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages, categories: allCategories, locations: allLocations };
    }),

  /**
   * Lightweight status counts for tab badges — single groupBy query instead of 3 counts.
   */
  getStatusCounts: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const groups = await ctx.prisma.packageSnapshot.groupBy({
        by: ['isActive', 'isOnHold'],
        where: { facilityId: input.facilityId },
        _count: true,
      });

      let active = 0, inactive = 0, onhold = 0;
      for (const g of groups) {
        if (g.isOnHold) onhold += g._count;
        if (g.isActive) active += g._count;
        else inactive += g._count;
      }

      return { active, inactive, onhold };
    }),

  /**
   * Manually trigger a package sync from Metrc → DB. Operators use this when
   * they want fresh data without waiting for the nightly cron. Same logic as
   * /api/cron/package-sync but for one facility on-demand.
   */
  refreshFromMetrc: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const { syncFacilityPackages } = await import('@/pages/api/cron/package-sync');
      const result = await syncFacilityPackages(facility);
      return result;
    }),

  /**
   * Get the last sync time for the active packages snapshot, so the UI can
   * show "Last synced X minutes ago" next to the Refresh button.
   */
  getPackageSyncStatus: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const watermark = await ctx.prisma.syncWatermark.findUnique({
        where: { facilityId_endpoint: { facilityId: input.facilityId, endpoint: 'packages.active' } },
      });
      const count = await ctx.prisma.packageSnapshot.count({
        where: { facilityId: input.facilityId, isActive: true },
      });
      return {
        lastSyncAt: watermark?.lastRunAt ?? null,
        lastStatus: watermark?.lastRunStatus ?? null,
        activePackageCount: count,
      };
    }),
});
