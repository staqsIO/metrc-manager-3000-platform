/**
 * tRPC router for Canix ERP data.
 *
 * Phase 0: Standard costs, BOMs, items, non-cannabis products, COGS waterfall.
 * Phase 1: Sales orders, purchase orders, vendors, customers.
 * Phase 2: Audited actions.
 */

import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { getCanixClient } from '@/services/canix/canix-factory';
import type { CanixLineItem } from '@/services/canix/types';
import {
  resolvePackageCOGS,
  summarizeCOGS,
  validateBOMsAgainstInferred,
  inferBOMsFromActionLogs,
  type PackageForCOGS,
  type DutchieCostEntry,
  type ManualCostEntry,
} from '@/services/engines/cogs-engine';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';

export const canixRouter = createTRPCRouter({
  // ── Phase 0: Costs + BOMs ──────────────────────────────────

  /**
   * Get Canix standard costs for all items at a facility.
   */
  getStandardCosts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      itemId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      return client.getStandardCosts(input.itemId);
    }),

  /**
   * Get Canix Bills of Materials.
   */
  getBillsOfMaterials: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      return client.getBillsOfMaterials();
    }),

  /**
   * Get a single BOM by ID.
   */
  getBillOfMaterials: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      bomId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      return client.getBillOfMaterials(input.bomId);
    }),

  /**
   * Get Canix items (cannabis products with cost data).
   */
  getItems: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      return client.getItems();
    }),

  /**
   * Get non-cannabis products (packaging, solvents, supplies).
   */
  getNonCannabisProducts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      return client.getNonCannabisProducts();
    }),

  /**
   * Compute COGS waterfall for all active packages at a facility.
   *
   * Fetches data from three sources in parallel:
   *   - Metrc: active packages (quantity, item, category)
   *   - Canix: standard costs + BOMs (authoritative cost data)
   *   - Dutchie: line items with unitCost (POS fallback)
   *
   * Returns per-package COGS with source attribution and summary.
   */
  getPackageCOGS: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const canixClient = getCanixClient(ctx.facility);
      const dutchieClient = getDutchieClient(ctx.facility);

      // Fetch all data sources in parallel — packages from DB
      const [activePackages, standardCosts, boms, deliveries] = await Promise.all([
        getActivePackagesFromDb(ctx.prisma, input.facilityId),
        canixClient.getStandardCosts(),
        canixClient.getBillsOfMaterials(),
        dutchieClient.getDeliveries({
          includeLineItems: true,
          fromDateUTC: new Date(Date.now() - 90 * 86400000).toISOString(),
        }),
      ]);

      // Project Metrc packages to COGS input shape
      const packages: PackageForCOGS[] = activePackages.map(pkg => ({
        label: pkg.Label,
        itemName: pkg.ItemName ?? '',
        quantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
        category: pkg.ItemCategory ?? '',
      }));

      // Extract Dutchie unit costs from line items
      const DUTCHIE_MARGIN_ASSUMPTION = 0.5; // Approximate COGS from retail price
      const dutchieCosts: DutchieCostEntry[] = [];
      for (const delivery of deliveries) {
        for (const li of delivery.LineItems ?? []) {
          if (li.MetrcPackageLabel) {
            dutchieCosts.push({
              metrcPackageLabel: li.MetrcPackageLabel,
              unitCost: li.Price * DUTCHIE_MARGIN_ASSUMPTION,
              inferred: true,
            });
          }
        }
      }

      // No manual costs for now (Phase 2: integrate OpEx model)
      const manualCosts: ManualCostEntry[] = [];

      const results = resolvePackageCOGS(packages, {
        standardCosts,
        boms,
        dutchieCosts,
        manualCosts,
      });

      return {
        packages: results,
        summary: summarizeCOGS(results),
      };
    }),

  /**
   * Compare Canix authoritative BOMs against inferred BOMs from processing history.
   * Returns deviations sorted by severity.
   */
  validateBOMs: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const canixClient = getCanixClient(ctx.facility);
      const canixBOMs = await canixClient.getBillsOfMaterials();

      // Get inferred BOMs from action log history
      const logs = await ctx.prisma.actionLog.findMany({
        where: {
          facilityId: ctx.facility.id,
          actionType: 'PROCESSING_CREATE',
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      const inferredBOMs = inferBOMsFromActionLogs(logs as Array<{ previewData: Record<string, unknown> | null }>);

      return validateBOMsAgainstInferred(canixBOMs, inferredBOMs);
    }),

  // ── Phase 1: Orders ────────────────────────────────────────

  /**
   * Get B2B sales orders from Canix.
   */
  getSalesOrders: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      return client.getSalesOrders({ limit: input.limit, offset: input.offset });
    }),

  /**
   * Get purchase orders from Canix.
   */
  getPurchaseOrders: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      return client.getPurchaseOrders({ limit: input.limit, offset: input.offset });
    }),

  /**
   * Get vendors from Canix.
   */
  getVendors: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      return client.getVendors();
    }),

  /**
   * Get customers from Canix.
   */
  getCustomers: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      return client.getCustomers();
    }),

  // ── Phase 2: Audit Trail ─────────────────────────────────────

  /**
   * Get audited actions from Canix ERP.
   */
  getAuditedActions: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      limit: z.number().min(1).max(500).default(100),
      entityType: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      return client.getAuditedActions({
        limit: input.limit,
        ...(input.entityType ? { where: { entityType: input.entityType } } : {}),
      });
    }),

  /**
   * Reconcile Canix audit trail against platform ActionLog.
   * Detects actions performed outside the platform (bypass detection).
   */
  reconcileAuditTrail: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      daysBack: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const client = getCanixClient(ctx.facility);
      const cutoff = new Date(Date.now() - input.daysBack * 86400000);

      const [canixActions, actionLogs] = await Promise.all([
        client.getAuditedActions({ limit: 500 }),
        ctx.prisma.actionLog.findMany({
          where: {
            facilityId: ctx.facility.id,
            createdAt: { gte: cutoff },
            status: 'COMPLETED',
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            id: true,
            actionType: true,
            status: true,
            targetType: true,
            targetIds: true,
            targetCount: true,
            userId: true,
            createdAt: true,
            executedAt: true,
          },
        }),
      ]);

      // Filter Canix actions by date
      const filteredCanixActions = canixActions.filter(
        a => new Date(a.performedAt) >= cutoff
      );

      const { reconcileAuditTrails } = await import('@/services/engines/audit-reconciliation-engine');
      return reconcileAuditTrails(
        filteredCanixActions,
        actionLogs.map(a => ({
          ...a,
          targetIds: a.targetIds as string[],
          createdAt: a.createdAt.toISOString(),
          executedAt: a.executedAt?.toISOString() ?? null,
        })),
      );
    }),

  // ── Phase 2: Vendor & Customer Analytics ─────────────────────

  /**
   * Compute vendor analytics from purchase orders.
   */
  getVendorAnalytics: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      const [vendors, purchaseOrders, items] = await Promise.all([
        client.getVendors(),
        client.getPurchaseOrders(),
        client.getItems(),
      ]);

      // Fetch PO contents (bounded at 20)
      const poContents = new Map<string, CanixLineItem[]>();
      const contentResults = await Promise.all(
        purchaseOrders.slice(0, 20).map(async (po) => {
          const contents = await client.getPurchaseOrderContents(po.id);
          return { poId: po.id, contents };
        })
      );
      for (const { poId, contents } of contentResults) {
        poContents.set(poId, contents);
      }

      const { computeVendorAnalytics } = await import('@/services/engines/vendor-analytics-engine');
      return computeVendorAnalytics(vendors, purchaseOrders, poContents, items);
    }),

  /**
   * Compute customer analytics from sales orders.
   */
  getCustomerAnalytics: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
    }))
    .query(async ({ ctx }) => {
      const client = getCanixClient(ctx.facility);
      const [customers, salesOrders] = await Promise.all([
        client.getCustomers(),
        client.getSalesOrders(),
      ]);

      // Fetch SO contents (bounded at 20)
      const soContents = new Map<string, CanixLineItem[]>();
      const contentResults = await Promise.all(
        salesOrders.slice(0, 20).map(async (so) => {
          const contents = await client.getSalesOrderContents(so.id);
          return { soId: so.id, contents };
        })
      );
      for (const { soId, contents } of contentResults) {
        soContents.set(soId, contents);
      }

      const { computeCustomerAnalytics } = await import('@/services/engines/customer-analytics-engine');
      return computeCustomerAnalytics(customers, salesOrders);
    }),
});
