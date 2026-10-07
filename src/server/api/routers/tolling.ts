import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { calculateTolling, compareProcessors, calculateFees, comparePartners, findBreakevenYield, analyzeYieldVariance } from '@/services/engines/tolling-engine';
import type { FeeDefinition } from '@/services/engines/tolling-engine';
import { generateReconciliationStatement, reconciliationToCSV } from '@/services/engines/tolling-reconciliation-engine';
import { buildProvenanceIndex } from '@/services/engines/provenance-engine';
import { computeBatchLifecycle } from '@/services/engines/tolling-lifecycle-engine';
import { getActivePackagesFromDb, getAllHarvestsFromDb } from '@/services/metrc/snapshot-utils';
import type { Prisma, PrismaClient } from '@prisma/client';

export const tollingRouter = createTRPCRouter({
  calculate: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      inputWeight: z.number(),
      outputWeight: z.number(),
      processingFee: z.number(),
    }))
    .mutation(({ input }) => {
      return calculateTolling(input.inputWeight, input.outputWeight, input.processingFee);
    }),

  compare: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      processors: z.array(z.object({
        partnerName: z.string(),
        inputWeight: z.number(),
        outputWeight: z.number(),
        processingFee: z.number(),
      })),
    }))
    .mutation(({ input }) => {
      return compareProcessors(input.processors);
    }),

  listAgreements: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      pageSize: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.TollingAgreementWhereInput = { facilityId: input.facilityId };
      if (input.search) {
        where.OR = [
          { partnerName: { contains: input.search, mode: 'insensitive' } },
          { partnerLicense: { contains: input.search, mode: 'insensitive' } },
        ];
      }
      return ctx.prisma.tollingAgreement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(input.pageSize ? { take: input.pageSize } : {}),
      });
    }),

  createAgreement: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      partnerName: z.string(),
      partnerLicense: z.string().optional(),
      agreementType: z.enum(['INBOUND', 'OUTBOUND']),
      startDate: z.string(),
      endDate: z.string().optional(),
      inputWeight: z.number().optional(),
      outputWeight: z.number().optional(),
      processingFee: z.number().optional(),
      billingMode: z.enum(['SEPARATE_INVOICE', 'BUILT_INTO_ECONOMICS']).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const totalFees = (input.inputWeight && input.processingFee)
        ? input.inputWeight * input.processingFee
        : undefined;

      return ctx.prisma.tollingAgreement.create({
        data: {
          facilityId: input.facilityId,
          partnerName: input.partnerName,
          partnerLicense: input.partnerLicense || null,
          agreementType: input.agreementType,
          status: 'ACTIVE',
          startDate: new Date(input.startDate),
          endDate: input.endDate ? new Date(input.endDate) : null,
          inputWeight: input.inputWeight ?? null,
          outputWeight: input.outputWeight ?? null,
          processingFee: input.processingFee ?? null,
          totalFees: totalFees ?? null,
          billingMode: input.billingMode ?? 'SEPARATE_INVOICE',
          metadata: (input.notes ? { notes: input.notes } : {}) as Prisma.InputJsonValue,
        },
      });
    }),

  updateAgreement: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
      status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
      outputWeight: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = {};
      if (input.status) updateData.status = input.status;
      if (input.outputWeight !== undefined) updateData.outputWeight = input.outputWeight;
      if (input.notes !== undefined) updateData.metadata = { notes: input.notes } as Prisma.InputJsonValue;

      const existing = await ctx.prisma.tollingAgreement.findFirst({
        where: { id: input.agreementId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agreement not found or access denied' });
      }

      return ctx.prisma.tollingAgreement.update({
        where: { id: input.agreementId },
        data: updateData,
      });
    }),

  // ---------------------------------------------------------------------------
  // Advanced procedures
  // ---------------------------------------------------------------------------

  advancedCalc: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      feeStructure: z.array(z.object({
        feeType: z.enum(['FLAT', 'PER_UNIT', 'PERCENTAGE', 'ROYALTY', 'TRANSPORT', 'TESTING']),
        label: z.string(),
        rate: z.number(),
        basis: z.enum(['input_weight', 'output_weight', 'revenue', 'fixed']),
        minFee: z.number().optional(),
        maxFee: z.number().optional(),
      })),
      inputWeight: z.number(),
      outputWeight: z.number(),
      revenue: z.number().optional(),
    }))
    .query(({ input }) => {
      return calculateFees(input.feeStructure, input.inputWeight, input.outputWeight, input.revenue);
    }),

  advancedCompare: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      partners: z.array(z.object({
        partnerName: z.string(),
        agreementType: z.string().optional(),
        feeStructure: z.array(z.object({
          feeType: z.enum(['FLAT', 'PER_UNIT', 'PERCENTAGE', 'ROYALTY', 'TRANSPORT', 'TESTING']),
          label: z.string(),
          rate: z.number(),
          basis: z.enum(['input_weight', 'output_weight', 'revenue', 'fixed']),
          minFee: z.number().optional(),
          maxFee: z.number().optional(),
        })),
        inputWeight: z.number(),
        expectedYieldPct: z.number(),
        revenue: z.number().optional(),
      })),
    }))
    .query(({ input }) => {
      return comparePartners(input.partners);
    }),

  breakeven: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      partnerA: z.object({
        name: z.string(),
        feeStructure: z.array(z.object({
          feeType: z.enum(['FLAT', 'PER_UNIT', 'PERCENTAGE', 'ROYALTY', 'TRANSPORT', 'TESTING']),
          label: z.string(),
          rate: z.number(),
          basis: z.enum(['input_weight', 'output_weight', 'revenue', 'fixed']),
          minFee: z.number().optional(),
          maxFee: z.number().optional(),
        })),
      }),
      partnerB: z.object({
        name: z.string(),
        feeStructure: z.array(z.object({
          feeType: z.enum(['FLAT', 'PER_UNIT', 'PERCENTAGE', 'ROYALTY', 'TRANSPORT', 'TESTING']),
          label: z.string(),
          rate: z.number(),
          basis: z.enum(['input_weight', 'output_weight', 'revenue', 'fixed']),
          minFee: z.number().optional(),
          maxFee: z.number().optional(),
        })),
      }),
      inputWeight: z.number(),
      revenue: z.number().optional(),
    }))
    .query(({ input }) => {
      return findBreakevenYield(input.partnerA, input.partnerB, input.inputWeight, input.revenue);
    }),

  yieldVariance: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const agreement = await ctx.prisma.tollingAgreement.findFirst({
        where: { id: input.agreementId, facilityId: input.facilityId },
      });
      if (!agreement) throw new Error('Agreement not found');

      const batches = await ctx.prisma.tollingBatch.findMany({
        where: { agreementId: input.agreementId },
        orderBy: { startedAt: 'desc' },
      });

      return analyzeYieldVariance(
        agreement.partnerName,
        batches.map(b => ({
          batchId: b.id,
          expectedYieldPct: b.expectedYieldPct,
          actualYieldPct: b.actualYieldPct,
        })),
      );
    }),

  // ---------------------------------------------------------------------------
  // Batch CRUD
  // ---------------------------------------------------------------------------

  listBatches: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.TollingBatchWhereInput = { facilityId: input.facilityId };
      if (input.agreementId) where.agreementId = input.agreementId;
      if (input.status) where.status = input.status;
      return ctx.prisma.tollingBatch.findMany({
        where,
        include: { agreement: { select: { partnerName: true, agreementType: true } } },
        orderBy: { startedAt: 'desc' },
        take: 50,
      });
    }),

  createBatch: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
      inputWeight: z.number().optional(),
      expectedYieldPct: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const agreement = await ctx.prisma.tollingAgreement.findFirst({
        where: { id: input.agreementId, facilityId: input.facilityId },
      });
      if (!agreement) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agreement not found or access denied' });
      }

      return ctx.prisma.tollingBatch.create({
        data: {
          facilityId: input.facilityId,
          agreementId: input.agreementId,
          status: 'IN_PROGRESS',
          inputWeight: input.inputWeight ?? null,
          expectedYieldPct: input.expectedYieldPct ?? null,
          notes: input.notes ?? null,
        },
      });
    }),

  updateBatch: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      batchId: z.string(),
      status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
      outputWeight: z.number().optional(),
      actualYieldPct: z.number().optional(),
      wasteWeight: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.TollingBatchUncheckedUpdateInput = {};
      if (input.status) data.status = input.status;
      if (input.outputWeight !== undefined) data.outputWeight = input.outputWeight;
      if (input.actualYieldPct !== undefined) data.actualYieldPct = input.actualYieldPct;
      if (input.wasteWeight !== undefined) data.wasteWeight = input.wasteWeight;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.status === 'COMPLETED') data.completedAt = new Date();
      // Verify batch belongs to this facility
      const batch = await ctx.prisma.tollingBatch.findFirst({
        where: { id: input.batchId, facilityId: input.facilityId },
      });
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found or access denied' });
      }

      // Calculate yield variance if we have both expected and actual
      if (input.actualYieldPct !== undefined) {
        if (batch.expectedYieldPct != null) {
          data.yieldVariance = input.actualYieldPct - batch.expectedYieldPct;
        }
      }
      // Calculate waste pct
      if (input.wasteWeight !== undefined) {
        if (batch.inputWeight) {
          data.wastePct = Math.round((input.wasteWeight / batch.inputWeight) * 100 * 10) / 10;
        }
      }
      return ctx.prisma.tollingBatch.update({
        where: { id: input.batchId },
        data,
      });
    }),

  // ---------------------------------------------------------------------------
  // Lifecycle Tracking
  // ---------------------------------------------------------------------------

  getAvailablePackages: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      category: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      // Filter: non-hold, quantity > 0, optional search/category
      let filtered = allPackages.filter(
        (p) => !p.IsOnHold && p.Quantity > 0,
      );

      if (input.search) {
        const q = input.search.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.Label.toLowerCase().includes(q) ||
            p.ItemName.toLowerCase().includes(q),
        );
      }

      if (input.category) {
        filtered = filtered.filter((p) => p.ItemCategory === input.category);
      }

      // Collect unique categories for filter dropdown
      const categories = Array.from(new Set(allPackages.filter((p) => !p.IsOnHold && p.Quantity > 0).map((p) => p.ItemCategory))).sort();

      // Paginate
      const total = filtered.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = filtered.slice(start, start + input.pageSize).map((p) => ({
        label: p.Label,
        itemName: p.ItemName,
        category: p.ItemCategory,
        quantity: p.Quantity,
        unit: p.UnitOfMeasureName,
        labTestingState: p.LabTestingState,
        packagedDate: p.PackagedDate,
        strain: p.ItemStrainName,
      }));

      return { items, total, page: input.page, totalPages, categories };
    }),

  linkPackages: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      batchId: z.string(),
      inputPackageLabels: z.array(z.string()).optional(),
      outputPackageLabels: z.array(z.string()).optional(),
      confirmed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const batch = await ctx.prisma.tollingBatch.findFirst({
        where: { id: input.batchId, facilityId: input.facilityId },
      });
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found or access denied' });
      }

      const allLabels = [
        ...(input.inputPackageLabels ?? []),
        ...(input.outputPackageLabels ?? []),
      ];

      // Validate all labels exist in active packages (from DB snapshot)
      const activePackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const activeMap = new Map(activePackages.map((p) => [p.Label, p]));
      const missing = allLabels.filter((l) => !activeMap.has(l));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Packages not found in active inventory: ${missing.join(', ')}`,
        });
      }

      // Build preview data
      const linkedDetails = allLabels.map((l) => {
        const pkg = activeMap.get(l)!;
        return {
          label: pkg.Label,
          itemName: pkg.ItemName,
          category: pkg.ItemCategory,
          quantity: pkg.Quantity,
          unit: pkg.UnitOfMeasureName,
        };
      });

      if (!input.confirmed) {
        // Preview mode
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'LINK_TOLLING_PACKAGES',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: allLabels,
            targetCount: allLabels.length,
            previewData: linkedDetails as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'preview' as const,
          preview: {
            batchId: input.batchId,
            inputPackages: (input.inputPackageLabels ?? []).map((l) => {
              const pkg = activeMap.get(l)!;
              return { label: l, itemName: pkg.ItemName, quantity: pkg.Quantity, unit: pkg.UnitOfMeasureName };
            }),
            outputPackages: (input.outputPackageLabels ?? []).map((l) => {
              const pkg = activeMap.get(l)!;
              return { label: l, itemName: pkg.ItemName, quantity: pkg.Quantity, unit: pkg.UnitOfMeasureName };
            }),
          },
        };
      }

      // Confirm mode: merge into batch's package lists
      // Deduplicate to prevent double-linking if user confirms twice or re-links.
      // Note: read-merge-write has a TOCTOU race under concurrent requests.
      // Prisma doesn't support atomic array push for String[] on PostgreSQL,
      // so this is the pragmatic approach. Dedup guards against the common case.
      const newInputIds = Array.from(new Set([...batch.inputPackageIds, ...(input.inputPackageLabels ?? [])]));
      const newOutputIds = Array.from(new Set([...batch.outputPackageIds, ...(input.outputPackageLabels ?? [])]));

      // Compute live weights from linked packages
      const inputWeight = newInputIds.reduce((sum, l) => {
        const pkg = activeMap.get(l);
        return sum + (pkg ? pkg.Quantity : 0);
      }, 0);
      const outputWeight = newOutputIds.reduce((sum, l) => {
        const pkg = activeMap.get(l);
        return sum + (pkg ? pkg.Quantity : 0);
      }, 0);

      const updated = await ctx.prisma.tollingBatch.update({
        where: { id: input.batchId },
        data: {
          inputPackageIds: newInputIds,
          outputPackageIds: newOutputIds,
          inputWeight: Math.round(inputWeight * 100) / 100,
          outputWeight: Math.round(outputWeight * 100) / 100,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'LINK_TOLLING_PACKAGES',
          status: 'COMPLETED',
          targetType: 'PACKAGE',
          targetIds: allLabels,
          targetCount: allLabels.length,
          executedAt: new Date(),
          afterState: { inputPackageIds: newInputIds, outputPackageIds: newOutputIds } as unknown as Prisma.InputJsonValue,
        },
      });

      return { status: 'completed' as const, batch: updated };
    }),

  // Query that also caches lifecycle state to DB (idempotent write).
  // Defined as a query because the primary purpose is reading live Metrc data;
  // the DB write is a best-effort cache so the list view can show stage without
  // re-fetching every batch's packages.
  batchLifecycle: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      batchId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const batch = await ctx.prisma.tollingBatch.findFirst({
        where: { id: input.batchId, facilityId: input.facilityId },
      });
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found or access denied' });
      }

      const [packages, harvestData] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        getAllHarvestsFromDb(ctx.prisma, input.facilityId),
      ]);
      const harvests = [...harvestData.active, ...harvestData.onHold, ...harvestData.inactive];

      const index = buildProvenanceIndex(packages, harvests);
      const lifecycle = computeBatchLifecycle(
        batch.id,
        batch.inputPackageIds,
        batch.outputPackageIds,
        index,
      );

      // Fire-and-forget: cache lifecycle state to DB
      const updateData: Prisma.TollingBatchUncheckedUpdateInput = {
        lifecycleStage: lifecycle.stage,
        lifecycleSnapshot: lifecycle as unknown as Prisma.InputJsonValue,
      };

      // Set commencedAt if newly commenced + create compliance alert atomically
      if (lifecycle.stage === 'COMMENCED' && !batch.commencedAt) {
        // commencedAt is written inside the transaction (not via updateData)
        // to ensure atomicity with the alert creation

        // Atomically write commencedAt + create alert in a transaction
        // to prevent duplicate alerts from concurrent query executions
        ctx.prisma.$transaction(async (tx) => {
          // Deduplication: check for existing commencement alert for this batch
          const existingAlert = await tx.complianceAlert.findFirst({
            where: {
              facilityId: input.facilityId,
              category: 'tolling',
              title: 'Tolling Batch Commenced',
              metadata: { path: ['batchId'], equals: batch.id },
            },
            select: { id: true },
          });
          if (existingAlert) return; // Already alerted

          // Atomically set commencedAt (WHERE commencedAt IS NULL prevents race)
          const updated = await tx.tollingBatch.updateMany({
            where: { id: batch.id, commencedAt: null },
            data: { commencedAt: new Date() },
          });
          if (updated.count === 0) return; // Another request already set commencedAt

          await tx.complianceAlert.create({
            data: {
              facilityId: input.facilityId,
              category: 'tolling',
              severity: 'INFO',
              title: 'Tolling Batch Commenced',
              description: `Tolling batch has reached the COMMENCED stage — output packages from tolled material are now being sold. Review fee settlement and billing obligations.`,
              status: 'OPEN',
              metadata: {
                batchId: batch.id,
                stage: lifecycle.stage,
                inputPackageCount: batch.inputPackageIds.length,
                outputPackageCount: batch.outputPackageIds.length,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }).catch((txErr: unknown) => {
          console.error(`[tolling] Failed to create commencement alert for batch ${batch.id}:`, txErr);
        });
      }

      // Update live yield
      if (lifecycle.liveInputWeight > 0) {
        updateData.inputWeight = lifecycle.liveInputWeight;
        updateData.outputWeight = lifecycle.liveOutputWeight;
        updateData.actualYieldPct = lifecycle.liveYieldPct;
        if (batch.expectedYieldPct != null) {
          updateData.yieldVariance = Math.round((lifecycle.liveYieldPct - batch.expectedYieldPct) * 10) / 10;
        }
      }

      // Fire-and-forget: cache lifecycle state for list view display
      ctx.prisma.tollingBatch.update({
        where: { id: batch.id },
        data: updateData,
      }).catch((cacheErr: unknown) => {
        console.error(`[tolling] Failed to cache lifecycle for batch ${batch.id}:`, cacheErr);
      });

      return lifecycle;
    }),

  updateBillingMode: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
      billingMode: z.enum(['SEPARATE_INVOICE', 'BUILT_INTO_ECONOMICS']),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.tollingAgreement.findFirst({
        where: { id: input.agreementId, facilityId: input.facilityId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agreement not found or access denied' });
      }

      return ctx.prisma.tollingAgreement.update({
        where: { id: input.agreementId },
        data: { billingMode: input.billingMode },
      });
    }),

  calculateBatchFees: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      batchId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const batch = await ctx.prisma.tollingBatch.findFirst({
        where: { id: input.batchId, facilityId: input.facilityId },
        include: { agreement: true },
      });
      if (!batch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found or access denied' });
      }

      const rawFees = batch.agreement.feeStructure;
      if (!Array.isArray(rawFees) || rawFees.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agreement has no fee structure defined. Add fees in the Advanced calculator first.',
        });
      }
      // Runtime validation: ensure each fee has required fields
      const feeStructure = (rawFees as Record<string, unknown>[]).map((f) => {
        if (!f.feeType || !f.label || typeof f.rate !== 'number' || !f.basis) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid fee structure entry: ${JSON.stringify(f)}. Each fee needs feeType, label, rate, and basis.`,
          });
        }
        return f as unknown as FeeDefinition;
      });
      if (feeStructure.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agreement has no valid fee structure entries.',
        });
      }

      const iw = batch.inputWeight ?? 0;
      const ow = batch.outputWeight ?? 0;
      const calc = calculateFees(feeStructure, iw, ow);

      const billingMode = batch.agreement.billingMode ?? 'SEPARATE_INVOICE';

      // For BUILT_INTO_ECONOMICS, compute cost-per-gram that absorbs fees into output value
      let costBasis: { costPerGramOutput: number; embeddedFeeTotal: number } | undefined;
      if (billingMode === 'BUILT_INTO_ECONOMICS' && ow > 0) {
        // Fees are absorbed into the cost of output material rather than invoiced separately
        const costPerGramOutput = calc.totalFees / ow;
        costBasis = { costPerGramOutput, embeddedFeeTotal: calc.totalFees };
      }

      // Persist fee breakdown + cost basis (if applicable) into calculatedFees JSON
      const calculatedFeesData = costBasis
        ? {
            fees: calc.fees,
            billingMode,
            costBasis: {
              costPerGramOutput: costBasis.costPerGramOutput,
              embeddedFeeTotal: costBasis.embeddedFeeTotal,
              calculatedAt: new Date().toISOString(),
            },
          }
        : calc.fees;

      const updated = await ctx.prisma.tollingBatch.update({
        where: { id: batch.id },
        data: {
          calculatedFees: calculatedFeesData as unknown as Prisma.InputJsonValue,
          totalFees: calc.totalFees,
          actualYieldPct: calc.yieldPercentage,
          yieldVariance: batch.expectedYieldPct != null
            ? Math.round((calc.yieldPercentage - batch.expectedYieldPct) * 10) / 10
            : null,
        },
      });

      return { batch: updated, calculation: calc, billingMode, costBasis };
    }),

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  reconcileStatement: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      return fetchReconciliationStatement(ctx.prisma, input.agreementId, input.facilityId);
    }),

  exportReconciliationCSV: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      agreementId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const statement = await fetchReconciliationStatement(ctx.prisma, input.agreementId, input.facilityId);
      const safeName = statement.partnerName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
      return {
        csv: reconciliationToCSV(statement),
        filename: `reconciliation-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }),
});

// ---------------------------------------------------------------------------
// Shared helper — facility-scoped reconciliation fetch
// ---------------------------------------------------------------------------

async function fetchReconciliationStatement(
  prisma: PrismaClient,
  agreementId: string,
  facilityId: string,
) {
  const agreement = await prisma.tollingAgreement.findFirst({
    where: { id: agreementId, facilityId },
    include: { batches: true },
  });
  if (!agreement) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agreement not found' });
  }

  return generateReconciliationStatement(
    {
      id: agreement.id,
      partnerName: agreement.partnerName,
      partnerLicense: agreement.partnerLicense,
      agreementType: agreement.agreementType,
      billingMode: agreement.billingMode,
      status: agreement.status,
      startDate: agreement.startDate.toISOString(),
      endDate: agreement.endDate?.toISOString() ?? null,
      yieldGuarantee: agreement.yieldGuarantee,
    },
    agreement.batches.map((b) => ({
      id: b.id,
      status: b.status,
      lifecycleStage: b.lifecycleStage,
      inputPackageIds: b.inputPackageIds,
      outputPackageIds: b.outputPackageIds,
      inputWeight: b.inputWeight,
      outputWeight: b.outputWeight,
      wasteWeight: b.wasteWeight,
      wastePct: b.wastePct,
      calculatedFees: b.calculatedFees,
      totalFees: b.totalFees,
      commencedAt: b.commencedAt,
    })),
  );
}
