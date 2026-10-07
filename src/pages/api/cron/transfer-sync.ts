import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Phase 3 transfer sync. Replaces transfer-snapshot.ts.
 *
 * Fetches incoming/outgoing/rejected transfers into TransferSnapshot, then
 * drills down into deliveries + packages for transfers whose metrcLastModified
 * has changed since the last sync. Completed deliveries (receivedDateTime set)
 * are frozen and never re-walked.
 *
 * Caps transfer drill-down at MAX_DRILLDOWN_CALLS per run to protect the
 * monthly Metrc budget.
 *
 * Railway cron config:
 *   POST /api/cron/transfer-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: every 4 hours
 */

const HEADER_ENDPOINT_KEY = 'transfers.headers';
// Separate watermark for full-mode reconciliation runs. Tracking it lets the
// 4-hourly cron auto-promote to full mode roughly weekly without needing a
// second Railway cron entry. Full mode is what flips stale isActive flags.
const FULL_HEADER_ENDPOINT_KEY = 'transfers.headers.full';
const FULL_MODE_INTERVAL_DAYS = 7;
const MAX_DRILLDOWN_CALLS = 50;

type Direction = 'incoming' | 'outgoing' | 'rejected';

export async function syncFacilityTransfers(
  facility: MetrcFacility,
  opts: { mode?: 'incremental' | 'full' } = {},
) {
  const facilityId = facility.id;
  const client = getMetrcClient(facility);
  const mode = opts.mode ?? 'incremental';
  const now = new Date();

  const watermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: HEADER_ENDPOINT_KEY } },
  });
  const fullWatermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: FULL_HEADER_ENDPOINT_KEY } },
  });

  // Auto-promote to full mode when:
  //   - First-ever run for this facility (no watermark) — needed to seed.
  //   - Last full-mode reconciliation was > FULL_MODE_INTERVAL_DAYS ago.
  // Full mode runs the deactivation pass that flips isActive=false for
  // transfers Metrc no longer returns. Without this auto-promotion, stale
  // flags accumulate forever (root cause of the 5,380 "active" Eastport
  // transfers in prod).
  const fullStaleThreshold = now.getTime() - FULL_MODE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  const fullIsStale = !fullWatermark?.watermark
    || new Date(fullWatermark.watermark).getTime() < fullStaleThreshold;
  const effectiveMode: 'incremental' | 'full' =
    mode === 'full'
      ? 'full'
      : !watermark?.watermark || fullIsStale
        ? 'full'
        : 'incremental';

  let filters: Record<string, string> | undefined;
  if (effectiveMode === 'incremental' && watermark?.watermark) {
    const since = new Date(new Date(watermark.watermark).getTime() - 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    filters = {
      lastModifiedStart: since.toISOString().split('T')[0]!,
      lastModifiedEnd: tomorrow.toISOString().split('T')[0]!,
    };
  }

  console.log(`[TRANSFER-SYNC] ${facility.name}: fetching transfer headers (mode=${effectiveMode})`);
  const [incoming, outgoing, rejected] = await Promise.all([
    client.getIncomingTransfers(filters),
    client.getOutgoingTransfers(filters),
    client.getRejectedTransfers(filters),
  ]);

  const headerEstimate = Math.max(3, Math.ceil((incoming.length + outgoing.length + rejected.length) / 20));
  await incrementBudget(headerEstimate);

  const withDirection: Array<{ t: (typeof incoming)[number]; direction: Direction }> = [
    ...incoming.map(t => ({ t, direction: 'incoming' as const })),
    ...outgoing.map(t => ({ t, direction: 'outgoing' as const })),
    ...rejected.map(t => ({ t, direction: 'rejected' as const })),
  ];

  console.log(
    `[TRANSFER-SYNC] ${facility.name}: ${incoming.length} in / ${outgoing.length} out / ${rejected.length} rej (~${headerEstimate} calls)`,
  );

  // ---- Upsert transfer headers ----
  // Collect upserted rows in-order so we can drive drill-down decisions from them.
  const headerResults: Array<{
    record: Awaited<ReturnType<typeof upsertHeader>>;
    transferLastModified: Date | null;
  }> = [];

  for (const { t, direction } of withDirection) {
    const record = await upsertHeader(facilityId, t, direction, now);
    headerResults.push({
      record,
      transferLastModified: t.LastModified ? new Date(t.LastModified) : null,
    });
  }

  // ---- Full-mode deactivation for headers not seen this run ----
  let deactivated = 0;
  if (effectiveMode === 'full') {
    const seenIds = new Set(withDirection.map(({ t }) => t.Id));
    // Guard: an empty Metrc response is far more likely a transient API
    // failure than "this facility has zero transfers." Skipping the pass
    // protects against a catastrophic mass-deactivation. Old empty-response
    // behavior wrote `notIn: undefined`, which Prisma drops, leaving
    // `where: { facilityId, isActive: true }` matching everything.
    if (seenIds.size > 0) {
      const res = await prisma.transferSnapshot.updateMany({
        where: {
          facilityId,
          isActive: true,
          metrcTransferId: { notIn: Array.from(seenIds) },
        },
        data: { isActive: false, lastSeenAt: now },
      });
      deactivated = res.count;
    } else {
      console.warn(`[TRANSFER-SYNC] ${facility.name}: empty response in full mode — skipping deactivation pass to avoid mass mark-inactive.`);
    }
  }

  // ---- Drill-down: deliveries + packages ----
  let drillCalls = 0;
  let deliveriesUpserted = 0;
  let packagesUpserted = 0;
  let deliveriesSkippedFrozen = 0;

  for (const { record, transferLastModified } of headerResults) {
    if (drillCalls >= MAX_DRILLDOWN_CALLS) {
      console.warn(`[TRANSFER-SYNC] ${facility.name}: drill-down cap hit (${MAX_DRILLDOWN_CALLS}); remainder deferred to next run`);
      break;
    }

    // Only re-walk when the transfer's Metrc LastModified is newer than what we
    // have on any of its existing delivery rows (or no delivery rows exist yet).
    const existingDeliveries = await prisma.transferDeliveryRecord.findMany({
      where: { transferSnapshotId: record.id },
      select: { id: true, metrcDeliveryId: true, isCompleted: true, lastSyncedAt: true },
    });

    const mostRecentDeliverySync = existingDeliveries.reduce<Date | null>((acc, d) => {
      if (!acc || d.lastSyncedAt > acc) return d.lastSyncedAt;
      return acc;
    }, null);

    const needsDrilldown =
      existingDeliveries.length === 0 ||
      !mostRecentDeliverySync ||
      (transferLastModified !== null && transferLastModified > mostRecentDeliverySync);

    if (!needsDrilldown) continue;

    try {
      const deliveries = await client.getTransferDeliveries(record.metrcTransferId);
      drillCalls += 1;
      await incrementBudget(1);

      for (const d of deliveries) {
        if (drillCalls >= MAX_DRILLDOWN_CALLS) break;

        const existing = existingDeliveries.find(x => x.metrcDeliveryId === d.Id);
        // Frozen rule: once completed (receivedDateTime + isCompleted), never re-walk.
        if (existing?.isCompleted) {
          deliveriesSkippedFrozen += 1;
          continue;
        }

        const isCompleted = Boolean(d.ReceivedDateTime);
        const deliveryRecord = await prisma.transferDeliveryRecord.upsert({
          where: {
            transferSnapshotId_metrcDeliveryId: {
              transferSnapshotId: record.id,
              metrcDeliveryId: d.Id,
            },
          },
          update: {
            recipientFacilityLicenseNumber: d.RecipientFacilityLicenseNumber,
            recipientFacilityName: d.RecipientFacilityName,
            shipmentTypeName: d.ShipmentTypeName || null,
            shipmentTransactionType: d.ShipmentTransactionType || null,
            estimatedDepartureDateTime: d.EstimatedDepartureDateTime || null,
            estimatedArrivalDateTime: d.EstimatedArrivalDateTime || null,
            actualDepartureDateTime: d.ActualDepartureDateTime ?? null,
            actualArrivalDateTime: d.ActualArrivalDateTime ?? null,
            receivedDateTime: d.ReceivedDateTime ?? null,
            receivedByName: d.ReceivedByName ?? null,
            grossWeight: d.GrossWeight != null ? new Prisma.Decimal(d.GrossWeight) : null,
            grossUnitOfWeightName: d.GrossUnitOfWeightName ?? null,
            plannedRoute: d.PlannedRoute || null,
            totalPackages: d.TotalPackages ?? 0,
            totalPrice: d.TotalPrice != null ? new Prisma.Decimal(d.TotalPrice) : null,
            isCompleted,
            rawPayload: d as unknown as Prisma.InputJsonValue,
            lastSyncedAt: now,
          },
          create: {
            transferSnapshotId: record.id,
            metrcDeliveryId: d.Id,
            recipientFacilityLicenseNumber: d.RecipientFacilityLicenseNumber,
            recipientFacilityName: d.RecipientFacilityName,
            shipmentTypeName: d.ShipmentTypeName || null,
            shipmentTransactionType: d.ShipmentTransactionType || null,
            estimatedDepartureDateTime: d.EstimatedDepartureDateTime || null,
            estimatedArrivalDateTime: d.EstimatedArrivalDateTime || null,
            actualDepartureDateTime: d.ActualDepartureDateTime ?? null,
            actualArrivalDateTime: d.ActualArrivalDateTime ?? null,
            receivedDateTime: d.ReceivedDateTime ?? null,
            receivedByName: d.ReceivedByName ?? null,
            grossWeight: d.GrossWeight != null ? new Prisma.Decimal(d.GrossWeight) : null,
            grossUnitOfWeightName: d.GrossUnitOfWeightName ?? null,
            plannedRoute: d.PlannedRoute || null,
            totalPackages: d.TotalPackages ?? 0,
            totalPrice: d.TotalPrice != null ? new Prisma.Decimal(d.TotalPrice) : null,
            isCompleted,
            rawPayload: d as unknown as Prisma.InputJsonValue,
          },
        });
        deliveriesUpserted += 1;

        // Walk packages for this delivery unless it was already completed pre-this-run
        try {
          const deliveryPackages = await client.getDeliveryPackages(d.Id);
          drillCalls += 1;
          await incrementBudget(1);

          for (const p of deliveryPackages) {
            await prisma.transferPackageRecord.upsert({
              where: {
                deliveryRecordId_metrcPackageId: {
                  deliveryRecordId: deliveryRecord.id,
                  metrcPackageId: p.PackageId,
                },
              },
              update: {
                packageLabel: p.PackageLabel,
                packageType: p.PackageType || null,
                itemName: p.ItemName,
                itemStrainName: p.ItemStrainName || null,
                itemCategory: p.ItemCategory || null,
                quantity: new Prisma.Decimal(p.Quantity ?? 0),
                unitOfMeasureName: p.UnitOfMeasureName || null,
                grossWeight: p.GrossWeight != null ? new Prisma.Decimal(p.GrossWeight) : null,
                grossUnitOfWeightName: p.GrossUnitOfWeightName ?? null,
                wholesalePrice: p.WholesalePrice != null ? new Prisma.Decimal(p.WholesalePrice) : null,
                shipmentPackageState: p.ShipmentPackageState || null,
                labTestingState: p.LabTestingState || null,
                remediationDate: p.RemediationDate ?? null,
                rawPayload: p as unknown as Prisma.InputJsonValue,
                lastSyncedAt: now,
              },
              create: {
                deliveryRecordId: deliveryRecord.id,
                metrcPackageId: p.PackageId,
                packageLabel: p.PackageLabel,
                packageType: p.PackageType || null,
                itemName: p.ItemName,
                itemStrainName: p.ItemStrainName || null,
                itemCategory: p.ItemCategory || null,
                quantity: new Prisma.Decimal(p.Quantity ?? 0),
                unitOfMeasureName: p.UnitOfMeasureName || null,
                grossWeight: p.GrossWeight != null ? new Prisma.Decimal(p.GrossWeight) : null,
                grossUnitOfWeightName: p.GrossUnitOfWeightName ?? null,
                wholesalePrice: p.WholesalePrice != null ? new Prisma.Decimal(p.WholesalePrice) : null,
                shipmentPackageState: p.ShipmentPackageState || null,
                labTestingState: p.LabTestingState || null,
                remediationDate: p.RemediationDate ?? null,
                rawPayload: p as unknown as Prisma.InputJsonValue,
              },
            });
            packagesUpserted += 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[TRANSFER-SYNC] ${facility.name}: delivery ${d.Id} packages failed: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TRANSFER-SYNC] ${facility.name}: transfer ${record.metrcTransferId} deliveries failed: ${msg}`);
    }
  }

  await prisma.syncWatermark.upsert({
    where: { facilityId_endpoint: { facilityId, endpoint: HEADER_ENDPOINT_KEY } },
    update: {
      watermark: now.toISOString(),
      lastRunAt: now,
      lastRunStatus: 'success',
      runCount: { increment: 1 },
    },
    create: {
      facilityId,
      endpoint: HEADER_ENDPOINT_KEY,
      watermark: now.toISOString(),
      lastRunAt: now,
      lastRunStatus: 'success',
      runCount: 1,
    },
  });

  // Track when full-mode reconciliation last ran so the next 4-hourly run
  // doesn't re-trigger the (expensive) full pass until FULL_MODE_INTERVAL_DAYS
  // has elapsed.
  if (effectiveMode === 'full') {
    await prisma.syncWatermark.upsert({
      where: { facilityId_endpoint: { facilityId, endpoint: FULL_HEADER_ENDPOINT_KEY } },
      update: {
        watermark: now.toISOString(),
        lastRunAt: now,
        lastRunStatus: 'success',
        runCount: { increment: 1 },
      },
      create: {
        facilityId,
        endpoint: FULL_HEADER_ENDPOINT_KEY,
        watermark: now.toISOString(),
        lastRunAt: now,
        lastRunStatus: 'success',
        runCount: 1,
      },
    });
  }

  const headerCount = withDirection.length;
  console.log(
    `[TRANSFER-SYNC] ${facility.name}: upserted ${headerCount} headers, ${deliveriesUpserted} deliveries (${deliveriesSkippedFrozen} frozen), ${packagesUpserted} packages, deactivated ${deactivated}. Drill-calls=${drillCalls}/${MAX_DRILLDOWN_CALLS}`,
  );

  return {
    facilityId,
    facilityName: facility.name,
    status: 'success' as const,
    count: headerCount,
    deactivated,
    deliveries: deliveriesUpserted,
    packages: packagesUpserted,
    drillCalls,
    mode: effectiveMode,
  };
}

async function upsertHeader(facilityId: string, t: import('@/services/metrc/types').MetrcTransfer, direction: Direction, now: Date) {
  return prisma.transferSnapshot.upsert({
    where: {
      facilityId_metrcTransferId_direction: {
        facilityId,
        metrcTransferId: t.Id,
        direction,
      },
    },
    update: {
      manifestNumber: t.ManifestNumber,
      shipperFacilityLicenseNumber: t.ShipperFacilityLicenseNumber,
      shipperFacilityName: t.ShipperFacilityName,
      receiverFacilityLicenseNumber: t.ReceiverFacilityLicenseNumber,
      receiverFacilityName: t.ReceiverFacilityName,
      transporterFacilityLicenseNumber: t.TransporterFacilityLicenseNumber || null,
      transporterFacilityName: t.TransporterFacilityName || null,
      deliveryCount: t.DeliveryCount,
      receivedDeliveryCount: t.ReceivedDeliveryCount,
      packageCount: t.PackageCount,
      receivedPackageCount: t.ReceivedPackageCount,
      containsDonation: t.ContainsDonation,
      containsTradeSample: t.ContainsTradeSample,
      containsTestingSample: t.ContainsTestingSample,
      estimatedDepartureDateTime: t.EstimatedDepartureDateTime,
      estimatedArrivalDateTime: t.EstimatedArrivalDateTime,
      receivedDateTime: t.ReceivedDateTime,
      createdDateTime: t.CreatedDateTime,
      lastModified: t.LastModified,
      metrcLastModified: t.LastModified ? new Date(t.LastModified) : null,
      rawPayload: t as unknown as Prisma.InputJsonValue,
      lastSeenAt: now,
      lastSyncedAt: now,
      isActive: true,
    },
    create: {
      facilityId,
      metrcTransferId: t.Id,
      direction,
      manifestNumber: t.ManifestNumber,
      shipperFacilityLicenseNumber: t.ShipperFacilityLicenseNumber,
      shipperFacilityName: t.ShipperFacilityName,
      receiverFacilityLicenseNumber: t.ReceiverFacilityLicenseNumber,
      receiverFacilityName: t.ReceiverFacilityName,
      transporterFacilityLicenseNumber: t.TransporterFacilityLicenseNumber || null,
      transporterFacilityName: t.TransporterFacilityName || null,
      deliveryCount: t.DeliveryCount,
      receivedDeliveryCount: t.ReceivedDeliveryCount,
      packageCount: t.PackageCount,
      receivedPackageCount: t.ReceivedPackageCount,
      containsDonation: t.ContainsDonation,
      containsTradeSample: t.ContainsTradeSample,
      containsTestingSample: t.ContainsTestingSample,
      estimatedDepartureDateTime: t.EstimatedDepartureDateTime,
      estimatedArrivalDateTime: t.EstimatedArrivalDateTime,
      receivedDateTime: t.ReceivedDateTime,
      createdDateTime: t.CreatedDateTime,
      lastModified: t.LastModified,
      metrcLastModified: t.LastModified ? new Date(t.LastModified) : null,
      rawPayload: t as unknown as Prisma.InputJsonValue,
      firstSeenAt: now,
      lastSeenAt: now,
      isActive: true,
    },
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: { isActive: true, metrcEnvironment: { in: ['production', 'sandbox'] }, organizationId: { in: prodOrgIds } },
    });

    const budgetCheck = await checkBudget();
    if (budgetCheck.status === 'sync_blocked' || budgetCheck.status === 'all_blocked') {
      return res.status(200).json({ results: [], budget: budgetCheck, skipped: true });
    }

    const mode = (req.query.mode === 'full' ? 'full' : 'incremental') as 'full' | 'incremental';
    const results: Array<Record<string, unknown>> = [];

    for (const facility of facilities) {
      const { allowed, budget } = await canSync();
      if (!allowed) {
        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'budget_blocked',
          errorMessage: `Monthly budget at ${budget.percentUsed}%`,
        });
        break;
      }

      try {
        const result = await syncFacilityTransfers(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TRANSFER-SYNC] ${facility.name}: FAILED — ${msg}`);
        if (msg.includes('429') || msg.includes('rate limit')) {
          results.push({ facilityId: facility.id, facilityName: facility.name, status: 'rate_limited', errorMessage: msg });
          break;
        }
        results.push({ facilityId: facility.id, facilityName: facility.name, status: 'failed', errorMessage: msg });
      }
    }

    const finalBudget = await checkBudget();
    return res.status(200).json({ results, budget: finalBudget });
  } catch (err) {
    console.error('[TRANSFER-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
