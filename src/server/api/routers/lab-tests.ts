import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { formatPackage } from '@/services/metrc/types';
import type { MetrcFacility, Prisma } from '@prisma/client';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkLabTestRecord, checkSubmitForTesting } from '@/services/metrc/verification-checks';
import { assessTestingRisk } from '@/services/engines/testing-risk-engine';
import { getActivePackagesFromDb, getLabTestResultsFromDb } from '@/services/metrc/snapshot-utils';

/**
 * Lab Tests router — surfaces lab testing state from packages.
 *
 * In Metrc, lab test status lives on packages (LabTestingState field).
 * This router provides filtered views and summary analytics for lab testing.
 */
export const labTestsRouter = createTRPCRouter({
  /**
   * Get packages with lab test information, filterable by status.
   */
  getResults: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      let packages = allPackages.map(formatPackage);

      if (input.status) {
        packages = packages.filter(p => p.labTestingState === input.status);
      }

      if (input.search) {
        const s = input.search.toLowerCase();
        packages = packages.filter(p =>
          p.label.toLowerCase().includes(s) ||
          p.item.toLowerCase().includes(s) ||
          p.strainName?.toLowerCase().includes(s)
        );
      }

      const total = packages.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = packages.slice(start, start + input.pageSize);

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
    }),

  /**
   * Get lab testing summary stats for a facility.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      let passedCount = 0;
      let failedCount = 0;
      let pendingCount = 0;
      let submittedCount = 0;

      for (const pkg of allPackages) {
        switch (pkg.LabTestingState) {
          case 'TestPassed': passedCount++; break;
          case 'TestFailed': failedCount++; break;
          case 'NotSubmitted': pendingCount++; break;
          case 'SubmittedForTesting': submittedCount++; break;
        }
      }

      return {
        totalCount: allPackages.length,
        passedCount,
        failedCount,
        pendingCount,
        submittedCount,
      };
    }),

  /**
   * Assess testing risk for packages awaiting lab testing.
   * Correlates historical pass/fail rates by strain and test type
   * to identify packages most likely to fail.
   */
  getTestingRisk: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [allPackages, labTests] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getLabTestResultsFromDb(ctx.prisma, input.facilityId),
      ]);

      return assessTestingRisk(labTests, allPackages);
    }),

  /**
   * Record lab test results for a package (preview -> confirm -> execute)
   */
  recordResults: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabel: z.string(),
      resultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      overallPassed: z.boolean(),
      results: z.array(z.object({
        labTestTypeName: z.string().min(1).max(200),
        quantity: z.number().nonnegative(),
        passed: z.boolean(),
        notes: z.string().max(500).optional(),
      })).min(1),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const allPackages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const pkg = allPackages.find(p => p.Label === input.packageLabel);
      if (!pkg) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Package "${input.packageLabel}" not found in active packages`,
        });
      }

      if (!input.confirmed) {
        const preview = {
          packageLabel: pkg.Label,
          itemName: pkg.ItemName,
          currentLabState: pkg.LabTestingState,
          resultDate: input.resultDate,
          overallPassed: input.overallPassed,
          testCount: input.results.length,
          results: input.results,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'LAB_TEST_RECORD',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: [input.packageLabel],
            targetCount: 1,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      const beforeState = {
        packageLabel: pkg.Label,
        labTestingState: pkg.LabTestingState,
      };

      const payload = [{
        PackageLabel: input.packageLabel,
        ResultDate: input.resultDate,
        OverallPassed: input.overallPassed,
        Results: input.results.map(r => ({
          LabTestTypeName: r.labTestTypeName,
          Quantity: r.quantity,
          Passed: r.passed,
          Notes: r.notes ?? '',
        })),
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'LAB_TEST_RECORD',
        targetType: 'PACKAGE',
        targetIds: [input.packageLabel],
        targetCount: 1,
        executeFn: () => client.recordLabTests(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const activeAfter = await client.getActivePackages();
          return checkLabTestRecord(input.packageLabel, input.overallPassed, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified };
    }),

  /**
   * Submit packages for lab testing (preview -> confirm -> execute).
   * Calls POST /packages/v2/testing to create a lab sample and transition
   * the source package to SubmittedForTesting state.
   * Required for MA packages before they can be transferred.
   */
  submitForTesting: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      packageLabels: z.array(z.string()).min(1).max(50),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const allPackages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const targetPackages = allPackages.filter(p => input.packageLabels.includes(p.Label));

      if (targetPackages.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'None of the provided labels match active packages',
        });
      }

      const missingLabels = input.packageLabels.filter(l => !targetPackages.some(p => p.Label === l));

      if (!input.confirmed) {
        const preview = {
          packages: targetPackages.map(p => ({
            label: p.Label,
            itemName: p.ItemName,
            quantity: p.Quantity,
            unit: p.UnitOfMeasureName,
            currentLabState: p.LabTestingState,
          })),
          missingLabels,
          count: targetPackages.length,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'SUBMIT_FOR_TESTING',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: targetPackages.map(p => p.Label),
            targetCount: targetPackages.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Fetch available tags for the sample packages
      const availableTags = await client.getAvailableTags();
      if (availableTags.length < targetPackages.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Not enough available tags (${availableTags.length}) for ${targetPackages.length} packages`,
        });
      }

      const today = new Date().toISOString().split('T')[0];
      const payload = targetPackages.map((pkg, i) => ({
        Tag: availableTags[i]!.Label,
        Location: null,
        Item: pkg.ItemName,
        Quantity: pkg.UnitOfMeasureName === 'Each' ? 1 : 1.0,
        UnitOfMeasure: pkg.UnitOfMeasureName,
        PackagedDate: today,
        IsProductionBatch: false,
        ProductionBatchNumber: null,
        ProductRequiresRemediation: false,
        SourcePackageLabels: pkg.Label,
        Note: '',
      }));

      const beforeState = targetPackages.map(p => ({
        label: p.Label,
        labTestingState: p.LabTestingState,
      }));

      const labels = targetPackages.map(p => p.Label);

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'SUBMIT_FOR_TESTING',
        targetType: 'PACKAGE',
        targetIds: labels,
        targetCount: labels.length,
        executeFn: () => client.submitPackagesForTesting(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const activeAfter = await client.getActivePackages();
          return checkSubmitForTesting(labels, activeAfter);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, verified: result.verified, count: labels.length };
    }),
});
