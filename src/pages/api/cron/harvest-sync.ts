import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Daily cron for harvest snapshot sync (active + on-hold + inactive).
 *
 * Phase 2 re-architecture: syncs all harvest states into HarvestSnapshot table
 * using the same watermark pattern as package-sync.
 */

const ENDPOINT_KEY = 'harvests.active';

export async function syncFacilityHarvests(facility: MetrcFacility, opts: { mode?: 'incremental' | 'full' } = {}) {
  const facilityId = facility.id;
  const client = getMetrcClient(facility);
  const mode = opts.mode ?? 'incremental';
  const now = new Date();

  const watermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
  });

  const effectiveMode: 'incremental' | 'full' =
    mode === 'incremental' && !watermark?.watermark ? 'full' : mode;

  let filters: Record<string, string> | undefined;
  if (effectiveMode === 'incremental' && watermark?.watermark) {
    const since = new Date(new Date(watermark.watermark).getTime() - 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    filters = {
      lastModifiedStart: since.toISOString().split('T')[0]!,
      lastModifiedEnd: tomorrow.toISOString().split('T')[0]!,
    };
  }

  console.log(`[HARVEST-SYNC] ${facility.name}: fetching harvests (mode=${effectiveMode}${filters ? `, since=${filters.lastModifiedStart}` : ''})...`);

  // Fetch active + on-hold + inactive in parallel
  const [active, onHold, inactive] = await Promise.all([
    client.getActiveHarvests(filters),
    client.getOnHoldHarvests(filters),
    effectiveMode === 'full' || filters
      ? client.getInactiveHarvests(filters)
      : Promise.resolve([]),
  ]);
  const allHarvests = [...active, ...onHold, ...inactive];

  const estimatedCalls = Math.max(1, Math.ceil(active.length / 20)) +
    Math.max(1, Math.ceil(onHold.length / 20)) +
    (inactive.length > 0 ? Math.max(1, Math.ceil(inactive.length / 20)) : 0);
  await incrementBudget(estimatedCalls);

  console.log(`[HARVEST-SYNC] ${facility.name}: fetched ${active.length} active, ${onHold.length} on-hold, ${inactive.length} inactive (~${estimatedCalls} API calls)`);

  if (allHarvests.length === 0) {
    await updateWatermark(facilityId, now);
    return { facilityId, facilityName: facility.name, status: 'success', count: 0, mode: effectiveMode };
  }

  // Track active IDs for deactivation in full mode
  const activeIds = effectiveMode === 'full'
    ? new Set<number>([...active, ...onHold].map(h => h.Id))
    : null;

  const BATCH = 100;
  let upsertedCount = 0;

  const upsertHarvest = (h: typeof allHarvests[0], isActive: boolean) => {
    const shared = {
      name: h.Name,
      harvestType: h.HarvestType || null,
      sourceStrainNames: h.SourceStrainNames || null,
      dryingLocationName: h.DryingLocationName || null,
      currentWeight: new Prisma.Decimal(h.CurrentWeight),
      totalWasteWeight: new Prisma.Decimal(h.TotalWasteWeight),
      totalRestoredWeight: new Prisma.Decimal(h.TotalRestoredWeight),
      packageCount: h.PackageCount,
      totalPackagedWeight: new Prisma.Decimal(h.TotalPackagedWeight),
      unitOfWeightName: h.UnitOfWeightName || null,
      labTestingState: h.LabTestingState || null,
      isOnHold: h.IsOnHold ?? false,
      harvestStartDate: h.HarvestStartDate ? new Date(h.HarvestStartDate) : null,
      finishedDate: h.FinishedDate ? new Date(h.FinishedDate) : null,
      archivedDate: h.ArchivedDate ? new Date(h.ArchivedDate) : null,
      metrcLastModified: h.LastModified ? new Date(h.LastModified) : null,
      rawPayload: h as unknown as Prisma.InputJsonValue,
    };
    return prisma.harvestSnapshot.upsert({
      where: { facilityId_metrcHarvestId: { facilityId, metrcHarvestId: h.Id } },
      update: { ...shared, isActive, lastSyncedAt: now },
      create: { facilityId, metrcHarvestId: h.Id, ...shared, isActive },
    });
  };

  // Upsert active + on-hold harvests
  const activeHarvests = [...active, ...onHold];
  for (let i = 0; i < activeHarvests.length; i += BATCH) {
    const chunk = activeHarvests.slice(i, i + BATCH);
    await Promise.all(chunk.map(h => upsertHarvest(h, true)));
    upsertedCount += chunk.length;
  }

  // Upsert inactive harvests
  for (let i = 0; i < inactive.length; i += BATCH) {
    const chunk = inactive.slice(i, i + BATCH);
    await Promise.all(chunk.map(h => upsertHarvest(h, false)));
    upsertedCount += chunk.length;
  }

  // Deactivate missing harvests (full mode only)
  let deactivated = 0;
  if (activeIds) {
    const result = await prisma.harvestSnapshot.updateMany({
      where: { facilityId, isActive: true, metrcHarvestId: { notIn: Array.from(activeIds) } },
      data: { isActive: false, lastSyncedAt: now },
    });
    deactivated = result.count;
  }

  await updateWatermark(facilityId, now);
  console.log(`[HARVEST-SYNC] ${facility.name}: upserted ${upsertedCount}, deactivated ${deactivated}`);

  return { facilityId, facilityName: facility.name, status: 'success', count: upsertedCount, deactivated, mode: effectiveMode };
}

async function updateWatermark(facilityId: string, now: Date) {
  await prisma.syncWatermark.upsert({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
    update: { watermark: now.toISOString(), lastRunAt: now, lastRunStatus: 'success', runCount: { increment: 1 } },
    create: { facilityId, endpoint: ENDPOINT_KEY, watermark: now.toISOString(), lastRunAt: now, lastRunStatus: 'success', runCount: 1 },
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
    const facilityFilter = req.query.facilityId as string | undefined;
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: { isActive: true, metrcEnvironment: { in: ['production', 'sandbox'] }, ...(facilityFilter ? { id: facilityFilter } : {}), organizationId: { in: prodOrgIds } },
    });

    const budgetCheck = await checkBudget();
    if (budgetCheck.status === 'sync_blocked' || budgetCheck.status === 'all_blocked') {
      return res.status(200).json({ results: [], budget: budgetCheck, skipped: true });
    }

    const mode = (req.query.mode === 'full' ? 'full' : 'incremental') as 'full' | 'incremental';
    const results: Array<{ facilityId: string; facilityName: string; status: string; count?: number; deactivated?: number; errorMessage?: string }> = [];

    for (const facility of facilities) {
      const { allowed, budget } = await canSync();
      if (!allowed) {
        results.push({ facilityId: facility.id, facilityName: facility.name, status: 'budget_blocked', errorMessage: `Monthly budget at ${budget.percentUsed}%` });
        break;
      }

      try {
        const result = await syncFacilityHarvests(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[HARVEST-SYNC] ${facility.name}: FAILED — ${msg}`);
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
    console.error('[HARVEST-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
