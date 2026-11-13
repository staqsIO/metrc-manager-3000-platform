import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import { formatTransfer, formatDelivery, formatDeliveryPackage } from '@/services/metrc/types';
import { Prisma } from '@prisma/client';
import type { MetrcFacility, PrismaClient } from '@prisma/client';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { checkOutgoingTransferCreate } from '@/services/metrc/verification-checks';
import { parseAffiliatedTransferCSV, parseWholesaleTransferCSV } from '@/services/import/transfer-csv-parser';
import { matchFacilities } from '@/services/import/facility-matcher';

/**
 * Common shape returned by both snapshot reads and CSV-line-item synthesis.
 * `source` lets the UI distinguish "live operational data" from "imported
 * historical data" — both are real transfers, but the snapshot has full
 * fidelity (statuses, deliveries) while CSV-derived rows are aggregates.
 */
type FormattedTransfer = {
  id: number;
  manifestNumber: string;
  shipperFacilityName: string;
  shipperFacilityLicense: string;
  receiverFacilityName: string;
  receiverFacilityLicense: string;
  deliveryCount: number;
  packageCount: number;
  estimatedDepartureDateTime: string;
  receivedDateTime: string | null;
  createdDateTime: string | null;
  direction: string;
  isActive: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  source: 'snapshot' | 'csv';
};

/**
 * Map a TransferSnapshot row to the FormattedTransfer shape (plus snapshot-specific fields).
 */
function formatSnapshotToTransfer(snapshot: {
  metrcTransferId: number;
  manifestNumber: string;
  shipperFacilityName: string;
  shipperFacilityLicenseNumber: string;
  receiverFacilityName: string | null;
  receiverFacilityLicenseNumber: string | null;
  deliveryCount: number;
  packageCount: number;
  estimatedDepartureDateTime: string;
  receivedDateTime: string | null;
  createdDateTime: string | null;
  direction: string;
  isActive: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
}): FormattedTransfer {
  return {
    id: snapshot.metrcTransferId,
    manifestNumber: snapshot.manifestNumber,
    shipperFacilityName: snapshot.shipperFacilityName,
    shipperFacilityLicense: snapshot.shipperFacilityLicenseNumber,
    receiverFacilityName: snapshot.receiverFacilityName ?? '',
    receiverFacilityLicense: snapshot.receiverFacilityLicenseNumber ?? '',
    deliveryCount: snapshot.deliveryCount,
    packageCount: snapshot.packageCount,
    estimatedDepartureDateTime: snapshot.estimatedDepartureDateTime,
    receivedDateTime: snapshot.receivedDateTime,
    createdDateTime: snapshot.createdDateTime,
    direction: snapshot.direction,
    isActive: snapshot.isActive,
    firstSeenAt: snapshot.firstSeenAt.toISOString(),
    lastSeenAt: snapshot.lastSeenAt.toISOString(),
    source: 'snapshot',
  };
}

/**
 * Aggregate row shape returned by the manifest-level groupBy in raw SQL.
 * createdDateTime / receivedDateTime are strings stored MM/DD/YYYY in the
 * source CSVs; we parse them via TO_TIMESTAMP for proper chronological order.
 */
interface CsvManifestAggregate {
  manifestNumber: string;
  originLicenseNumber: string;
  originFacilityName: string;
  destLicenseNumber: string;
  destFacilityName: string;
  packageCount: bigint;
  receivedPackageCount: bigint;
  earliestCreated: Date | null;
  latestReceived: Date | null;
}

/**
 * Group TransferLineItem rows by manifest into per-manifest summary rows so
 * the History tab can surface CSV-imported transfers when the live snapshot
 * is empty. Direction is derived per-row by comparing the facility's license
 * to the manifest's origin/destination.
 */
async function synthesizeHistoricalTransfersFromLineItems(
  db: PrismaClient,
  facilityId: string,
  facilityLicense: string,
  opts: {
    direction?: 'incoming' | 'outgoing' | 'rejected' | 'all';
    search?: string;
    excludeManifests: Set<string>;
    page: number;
    pageSize: number;
  },
): Promise<{ items: FormattedTransfer[]; total: number }> {
  // Direction filter: outgoing means we shipped (origin = our license),
  // incoming means we received (destination = our license). Rejected is not
  // distinguishable from line items alone — return empty for that direction.
  if (opts.direction === 'rejected') return { items: [], total: 0 };

  const directionClause = opts.direction === 'outgoing'
    ? Prisma.sql`AND "originLicenseNumber" = ${facilityLicense}`
    : opts.direction === 'incoming'
      ? Prisma.sql`AND "destLicenseNumber" = ${facilityLicense}`
      : Prisma.empty;

  const searchClause = opts.search
    ? Prisma.sql`AND (
        "manifestNumber" ILIKE ${'%' + opts.search + '%'}
        OR "originFacilityName" ILIKE ${'%' + opts.search + '%'}
        OR "destFacilityName" ILIKE ${'%' + opts.search + '%'}
      )`
    : Prisma.empty;

  // Two queries: paginated rows + total count of distinct manifests.
  // Manifests already represented in TransferSnapshot are excluded so the
  // History tab doesn't double-count.
  const excludeArr = Array.from(opts.excludeManifests);
  const excludeClause = excludeArr.length > 0
    ? Prisma.sql`AND "manifestNumber" != ALL(${excludeArr})`
    : Prisma.empty;

  const [rows, totalRows] = await Promise.all([
    db.$queryRaw<CsvManifestAggregate[]>`
      SELECT
        "manifestNumber" as "manifestNumber",
        "originLicenseNumber" as "originLicenseNumber",
        "originFacilityName" as "originFacilityName",
        "destLicenseNumber" as "destLicenseNumber",
        "destFacilityName" as "destFacilityName",
        COUNT(*)::bigint as "packageCount",
        COUNT("receivedDateTime")::bigint as "receivedPackageCount",
        MIN(NULLIF("createdDateTime", '')::timestamp) as "earliestCreated",
        MAX(NULLIF("receivedDateTime", '')::timestamp) as "latestReceived"
      FROM transfer_line_items
      WHERE "facilityId" = ${facilityId}
        AND "isVoided" = false
        ${directionClause}
        ${searchClause}
        ${excludeClause}
      GROUP BY "manifestNumber", "originLicenseNumber", "originFacilityName",
               "destLicenseNumber", "destFacilityName"
      ORDER BY MIN(NULLIF("createdDateTime", '')::timestamp) DESC NULLS LAST
      LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}
    `,
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "manifestNumber")::bigint as count
      FROM transfer_line_items
      WHERE "facilityId" = ${facilityId}
        AND "isVoided" = false
        ${directionClause}
        ${searchClause}
        ${excludeClause}
    `,
  ]);

  const items = rows.map((r): FormattedTransfer => {
    const isOutgoing = r.originLicenseNumber === facilityLicense;
    return {
      // Synthetic id — no Metrc id available. Use a hash of the manifest so
      // it's stable across queries; the negative sign disambiguates from
      // real Metrc transfer ids.
      id: -hashStringTo32Bit(r.manifestNumber),
      manifestNumber: r.manifestNumber,
      shipperFacilityName: r.originFacilityName,
      shipperFacilityLicense: r.originLicenseNumber,
      receiverFacilityName: r.destFacilityName,
      receiverFacilityLicense: r.destLicenseNumber,
      deliveryCount: 1,
      packageCount: Number(r.packageCount),
      estimatedDepartureDateTime: r.earliestCreated?.toISOString() ?? '',
      receivedDateTime: r.latestReceived?.toISOString() ?? null,
      createdDateTime: r.earliestCreated?.toISOString() ?? null,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      // Synthesized rows always represent already-shipped historical data —
      // mark inactive so they sort under any live active manifests.
      isActive: false,
      firstSeenAt: r.earliestCreated?.toISOString() ?? '',
      lastSeenAt: r.latestReceived?.toISOString() ?? r.earliestCreated?.toISOString() ?? '',
      source: 'csv',
    };
  });

  return { items, total: Number(totalRows[0]?.count ?? 0) };
}

/** Stable 32-bit hash of a string — used to fabricate ids for synthesized rows. */
function hashStringTo32Bit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Snapshot-first reads — zero Metrc API calls on page load
// ---------------------------------------------------------------------------

async function queryTransferSnapshots(
  db: PrismaClient,
  facilityId: string,
  direction: 'incoming' | 'outgoing' | 'rejected',
  input: { search?: string; page: number; pageSize: number },
) {
  const where: Prisma.TransferSnapshotWhereInput = {
    facilityId,
    direction,
    isActive: true,
  };

  if (input.search) {
    const s = input.search;
    where.OR = [
      { shipperFacilityName: { contains: s, mode: 'insensitive' } },
      { receiverFacilityName: { contains: s, mode: 'insensitive' } },
      { manifestNumber: { contains: s, mode: 'insensitive' } },
    ];
  }

  const [snapshots, total] = await Promise.all([
    db.transferSnapshot.findMany({
      where,
      orderBy: { estimatedDepartureDateTime: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.transferSnapshot.count({ where }),
  ]);

  const items = snapshots.map(formatSnapshotToTransfer);
  const totalPages = Math.ceil(total / input.pageSize);

  return { items, total, page: input.page, pageSize: input.pageSize, totalPages };
}

export const transfersRouter = createTRPCRouter({
  /**
   * Get incoming transfers for a facility.
   */
  getIncoming: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      return queryTransferSnapshots(ctx.prisma, ctx.facility.id, 'incoming', input);
    }),

  /**
   * Get outgoing transfers for a facility.
   */
  getOutgoing: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      return queryTransferSnapshots(ctx.prisma, ctx.facility.id, 'outgoing', input);
    }),

  /**
   * Get rejected transfers for a facility.
   */
  getRejected: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      return queryTransferSnapshots(ctx.prisma, ctx.facility.id, 'rejected', input);
    }),

  /**
   * Get deliveries within a transfer.
   *
   * DB-first: reads from TransferDeliveryRecord (drilled by transfer-sync cron).
   * Falls back to live Metrc only when no rows exist for the transfer yet,
   * and write-throughs the live response into the snapshot so the next open
   * pays zero Metrc calls (lazy backfill / self-healing).
   *
   * DB errors propagate; only an empty result triggers the live fallback.
   * Write-through is best-effort — a failed upsert never blocks the response.
   */
  getDeliveries: facilityProcedure
    .input(z.object({ facilityId: z.string(), transferId: z.number() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Fetch parent + deliveries together so we know whether to write-through.
      // No parent → header sync hasn't seen this transfer yet → can't persist
      // child rows (FK constraint), but the user still gets the live response.
      const parent = await ctx.prisma.transferSnapshot.findFirst({
        where: { facilityId: ctx.facility.id, metrcTransferId: input.transferId },
        include: { deliveries: true },
      });
      if (parent && parent.deliveries.length > 0) {
        const { transferDeliveryToMetrc } = await import('@/services/metrc/snapshot-utils');
        return parent.deliveries.map(transferDeliveryToMetrc).map(formatDelivery);
      }

      const client = getMetrcClient(facility);
      try {
        const deliveries = await client.getTransferDeliveries(input.transferId);

        // Lazy backfill: persist the live response so the next open hits the DB.
        if (parent && deliveries.length > 0) {
          try {
            const { upsertTransferDeliveriesFromLive } = await import('@/services/metrc/snapshot-utils');
            await upsertTransferDeliveriesFromLive(ctx.prisma, parent.id, deliveries);
          } catch (writeErr) {
            console.warn('[transfers.getDeliveries] write-through failed:', writeErr);
          }
        }

        return deliveries.map(formatDelivery);
      } catch (err) {
        // Metrc returns 401 on /transfers/v2/{id}/deliveries for incoming transfers
        // (receiver's license can't access the transfer-level delivery list).
        const isAuthError = err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 401;
        if (!isAuthError) throw err;

        // Preferred fallback: read from transfer_delivery_records (populated by the
        // delivery-sync cron). Coverage is incomplete on older transfers — we synthesize
        // from transfer_snapshots columns when no records exist for the transfer.
        const snapshot = await ctx.prisma.transferSnapshot.findFirst({
          where: { facilityId: ctx.facility.id, metrcTransferId: input.transferId },
          include: { deliveries: true },
        });
        if (!snapshot) return [];

        if (snapshot.deliveries.length > 0) {
          return snapshot.deliveries.map((d) => ({
            id: d.metrcDeliveryId,
            recipientFacilityName: d.recipientFacilityName,
            recipientFacilityLicense: d.recipientFacilityLicenseNumber,
            shipmentTypeName: d.shipmentTypeName ?? 'Transfer',
            estimatedDepartureDateTime: d.estimatedDepartureDateTime ?? '',
            estimatedArrivalDateTime: d.estimatedArrivalDateTime ?? '',
            receivedDateTime: d.receivedDateTime ?? null,
            totalPackages: d.totalPackages,
            totalPrice: d.totalPrice ? Number(d.totalPrice) : null,
            plannedRoute: d.plannedRoute ?? '',
            grossWeight: d.grossWeight ? Number(d.grossWeight) : null,
            grossUnitOfWeight: d.grossUnitOfWeightName ?? null,
          }));
        }

        // No detailed delivery records for this transfer (delivery sync gap).
        // Synthesize a single summary delivery from the transfer-level columns
        // so the operator at least sees the manifest received & package count
        // instead of "No deliveries found".
        return [{
          id: input.transferId, // synthetic — real DeliveryId not stored
          recipientFacilityName: snapshot.receiverFacilityName ?? '',
          recipientFacilityLicense: snapshot.receiverFacilityLicenseNumber ?? '',
          shipmentTypeName: 'Transfer',
          estimatedDepartureDateTime: snapshot.estimatedDepartureDateTime,
          estimatedArrivalDateTime: snapshot.estimatedArrivalDateTime,
          receivedDateTime: snapshot.receivedDateTime,
          totalPackages: snapshot.packageCount,
          totalPrice: null,
          plannedRoute: '',
          grossWeight: null,
          grossUnitOfWeight: null,
        }];
      }
    }),

  /**
   * Get packages within a delivery.
   *
   * DB-first: reads from TransferPackageRecord (drilled by transfer-sync cron).
   * Falls back to live Metrc only when no rows exist for the delivery yet.
   *
   * Live optimization preserved: try the /packages/wholesale endpoint FIRST —
   * it returns all standard package fields PLUS ShipperWholesalePrice /
   * ReceiverWholesalePrice. Falls back to the regular /packages endpoint if
   * wholesale isn't available.
   */
  getDeliveryPackages: facilityProcedure
    .input(z.object({ facilityId: z.string(), deliveryId: z.number() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Fetch parent delivery + packages together so we know whether to
      // write-through. No parent → cron hasn't drilled this delivery yet →
      // can't persist child rows, but user still gets the live response.
      const parent = await ctx.prisma.transferDeliveryRecord.findFirst({
        where: { metrcDeliveryId: input.deliveryId },
        include: { packages: true },
      });
      if (parent && parent.packages.length > 0) {
        const { transferPackageToMetrcDeliveryPackage } = await import('@/services/metrc/snapshot-utils');
        return parent.packages.map(transferPackageToMetrcDeliveryPackage).map(formatDeliveryPackage);
      }

      const writeThrough = async (livePackages: import('@/services/metrc/types').MetrcDeliveryPackage[]) => {
        if (!parent || livePackages.length === 0) return;
        try {
          const { upsertTransferPackagesFromLive } = await import('@/services/metrc/snapshot-utils');
          await upsertTransferPackagesFromLive(ctx.prisma, parent.id, livePackages);
        } catch (writeErr) {
          console.warn('[transfers.getDeliveryPackages] write-through failed:', writeErr);
        }
      };

      const client = getMetrcClient(facility);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = client as any;

      // Live fallback (DB had no rows). Try wholesale endpoint first — it's a
      // superset of the regular packages endpoint and includes wholesale prices.
      if (typeof clientAny.getDeliveryPackagesWholesale === 'function') {
        try {
          const wholesalePackages = await clientAny.getDeliveryPackagesWholesale(input.deliveryId) as Array<
            Record<string, unknown> & { PackageLabel: string; ShipperWholesalePrice?: number | null; ReceiverWholesalePrice?: number | null }
          >;

          if (wholesalePackages.length > 0) {
            // Normalize the wholesale-only price fields onto the standard
            // `WholesalePrice` slot before persisting — otherwise the lazy
            // backfill stores null and the next (DB-served) open silently
            // drops the price the first open showed.
            const normalized = wholesalePackages.map((wp) => ({
              ...wp,
              WholesalePrice: wp.WholesalePrice ?? wp.ReceiverWholesalePrice ?? wp.ShipperWholesalePrice ?? null,
            })) as unknown as import('@/services/metrc/types').MetrcDeliveryPackage[];
            await writeThrough(normalized);

            return wholesalePackages.map((wp) => {
              const formatted = formatDeliveryPackage(wp as unknown as import('@/services/metrc/types').MetrcDeliveryPackage);
              const price = wp.ReceiverWholesalePrice ?? wp.ShipperWholesalePrice;
              if (price != null) formatted.wholesalePrice = price;
              return formatted;
            });
          }
        } catch {
          // Wholesale endpoint failed — fall through to regular endpoint
        }
      }

      // Regular packages endpoint
      try {
        const packages = await client.getDeliveryPackages(input.deliveryId);
        if (packages.length > 0) {
          await writeThrough(packages);
          return packages.map(formatDeliveryPackage);
        }
      } catch {
        // Fall through to DB fallback. Metrc commonly 401s for receiver-side
        // package detail on incoming transfers (same auth pattern as deliveries).
      }

      // DB fallback: read CSV-imported transfer_line_items (populated via the
      // operator's Metrc CSV exports). Useful for historical incoming transfers
      // where the live API access window has closed and snapshot tables don't
      // have package detail.
      //
      // input.deliveryId may be either a real metrcDeliveryId or — for transfers
      // synthesized by getDeliveries — the metrcTransferId itself. Try both
      // lookups; whichever finds the parent manifest wins.
      let manifestNumber: string | null = null;
      const realDelivery = await ctx.prisma.transferDeliveryRecord.findFirst({
        where: {
          metrcDeliveryId: input.deliveryId,
          transfer: { facilityId: ctx.facility.id },
        },
        select: { transfer: { select: { manifestNumber: true } } },
      });
      if (realDelivery) {
        manifestNumber = realDelivery.transfer.manifestNumber;
      } else {
        const syntheticParent = await ctx.prisma.transferSnapshot.findFirst({
          where: { facilityId: ctx.facility.id, metrcTransferId: input.deliveryId },
          select: { manifestNumber: true },
        });
        manifestNumber = syntheticParent?.manifestNumber ?? null;
      }
      if (!manifestNumber) return [];

      const lines = await ctx.prisma.transferLineItem.findMany({
        where: { facilityId: ctx.facility.id, manifestNumber, isVoided: false },
        select: {
          packageLabel: true, itemName: true, itemCategory: true,
          shippedQuantity: true, shippedUnitOfMeasure: true,
          receivedQuantity: true, receivedUnitOfMeasure: true,
          shipperWholesalePrice: true, receiverWholesalePrice: true,
        },
      });

      return lines.map((line, idx) => ({
        packageId: idx, // synthetic — CSV line items don't carry the Metrc package id
        packageLabel: line.packageLabel ?? '',
        itemName: line.itemName,
        itemCategory: line.itemCategory,
        strainName: '', // not captured in transfer_line_items
        quantity: line.receivedQuantity ?? line.shippedQuantity ?? 0,
        unitOfMeasure: line.receivedUnitOfMeasure ?? line.shippedUnitOfMeasure ?? '',
        wholesalePrice: line.receiverWholesalePrice ?? line.shipperWholesalePrice ?? null,
        shipmentPackageState: 'Accepted',
        labTestingState: '',
      }));
    }),

  /**
   * Get a summary of transfers: incoming/outgoing/rejected counts, total packages, and recent transfers.
   */
  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const { getIncomingTransfersFromDb, getOutgoingTransfersFromDb, getRejectedTransfersFromDb } = await import('@/services/metrc/snapshot-utils');
      const [incoming, outgoing, rejected] = await Promise.all([
        getIncomingTransfersFromDb(ctx.prisma, ctx.facility.id),
        getOutgoingTransfersFromDb(ctx.prisma, ctx.facility.id),
        getRejectedTransfersFromDb(ctx.prisma, ctx.facility.id),
      ]);

      const allFormatted = [
        ...incoming.map(formatTransfer),
        ...outgoing.map(formatTransfer),
      ];

      const totalPackageCount = allFormatted.reduce((sum, t) => sum + t.packageCount, 0);

      const recentTransfers = allFormatted
        .sort((a, b) =>
          new Date(b.estimatedDepartureDateTime).getTime() -
          new Date(a.estimatedDepartureDateTime).getTime()
        )
        .slice(0, 5);

      return {
        incomingCount: incoming.length,
        outgoingCount: outgoing.length,
        rejectedCount: rejected.length,
        totalPackageCount,
        recentTransfers,
      };
    }),

  /**
   * Create an outgoing transfer (preview -> confirm -> execute)
   */
  createOutgoingTransfer: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      receiverFacilityLicenseNumber: z.string().min(1).max(100),
      transferTypeName: z.string().min(1).max(200),
      estimatedDepartureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      estimatedArrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      packages: z.array(z.object({
        packageLabel: z.string().min(1).max(100),
        wholesalePrice: z.number().nonnegative().optional(),
      })).min(1).max(50),
      transporter: z.object({
        licenseNumber: z.string().min(1).max(100),
        departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }).optional(),
      confirmed: z.boolean().default(false),
    }).refine(
      (data) => data.estimatedArrivalDate >= data.estimatedDepartureDate,
      { message: 'Arrival date must be on or after departure date', path: ['estimatedArrivalDate'] },
    ))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate no duplicate package labels
      const labels = input.packages.map(p => p.packageLabel);
      const uniqueLabels = new Set(labels);
      if (uniqueLabels.size !== labels.length) {
        const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Duplicate package label(s): ${Array.from(new Set(dupes)).join(', ')}`,
        });
      }

      // Validate packages exist
      const activePackages = await client.getActivePackages();
      const packageMap = new Map(activePackages.map(p => [p.Label, p]));
      const missing = input.packages.filter(p => !packageMap.get(p.packageLabel));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Package(s) not found: ${missing.map(m => m.packageLabel).join(', ')}`,
        });
      }

      if (!input.confirmed) {
        const preview = {
          transferTypeName: input.transferTypeName,
          receiverFacilityLicenseNumber: input.receiverFacilityLicenseNumber,
          packageCount: input.packages.length,
          packages: input.packages.map(p => ({
            label: p.packageLabel,
            itemName: packageMap.get(p.packageLabel)?.ItemName ?? 'Unknown',
            wholesalePrice: p.wholesalePrice,
          })),
          estimatedDepartureDate: input.estimatedDepartureDate,
          estimatedArrivalDate: input.estimatedArrivalDate,
          transporter: input.transporter ?? null,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'TRANSFER_CREATE_OUTGOING',
            status: 'PREVIEWING',
            targetType: 'TRANSFER',
            targetIds: input.packages.map(p => p.packageLabel),
            targetCount: input.packages.length,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      const outgoingBefore = await writeClient.getOutgoingTransfers();
      const beforeState = { outgoingCount: outgoingBefore.length };

      const payload = [{
        TransferTypeName: input.transferTypeName,
        RecipientFacilityLicenseNumber: input.receiverFacilityLicenseNumber,
        EstimatedDepartureDateTime: input.estimatedDepartureDate,
        EstimatedArrivalDateTime: input.estimatedArrivalDate,
        Packages: input.packages.map(p => ({
          PackageLabel: p.packageLabel,
          WholesalePrice: p.wholesalePrice ?? 0,
        })),
        ...(input.transporter ? {
          Transporters: [{
            TransporterFacilityLicenseNumber: input.transporter.licenseNumber,
            EstimatedDepartureDateTime: input.transporter.departureDate,
            EstimatedArrivalDateTime: input.transporter.arrivalDate,
          }],
        } : {}),
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'TRANSFER_CREATE_OUTGOING',
        targetType: 'TRANSFER',
        targetIds: input.packages.map(p => p.packageLabel),
        targetCount: input.packages.length,
        executeFn: () => writeClient.createExternalOutgoingTransfers(payload as unknown as Record<string, unknown>[]),
        beforeState,
        verifyFn: async () => {
          const outgoingAfter = await writeClient.getOutgoingTransfers();
          return checkOutgoingTransferCreate(outgoingBefore.length, outgoingAfter.length);
        },
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, packageCount: input.packages.length, verified: result.verified };
    }),

  /**
   * Diagnostic endpoint: bypasses cache and logs raw Metrc API response shape.
   * Helps audit whether the v2 patch is correctly unwrapping transfer data.
   */
  diagnose: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;

      // Import raw factory to build an uncached client for diagnostics
      const { MetrcClient } = await import('@metrc-manager-3000/client');
      const { patchClientForV2 } = await import('@/services/metrc/metrc-v2-client');
      const { decrypt } = await import('@/lib/encryption');

      const environment = facility.metrcEnvironment as 'sandbox' | 'production';
      if (environment !== 'sandbox' && environment !== 'production') {
        return {
          environment,
          message: 'Diagnostics only available for sandbox/production',
          incoming: null,
          outgoing: null,
          rejected: null,
        };
      }

      const encVendor = environment === 'sandbox'
        ? facility.encryptedSandboxVendorApiKey
        : facility.encryptedVendorApiKey;
      const encUser = environment === 'sandbox'
        ? facility.encryptedSandboxUserApiKey
        : facility.encryptedUserApiKey;

      if (!encVendor || !encUser) {
        return {
          environment,
          message: 'Missing API credentials',
          incoming: null,
          outgoing: null,
          rejected: null,
        };
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

      const results: Record<string, unknown> = {
        facilityId: facility.id,
        facilityName: facility.name,
        stateCode: facility.stateCode,
        environment,
        timestamp: new Date().toISOString(),
      };

      // Diagnostic admin-only: bypasses cache and snapshots to inspect raw Metrc responses. Not a page-load hot path.
      for (const [label, fn] of [
        ['incoming', () => rawClient.getIncomingTransfers()],
        ['outgoing', () => rawClient.getOutgoingTransfers()],
        ['rejected', () => rawClient.getRejectedTransfers()],
      ] as const) {
        try {
          const data = await fn();
          results[label] = {
            count: Array.isArray(data) ? data.length : 'not-array',
            type: typeof data,
            isArray: Array.isArray(data),
            sample: Array.isArray(data) && data.length > 0
              ? { Id: data[0].Id, ManifestNumber: data[0].ManifestNumber }
              : null,
          };
        } catch (err: unknown) {
          results[label] = {
            error: err instanceof Error ? err.message : String(err),
            type: 'error',
          };
        }
      }

      // Diagnostic admin-only: compare cached-client output to raw responses above. Not a page-load hot path.
      try {
        const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
        const cachedClient = getMetrcClient(facility);
        const cachedIncoming = await cachedClient.getIncomingTransfers();
        const cachedOutgoing = await cachedClient.getOutgoingTransfers();
        results.cached = {
          incoming: Array.isArray(cachedIncoming) ? cachedIncoming.length : 'not-array',
          outgoing: Array.isArray(cachedOutgoing) ? cachedOutgoing.length : 'not-array',
        };
      } catch (err: unknown) {
        results.cached = { error: err instanceof Error ? err.message : String(err) };
      }

      // Check snapshot counts
      const [snapshotTotal, snapshotActive] = await Promise.all([
        ctx.prisma.transferSnapshot.count({ where: { facilityId: facility.id } }),
        ctx.prisma.transferSnapshot.count({ where: { facilityId: facility.id, isActive: true } }),
      ]);
      results.snapshots = { total: snapshotTotal, active: snapshotActive, completed: snapshotTotal - snapshotActive };

      console.log('[transfers:diagnose]', JSON.stringify(results, null, 2));
      return results;
    }),

  /**
   * Query historical transfers (active + completed) from the snapshot table.
   */
  getHistory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      direction: z.enum(['incoming', 'outgoing', 'rejected', 'all']).default('all'),
      status: z.enum(['active', 'completed', 'all']).default('all'),
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // 1) Snapshot rows — operational state. Always queried first; these
      //    are the authoritative source when present.
      const snapshotWhere: Prisma.TransferSnapshotWhereInput = {
        facilityId: input.facilityId,
      };
      if (input.direction !== 'all') snapshotWhere.direction = input.direction;
      if (input.status === 'active') snapshotWhere.isActive = true;
      if (input.status === 'completed') snapshotWhere.isActive = false;
      if (input.search) {
        snapshotWhere.OR = [
          { manifestNumber: { contains: input.search, mode: 'insensitive' } },
          { shipperFacilityName: { contains: input.search, mode: 'insensitive' } },
          { receiverFacilityName: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      const [snapshots, snapshotTotal] = await Promise.all([
        ctx.prisma.transferSnapshot.findMany({
          where: snapshotWhere,
          orderBy: { lastModified: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.transferSnapshot.count({ where: snapshotWhere }),
      ]);

      const snapshotItems = snapshots.map(formatSnapshotToTransfer);

      // 2) CSV-imported line items — surface as synthesized manifest-level
      //    rows so historical transfers don't disappear when the live cron
      //    is budget-blocked. Skip when status filter excludes 'completed'
      //    (synthesized rows are always historical/inactive) or when
      //    direction is rejected (line items don't track rejection).
      const includeCsv = input.status !== 'active' && input.direction !== 'rejected';
      let csvItems: FormattedTransfer[] = [];
      let csvTotal = 0;
      if (includeCsv) {
        // Get all snapshot manifest numbers across the *whole* facility for
        // dedup — not just the current page — so a CSV row never appears for
        // a manifest that has live snapshot fidelity elsewhere.
        const dedupRows = await ctx.prisma.transferSnapshot.findMany({
          where: { facilityId: input.facilityId },
          select: { manifestNumber: true },
        });
        const excludeManifests = new Set(dedupRows.map((r) => r.manifestNumber));

        // Page through CSV rows starting where snapshot rows end. If snapshot
        // already filled this page, skip the CSV query entirely.
        const snapshotPagesUsed = Math.ceil(snapshotTotal / input.pageSize);
        const csvPage = Math.max(1, input.page - snapshotPagesUsed);
        const remainingOnThisPage = Math.max(0, input.pageSize - snapshotItems.length);

        if (remainingOnThisPage > 0) {
          const csv = await synthesizeHistoricalTransfersFromLineItems(
            ctx.prisma,
            input.facilityId,
            facility.licenseNumber,
            {
              direction: input.direction,
              search: input.search,
              excludeManifests,
              page: csvPage,
              pageSize: remainingOnThisPage,
            },
          );
          csvItems = csv.items;
          csvTotal = csv.total;
        } else {
          // Page is past where snapshots end and into CSV territory.
          const csv = await synthesizeHistoricalTransfersFromLineItems(
            ctx.prisma,
            input.facilityId,
            facility.licenseNumber,
            {
              direction: input.direction,
              search: input.search,
              excludeManifests,
              page: csvPage,
              pageSize: input.pageSize,
            },
          );
          csvItems = csv.items;
          csvTotal = csv.total;
        }
      }

      const items = [...snapshotItems, ...csvItems];
      const total = snapshotTotal + csvTotal;

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  /**
   * Count completed (historical) transfers for KPI display. Includes a
   * `csvManifests` count of distinct manifest numbers in TransferLineItem
   * that are NOT already represented in TransferSnapshot — used by the
   * Incoming/Outgoing/Rejected empty states to point operators at the
   * History tab when live sync data is missing but CSV history exists.
   */
  getHistoryCount: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [completed, total, snapshotManifests] = await Promise.all([
        ctx.prisma.transferSnapshot.count({
          where: { facilityId: input.facilityId, isActive: false },
        }),
        ctx.prisma.transferSnapshot.count({
          where: { facilityId: input.facilityId },
        }),
        ctx.prisma.transferSnapshot.findMany({
          where: { facilityId: input.facilityId },
          select: { manifestNumber: true },
        }),
      ]);

      const excludeManifests = snapshotManifests.map((r) => r.manifestNumber);
      const excludeClause = excludeManifests.length > 0
        ? Prisma.sql`AND "manifestNumber" != ALL(${excludeManifests})`
        : Prisma.empty;

      const csvRows = await ctx.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "manifestNumber")::bigint as count
        FROM transfer_line_items
        WHERE "facilityId" = ${input.facilityId}
          AND "isVoided" = false
          ${excludeClause}
      `;

      return {
        completed,
        total,
        /** Distinct manifests in the CSV import not already represented in the snapshot. */
        csvManifests: Number(csvRows[0]?.count ?? 0),
      };
    }),

  // =========================================================================
  // Historical Transfer CSV Import (Example Farms)
  // =========================================================================

  /**
   * Import historical transfer data from CSV.
   * Preview → Confirm → Execute pattern.
   */
  importHistoricalTransfers: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      csvText: z.string().min(1),
      csvType: z.enum(['affiliated', 'wholesale']),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      // Parse CSV
      const parseResult = input.csvType === 'affiliated'
        ? parseAffiliatedTransferCSV(input.csvText)
        : parseWholesaleTransferCSV(input.csvText);

      if (parseResult.valid.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No valid rows parsed. ${parseResult.errors.length} error(s): ${parseResult.errors.slice(0, 3).map(e => e.message).join('; ')}`,
        });
      }

      // Match facilities — get all org facilities for matching
      const orgFacilities = await ctx.prisma.metrcFacility.findMany({
        where: { organizationId: facility.organizationId, isActive: true },
        select: { id: true, licenseNumber: true, name: true },
      });

      const matchResult = matchFacilities(parseResult.valid, orgFacilities);

      // Compute summary stats
      const dateRange = matchResult.matched.reduce(
        (acc, line) => {
          const dt = line.createdDateTime ?? line.receivedDateTime;
          if (dt) {
            if (!acc.min || dt < acc.min) acc.min = dt;
            if (!acc.max || dt > acc.max) acc.max = dt;
          }
          return acc;
        },
        { min: null as string | null, max: null as string | null },
      );

      const categories = new Map<string, number>();
      for (const line of matchResult.matched) {
        categories.set(line.itemCategory, (categories.get(line.itemCategory) ?? 0) + 1);
      }

      if (!input.confirmed) {
        // Preview mode
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'TRANSFER_IMPORT_CSV',
            status: 'PREVIEWING',
            targetType: 'TRANSFER',
            targetIds: [],
            targetCount: matchResult.matched.length,
            previewData: {
              csvType: input.csvType,
              totalParsed: parseResult.valid.length,
              parseErrors: parseResult.errors.length,
              matched: matchResult.matched.length,
              unmatched: matchResult.unmatched.length,
              dateRange,
              categories: Object.fromEntries(categories),
              unmatchedFacilities: matchResult.unmatchedFacilities.slice(0, 10),
              sampleRows: matchResult.matched.slice(0, 5).map(r => ({
                manifest: r.manifestNumber,
                item: r.itemName,
                category: r.itemCategory,
                shippedQty: r.shippedQuantity,
                origin: r.originFacilityName,
                dest: r.destFacilityName,
              })),
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          status: 'preview' as const,
          preview: {
            totalParsed: parseResult.valid.length,
            parseErrors: parseResult.errors.slice(0, 20),
            matched: matchResult.matched.length,
            unmatched: matchResult.unmatched.length,
            unmatchedFacilities: matchResult.unmatchedFacilities.slice(0, 10),
            dateRange,
            categories: Object.fromEntries(categories),
            sampleRows: matchResult.matched.slice(0, 5).map(r => ({
              manifest: r.manifestNumber,
              item: r.itemName,
              category: r.itemCategory,
              shippedQty: r.shippedQuantity,
              origin: r.originFacilityName,
              dest: r.destFacilityName,
            })),
          },
        };
      }

      // Confirmed — batch insert
      const importBatchId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const CHUNK_SIZE = 500;
      let insertedCount = 0;

      for (let i = 0; i < matchResult.matched.length; i += CHUNK_SIZE) {
        const chunk = matchResult.matched.slice(i, i + CHUNK_SIZE);
        const result = await ctx.prisma.transferLineItem.createMany({
          data: chunk.map(line => ({
            facilityId: line.facilityId,
            manifestNumber: line.manifestNumber,
            originLicenseNumber: line.originLicenseNumber,
            originFacilityName: line.originFacilityName,
            originFacilityType: line.originFacilityType,
            destLicenseNumber: line.destLicenseNumber,
            destFacilityName: line.destFacilityName,
            destFacilityType: line.destFacilityType,
            transferType: line.transferType,
            createdDateTime: line.createdDateTime,
            receivedDateTime: line.receivedDateTime,
            isVoided: line.isVoided,
            packageLabel: line.packageLabel,
            itemName: line.itemName,
            itemCategory: line.itemCategory,
            shippedQuantity: line.shippedQuantity,
            shippedUnitOfMeasure: line.shippedUnitOfMeasure,
            shippedWeight: line.shippedWeight,
            shippedWeightUoM: line.shippedWeightUoM,
            receivedQuantity: line.receivedQuantity,
            receivedUnitOfMeasure: line.receivedUnitOfMeasure,
            receivedWeight: line.receivedWeight,
            receivedWeightUoM: line.receivedWeightUoM,
            countVariancePct: line.countVariancePct,
            weightVariancePct: line.weightVariancePct,
            importSource: `csv_${input.csvType}`,
            importBatchId,
          })),
          skipDuplicates: true,
        });
        insertedCount += result.count;
      }

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'TRANSFER_IMPORT_CSV',
          status: 'COMPLETED',
          targetType: 'TRANSFER',
          targetIds: [importBatchId],
          targetCount: insertedCount,
          executedAt: new Date(),
        },
      });

      return {
        status: 'completed' as const,
        importBatchId,
        insertedCount,
        skippedDuplicates: matchResult.matched.length - insertedCount,
        unmatchedCount: matchResult.unmatched.length,
      };
    }),

  /**
   * Rollback an import batch — delete all rows by importBatchId.
   */
  rollbackImport: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      importBatchId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.prisma.transferLineItem.deleteMany({
        where: {
          facilityId: input.facilityId,
          importBatchId: input.importBatchId,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'TRANSFER_IMPORT_ROLLBACK',
          status: 'COMPLETED',
          targetType: 'TRANSFER',
          targetIds: [input.importBatchId],
          targetCount: deleted.count,
          executedAt: new Date(),
        },
      });

      return { deletedCount: deleted.count };
    }),

  /**
   * List distinct import batches with counts and date ranges.
   */
  getImportHistory: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const batches = await ctx.prisma.transferLineItem.groupBy({
        by: ['importBatchId', 'importSource'],
        where: { facilityId: input.facilityId },
        _count: { id: true },
        _min: { createdDateTime: true, importedAt: true },
        _max: { createdDateTime: true },
        orderBy: { _min: { importedAt: 'desc' } },
      });

      return batches.map(b => ({
        importBatchId: b.importBatchId,
        importSource: b.importSource,
        rowCount: b._count.id,
        dataDateRange: {
          min: b._min.createdDateTime,
          max: b._max.createdDateTime,
        },
        importedAt: b._min.importedAt,
      }));
    }),
});
