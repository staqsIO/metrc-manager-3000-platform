import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma, MetrcFacility } from '@prisma/client';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import {
  parseReconciliationFile,
  matchRows,
  buildAdjustmentPayload,
  getAdjustableRows,
  type ReconciliationRow,
} from '@/services/engines/reconciliation-engine';
import { checkPackageAdjustment } from '@/services/metrc/verification-checks';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;
// ~7.5MB decoded; keeps memory and request size reasonable
const MAX_FILE_BASE64_LENGTH = 10_000_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const reconciliationRowSchema = z.object({
  label: z.string(),
  metrcQuantity: z.number().nullable(),
  externalQuantity: z.number().nullable(),
  delta: z.number().nullable(),
  unitOfMeasure: z.string(),
  itemName: z.string(),
  status: z.enum(['match', 'mismatch', 'missing_in_metrc', 'missing_in_external']),
  adjustmentReason: z.string(),
});

export const reconciliationRouter = createTRPCRouter({
  /**
   * Parse an uploaded file (base64), fetch Metrc packages, match by label,
   * and return diff rows for the BulkEditGrid.
   */
  parseAndMatch: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      fileBase64: z.string().max(MAX_FILE_BASE64_LENGTH),
      filename: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Decode base64 → ArrayBuffer (Node-idiomatic)
      const buf = Buffer.from(input.fileBase64, 'base64');

      const { rows: parsed, errors, detectedColumns } = parseReconciliationFile(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        input.filename,
      );

      if (parsed.length === 0 && errors.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: errors.join('; ') });
      }

      if (parsed.length > 10_000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `File contains ${parsed.length} rows. Maximum is 10,000.` });
      }

      const metrcPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const matched = matchRows(parsed, metrcPackages);

      return {
        rows: matched,
        parseErrors: errors,
        detectedColumns,
        metrcPackageCount: metrcPackages.length,
      };
    }),

  /**
   * Fetch Metrc data for specific labels (used by "From Inventory" and manual entry flows).
   */
  fetchByLabels: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      labels: z.array(z.string()).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const allPackages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const pkgMap = new Map(allPackages.map(p => [p.Label, p]));

      const rows: ReconciliationRow[] = input.labels.map(label => {
        const pkg = pkgMap.get(label);
        if (!pkg) {
          return {
            label,
            metrcQuantity: null,
            externalQuantity: null,
            delta: null,
            unitOfMeasure: '',
            itemName: '',
            status: 'missing_in_metrc' as const,
            adjustmentReason: '',
          };
        }
        return {
          label,
          metrcQuantity: pkg.Quantity,
          externalQuantity: null,
          delta: null,
          unitOfMeasure: pkg.UnitOfMeasureName,
          itemName: pkg.ItemName,
          status: 'missing_in_external' as const,
          adjustmentReason: '',
        };
      });

      return { rows };
    }),

  /**
   * Build adjustment payload and log a PREVIEWING ActionLog.
   * Returns summary for the preview dialog.
   */
  previewBulkAdjust: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      rows: z.array(reconciliationRowSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const adjustable = getAdjustableRows(input.rows as ReconciliationRow[]);

      if (adjustable.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No adjustable rows found. Ensure rows have an external quantity and adjustment reason.',
        });
      }

      const payload = buildAdjustmentPayload(adjustable);

      const increases = payload.filter(p => p.Quantity > 0);
      const decreases = payload.filter(p => p.Quantity < 0);

      const summary = {
        totalAdjustments: payload.length,
        increaseCount: increases.length,
        decreaseCount: decreases.length,
        totalIncrease: increases.reduce((sum, p) => sum + p.Quantity, 0),
        totalDecrease: decreases.reduce((sum, p) => sum + p.Quantity, 0),
        adjustments: payload.map(p => {
          const row = adjustable.find(r => r.label === p.Label)!;
          return {
            label: p.Label,
            itemName: row.itemName,
            currentQuantity: row.metrcQuantity!,
            newQuantity: row.externalQuantity!,
            delta: p.Quantity,
            unit: p.UnitOfMeasureName,
            reason: p.AdjustmentReason,
          };
        }),
      };

      // Log PREVIEWING action
      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'BULK_RECONCILIATION',
          status: 'PREVIEWING',
          targetType: 'PACKAGE',
          targetIds: payload.map(p => p.Label),
          targetCount: payload.length,
          previewData: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    }),

  /**
   * Execute bulk adjustments in batches of 50.
   * Uses drift detection. Fail-fast: stops on first batch failure.
   * Single post-execution verification pass (avoids N+1 Metrc API calls).
   */
  executeBulkAdjust: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      rows: z.array(reconciliationRowSchema),
      expectedCount: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Re-fetch Metrc packages for drift detection
      const currentPackages = await client.getActivePackages();
      const pkgMap = new Map(currentPackages.map(p => [p.Label, p]));

      // Rebuild payload from current data
      const adjustable = getAdjustableRows(input.rows as ReconciliationRow[]);

      // Drift detection: check that quantities haven't changed since preview
      const drifted: string[] = [];
      for (const row of adjustable) {
        const current = pkgMap.get(row.label);
        if (!current) {
          drifted.push(`${row.label}: no longer active`);
          continue;
        }
        if (Math.abs(current.Quantity - row.metrcQuantity!) > 0.01) {
          drifted.push(`${row.label}: expected ${row.metrcQuantity}, now ${current.Quantity}`);
        }
      }

      if (drifted.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Inventory changed since preview. Please re-upload or refresh.\n${drifted.slice(0, 5).join('\n')}${drifted.length > 5 ? `\n...and ${drifted.length - 5} more` : ''}`,
        });
      }

      const payload = buildAdjustmentPayload(adjustable);

      // Drift detection: count mismatch
      if (payload.length !== input.expectedCount) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Expected ${input.expectedCount} adjustments but computed ${payload.length}. Please re-preview.`,
        });
      }

      // Create ReconciliationRecord
      const reconciliationRecord = await ctx.prisma.reconciliationRecord.create({
        data: {
          facilityId: input.facilityId,
          reconciliationType: 'INVENTORY',
          status: 'IN_PROGRESS',
          sourceA: 'METRC',
          sourceB: 'CSV_IMPORT',
          totalRecords: input.rows.length,
          matchedCount: input.rows.filter(r => r.status === 'match').length,
          mismatchCount: adjustable.length,
          missingInA: input.rows.filter(r => r.status === 'missing_in_metrc').length,
          missingInB: input.rows.filter(r => r.status === 'missing_in_external').length,
        },
      });

      // Batch into chunks of BATCH_SIZE
      const batches: typeof payload[] = [];
      for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        batches.push(payload.slice(i, i + BATCH_SIZE));
      }

      const batchResults: {
        batchIndex: number;
        status: 'success' | 'failed' | 'skipped';
        count: number;
        error?: string;
      }[] = [];

      let successCount = 0;
      let failCount = 0;
      let halted = false;
      const allBeforeState: { Label: string; Quantity: number; LastModified: string }[] = [];
      const allExpectedQuantities: Record<string, number> = {};

      for (let bi = 0; bi < batches.length; bi++) {
        // Fail-fast: skip remaining batches after failure
        if (halted) {
          batchResults.push({
            batchIndex: bi,
            status: 'skipped',
            count: batches[bi]!.length,
          });
          continue;
        }

        const batch = batches[bi]!;
        const batchLabels = batch.map(b => b.Label);

        // Capture beforeState for this batch
        for (const label of batchLabels) {
          const pkg = pkgMap.get(label)!;
          allBeforeState.push({ Label: pkg.Label, Quantity: pkg.Quantity, LastModified: pkg.LastModified });
          allExpectedQuantities[label] = pkg.Quantity + batch.find(b => b.Label === label)!.Quantity;
        }

        try {
          // Execute the adjustment — log ActionLog per batch
          await ctx.prisma.actionLog.create({
            data: {
              facilityId: input.facilityId,
              userId: ctx.session.user.id,
              actionType: 'BULK_RECONCILIATION',
              status: 'COMPLETED',
              targetType: 'PACKAGE',
              targetIds: batchLabels,
              targetCount: batchLabels.length,
              beforeState: batchLabels.map(label => {
                const pkg = pkgMap.get(label)!;
                return { Label: pkg.Label, Quantity: pkg.Quantity, LastModified: pkg.LastModified };
              }) as unknown as Prisma.InputJsonValue,
              executedAt: new Date(),
            },
          });

          await client.adjustPackages(
            batch.map(b => ({
              Label: b.Label,
              Quantity: b.Quantity,
              UnitOfMeasureName: b.UnitOfMeasureName,
              AdjustmentReason: b.AdjustmentReason,
              AdjustmentDate: b.AdjustmentDate,
            })) as unknown as Record<string, unknown>[],
          );

          batchResults.push({
            batchIndex: bi,
            status: 'success',
            count: batch.length,
          });
          successCount += batch.length;
        } catch (err) {
          batchResults.push({
            batchIndex: bi,
            status: 'failed',
            count: batch.length,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          failCount += batch.length;
          halted = true; // Stop executing further batches
        }

        // Delay between batches (skip after last or if halted)
        if (bi < batches.length - 1 && !halted) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      // Single post-execution verification pass (one Metrc API call)
      let verified = false;
      if (successCount > 0) {
        try {
          const afterPkgs = await client.getActivePackages();
          const successLabels = batchResults
            .filter(r => r.status === 'success')
            .flatMap((r) => batches[r.batchIndex]!.map(b => b.Label));
          const successBefore = allBeforeState.filter(b => successLabels.includes(b.Label));
          const afterTargets = afterPkgs.filter(p => successLabels.includes(p.Label));
          const successExpected: Record<string, number> = {};
          for (const label of successLabels) {
            if (allExpectedQuantities[label] !== undefined) {
              successExpected[label] = allExpectedQuantities[label];
            }
          }
          const result = checkPackageAdjustment(successBefore, afterTargets, successExpected);
          verified = result.verified;
        } catch {
          // Verification failed — not a showstopper, mark unverified
        }
      }

      // Determine final status
      const allSucceeded = failCount === 0;
      const noneSucceeded = successCount === 0;
      const finalStatus = allSucceeded ? 'COMPLETED' : noneSucceeded ? 'FAILED' : 'FAILED';

      // Update ReconciliationRecord
      await ctx.prisma.reconciliationRecord.update({
        where: { id: reconciliationRecord.id },
        data: {
          status: finalStatus,
          resolvedCount: successCount,
          completedAt: new Date(),
          completedBy: ctx.session.user.id,
          metadata: {
            batchResults,
            totalBatches: batches.length,
            successCount,
            failCount,
            verified,
            haltedOnBatch: halted ? batchResults.findIndex(r => r.status === 'failed') : undefined,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        reconciliationRecordId: reconciliationRecord.id,
        successCount,
        failCount,
        totalBatches: batches.length,
        batchResults,
        verified,
      };
    }),

  /**
   * Paginated list of past ReconciliationRecord entries for the facility.
   */
  listHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(50).optional().default(10),
    }))
    .query(async ({ ctx, input }) => {
      const [items, total] = await Promise.all([
        ctx.prisma.reconciliationRecord.findMany({
          where: { facilityId: input.facilityId },
          orderBy: { createdAt: 'desc' },
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
        }),
        ctx.prisma.reconciliationRecord.count({
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
   * Search active packages by label prefix (for AddPackageInput autocomplete).
   * Uses staleTime on client to avoid repeated Metrc API calls.
   */
  searchPackages: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      query: z.string().min(2).max(50),
    }))
    .query(async ({ ctx, input }) => {
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const q = input.query.toLowerCase();

      return packages
        .filter(p => p.Label.toLowerCase().includes(q))
        .slice(0, 20)
        .map(p => ({
          label: p.Label,
          itemName: p.ItemName,
          quantity: p.Quantity,
          unitOfMeasure: p.UnitOfMeasureName,
        }));
    }),
});
