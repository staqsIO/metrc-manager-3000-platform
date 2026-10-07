import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma, MetrcFacility } from '@prisma/client';
import { createTRPCRouter, multiFacilityProcedure, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import {
  fetchProductsFromStores,
  matchProductsAcrossStores,
  computeFindReplacePreview,
  executeBulkUpdate,
  executeRollback,
} from '@/services/dutchie/product-sync-engine';

// ---------------------------------------------------------------------------
// Per-facility operation lock — prevents concurrent bulk updates/rollbacks.
// Best-effort double-click prevention only: this is a module-level in-memory Map
// that does NOT survive server restarts or horizontal scaling. If the server
// restarts mid-operation, the lock disappears. If multiple server instances are
// running (e.g., Railway horizontal scaling), they each have independent locks.
// For single-instance deployments (current Railway setup), this is sufficient.
// Stale entries auto-expire after STALE_TIMEOUT_MS to prevent permanent locks
// from unhandled crashes.
// ---------------------------------------------------------------------------
const activeBulkOps = new Map<string, { startedAt: number; operation: string }>();
const STALE_TIMEOUT_MS = 5 * 60 * 1000;

function acquireBulkLock(facilityIds: string[], operation: string): void {
  for (const fid of facilityIds) {
    const existing = activeBulkOps.get(fid);
    if (existing && Date.now() - existing.startedAt < STALE_TIMEOUT_MS) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `A bulk ${existing.operation} is already in progress for this facility. Please wait for it to complete.`,
      });
    }
  }
  // Lock all facilities atomically after validation
  for (const fid of facilityIds) {
    activeBulkOps.set(fid, { startedAt: Date.now(), operation });
  }
}

function releaseBulkLock(facilityIds: string[]): void {
  for (const fid of facilityIds) {
    activeBulkOps.delete(fid);
  }
}

const findReplaceRuleSchema = z.object({
  field: z.enum(['name', 'description', 'unitPrice', 'categoryId', 'brandId', 'isActive', 'isVisible']),
  find: z.string().min(1).max(500),
  replace: z.string().max(500),
  isRegex: z.boolean().optional(),
  caseInsensitive: z.boolean().optional(),
}).refine(
  (rule) => !rule.isRegex || rule.find.length <= 100,
  { message: 'Regex patterns must be 100 characters or fewer', path: ['find'] },
);

export const dutchieBulkRouter = createTRPCRouter({
  /**
   * Fetch products from multiple stores and match them across locations.
   * Returns CrossStoreProductMatch[] for the comparison view.
   */
  fetchCrossStoreProducts: multiFacilityProcedure
    .input(z.object({
      facilityIds: z.array(z.string()).min(1).max(20),
    }))
    .query(async ({ ctx }) => {
      const facilities = ctx.facilities as MetrcFacility[];

      const { products, skipped } = await fetchProductsFromStores(
        facilities,
        getDutchieClient,
      );

      const matches = matchProductsAcrossStores(products);

      // Build facility name map for display
      const facilityNames: Record<string, string> = {};
      for (const f of facilities) {
        facilityNames[f.id] = f.name;
      }

      return {
        matches,
        facilityNames,
        skipped,
        totalProducts: Array.from(products.values()).reduce((sum, p) => sum + p.length, 0),
      };
    }),

  /**
   * Preview what a find-replace rule would change — no writes.
   * Returns per-facility change previews.
   */
  previewBulkUpdate: multiFacilityProcedure
    .input(z.object({
      facilityIds: z.array(z.string()).min(1).max(20),
      rule: findReplaceRuleSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const facilities = ctx.facilities as MetrcFacility[];

      const { products, skipped } = await fetchProductsFromStores(
        facilities,
        getDutchieClient,
      );

      const matches = matchProductsAcrossStores(products);

      const facilityNames: Record<string, string> = {};
      for (const f of facilities) {
        facilityNames[f.id] = f.name;
      }

      const previews = computeFindReplacePreview(matches, input.rule, facilityNames);
      const totalChanges = previews.reduce((sum, p) => sum + p.changes.length, 0);

      // Log preview action per facility (parallel writes)
      await Promise.all(previews.map(preview =>
        ctx.prisma.actionLog.create({
          data: {
            facilityId: preview.facilityId,
            userId: ctx.session.user.id,
            actionType: 'DUTCHIE_BULK_UPDATE',
            status: 'PREVIEWING',
            targetType: 'PRODUCT',
            targetIds: preview.changes.map(c => String(c.productId)),
            targetCount: preview.changes.length,
            previewData: {
              rule: input.rule,
              changes: preview.changes,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      ));

      return {
        previews,
        totalChanges,
        skipped,
      };
    }),

  /**
   * Execute a previewed bulk update with GET-before-POST safety.
   * Creates ActionLog entries per facility with before/after state.
   */
  executeBulkUpdate: multiFacilityProcedure
    .input(z.object({
      facilityIds: z.array(z.string()).min(1).max(20),
      rule: findReplaceRuleSchema,
      confirmed: z.literal(true),
      expectedChangeCount: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const facilities = ctx.facilities as MetrcFacility[];
      const facilityIds = facilities.map(f => f.id);

      // Acquire per-facility lock to prevent concurrent bulk updates
      acquireBulkLock(facilityIds, 'update');

      try {
        // Re-fetch and re-compute to ensure we're working with current data
        const { products, skipped } = await fetchProductsFromStores(
          facilities,
          getDutchieClient,
        );

        const matches = matchProductsAcrossStores(products);

        const facilityNames: Record<string, string> = {};
        for (const f of facilities) {
          facilityNames[f.id] = f.name;
        }

        const previews = computeFindReplacePreview(matches, input.rule, facilityNames);
        const actualChangeCount = previews.reduce((sum, p) => sum + p.changes.length, 0);

        // Drift detection: abort if data changed between preview and execute
        if (actualChangeCount !== input.expectedChangeCount) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Product data changed since preview. Expected ${input.expectedChangeCount} changes but found ${actualChangeCount}. Please re-preview.`,
          });
        }

        const results: {
          facilityId: string;
          facilityName: string;
          succeeded: string[];
          failed: { productId: string; error: string }[];
        }[] = [];

        // Execute per facility sequentially to avoid overwhelming Dutchie API
        for (const preview of previews) {
          const facility = facilities.find(f => f.id === preview.facilityId);
          if (!facility) {
            console.error(`[DutchieBulk] Facility ${preview.facilityId} in preview but not in facilities list — skipping`);
            continue;
          }

          try {
            const { result, beforeState, afterState } = await executeBulkUpdate(
              facility,
              preview.changes,
              getDutchieClient,
            );

            // Log completed action
            await ctx.prisma.actionLog.create({
              data: {
                facilityId: facility.id,
                userId: ctx.session.user.id,
                actionType: 'DUTCHIE_BULK_UPDATE',
                status: 'COMPLETED',
                targetType: 'PRODUCT',
                targetIds: [...result.succeeded, ...result.failed.map(f => f.productId)],
                targetCount: result.succeeded.length + result.failed.length,
                executedAt: new Date(),
                beforeState: beforeState as unknown as Prisma.InputJsonValue,
                afterState: afterState as unknown as Prisma.InputJsonValue,
                metadata: {
                  rule: input.rule,
                  succeededCount: result.succeeded.length,
                  failedCount: result.failed.length,
                  failures: result.failed,
                } as unknown as Prisma.InputJsonValue,
              },
            });

            results.push({
              facilityId: facility.id,
              facilityName: facility.name,
              ...result,
            });
          } catch (err) {
            // Log the failure
            await ctx.prisma.actionLog.create({
              data: {
                facilityId: facility.id,
                userId: ctx.session.user.id,
                actionType: 'DUTCHIE_BULK_UPDATE',
                status: 'FAILED',
                targetType: 'PRODUCT',
                targetIds: preview.changes.map(c => String(c.productId)),
                targetCount: preview.changes.length,
                metadata: {
                  rule: input.rule,
                  error: err instanceof Error ? err.message : String(err),
                } as unknown as Prisma.InputJsonValue,
              },
            });

            results.push({
              facilityId: facility.id,
              facilityName: facility.name,
              succeeded: [],
              failed: preview.changes.map(c => ({
                productId: String(c.productId),
                error: err instanceof Error ? err.message : 'Facility-level failure',
              })),
            });
          }
        }

        return { results, skipped };
      } finally {
        releaseBulkLock(facilityIds);
      }
    }),

  /**
   * Query past Dutchie bulk operations for a facility.
   */
  getBulkOperationHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const logs = await ctx.prisma.actionLog.findMany({
        where: {
          facilityId: input.facilityId,
          actionType: 'DUTCHIE_BULK_UPDATE',
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          userId: true,
          status: true,
          targetCount: true,
          createdAt: true,
          executedAt: true,
          metadata: true,
          previewData: true,
          beforeState: true,
        },
      });

      return logs;
    }),

  /**
   * Rollback a completed bulk update by restoring the beforeState snapshot.
   *
   * Only products that actually succeeded in the original operation are restored.
   * Uses optimistic locking (rolledBack flag) to prevent concurrent rollback attempts.
   */
  rollbackBulkUpdate: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      actionLogId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Acquire per-facility lock to prevent concurrent rollback/update
      acquireBulkLock([facility.id], 'rollback');

      try {
        // Fetch the original action log entry — query by BOTH id and facilityId
        // to prevent cross-facility information leakage
        const originalLog = await ctx.prisma.actionLog.findFirst({
          where: {
            id: input.actionLogId,
            facilityId: input.facilityId,
            actionType: 'DUTCHIE_BULK_UPDATE',
          },
          select: {
            id: true,
            status: true,
            beforeState: true,
            afterState: true,
            metadata: true,
          },
        });

        if (!originalLog) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Action log entry not found',
          });
        }

        if (originalLog.status !== 'COMPLETED') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Cannot rollback an operation with status "${originalLog.status}". Only COMPLETED operations can be rolled back.`,
          });
        }

        // Check if already rolled back (prevents concurrent rollback race condition)
        const originalMeta = (originalLog.metadata as Record<string, unknown>) ?? {};
        if (originalMeta.rolledBack === true) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This operation has already been rolled back.',
          });
        }

        if (
          !originalLog.beforeState ||
          typeof originalLog.beforeState !== 'object' ||
          Array.isArray(originalLog.beforeState)
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No before-state snapshot available for this operation. Rollback is not possible.',
          });
        }

        // Mark as rolled back IMMEDIATELY to prevent concurrent rollback attempts
        // This acts as an optimistic lock — the first caller wins
        await ctx.prisma.actionLog.update({
          where: { id: originalLog.id },
          data: {
            metadata: {
              ...originalMeta,
              rolledBack: true,
              rolledBackAt: new Date().toISOString(),
              rolledBackBy: ctx.session.user.id,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        const fullBeforeState = originalLog.beforeState as unknown as Record<string, import('@/services/dutchie/types').DutchieProductDetail>;

        // Only rollback products that actually succeeded in the original operation
        // to avoid overwriting products that were never changed
        const afterState = originalLog.afterState as unknown as Record<string, import('@/services/dutchie/types').DutchieProductDetail> | null;
        const succeededProductIds = afterState ? new Set(Object.keys(afterState)) : new Set(Object.keys(fullBeforeState));
        const beforeStateToRollback = Object.fromEntries(
          Object.entries(fullBeforeState).filter(([productId]) => succeededProductIds.has(productId)),
        );

        if (Object.keys(beforeStateToRollback).length === 0) {
          // Revert the optimistic lock — nothing to roll back
          await ctx.prisma.actionLog.update({
            where: { id: originalLog.id },
            data: { metadata: originalMeta as unknown as Prisma.InputJsonValue },
          });
          const beforeCount = Object.keys(fullBeforeState).length;
          const afterCount = afterState ? Object.keys(afterState).length : 0;
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `No products to rollback — the original operation had no successful changes (beforeState: ${beforeCount}, afterState: ${afterCount}).`,
          });
        }

        // Capture current product state BEFORE executing rollback (for audit trail)
        const currentStateSnapshot: Record<string, import('@/services/dutchie/types').DutchieProductDetail> = {};
        try {
          const client = getDutchieClient(facility);
          const currentProducts = await client.getProducts();
          const productIds = new Set(Object.keys(beforeStateToRollback));
          for (const p of currentProducts) {
            if (productIds.has(String(p.productId))) {
              currentStateSnapshot[String(p.productId)] = p;
            }
          }
        } catch {
          // Non-fatal — proceed with rollback even if we can't capture the snapshot
        }

        try {
          const { result, afterState: rollbackAfterState } = await executeRollback(
            facility,
            beforeStateToRollback,
            getDutchieClient,
          );

          // Create a new ActionLog entry for the rollback with full audit trail
          await ctx.prisma.actionLog.create({
            data: {
              facilityId: facility.id,
              userId: ctx.session.user.id,
              actionType: 'DUTCHIE_BULK_UPDATE',
              status: 'ROLLED_BACK',
              targetType: 'PRODUCT',
              targetIds: [...result.succeeded, ...result.failed.map(f => f.productId)],
              targetCount: result.succeeded.length + result.failed.length,
              executedAt: new Date(),
              beforeState: Object.keys(currentStateSnapshot).length > 0
                ? (currentStateSnapshot as unknown as Prisma.InputJsonValue)
                : undefined,
              afterState: rollbackAfterState as unknown as Prisma.InputJsonValue,
              metadata: {
                rollbackOf: originalLog.id,
                succeededCount: result.succeeded.length,
                failedCount: result.failed.length,
                failures: result.failed,
              } as unknown as Prisma.InputJsonValue,
            },
          });

          return {
            succeeded: result.succeeded,
            failed: result.failed,
          };
        } catch (err) {
          // Revert the optimistic lock so the operation can be retried
          await ctx.prisma.actionLog.update({
            where: { id: originalLog.id },
            data: { metadata: originalMeta as unknown as Prisma.InputJsonValue },
          }).catch(() => {
            // If reverting also fails, log but don't mask the original error
            console.error(`[DutchieBulk] Failed to revert rolledBack flag for ActionLog ${originalLog.id}`);
          });

          // Log the failed rollback attempt
          await ctx.prisma.actionLog.create({
            data: {
              facilityId: facility.id,
              userId: ctx.session.user.id,
              actionType: 'DUTCHIE_BULK_UPDATE',
              status: 'FAILED',
              targetType: 'PRODUCT',
              targetIds: Object.keys(beforeStateToRollback),
              targetCount: Object.keys(beforeStateToRollback).length,
              metadata: {
                rollbackOf: originalLog.id,
                error: err instanceof Error ? err.message : String(err),
              } as unknown as Prisma.InputJsonValue,
            },
          });

          const rollbackMsg = err instanceof Error ? err.message : String(err);
          console.error(`[DutchieBulk] Rollback failed:`, rollbackMsg);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Rollback failed. Check server logs for details.',
          });
        }
      } finally {
        releaseBulkLock([facility.id]);
      }
    }),
});
