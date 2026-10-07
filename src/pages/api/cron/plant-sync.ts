import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Daily cron for plant snapshot sync (active plants).
 *
 * Phase 2 re-architecture: syncs vegetative and flowering plants
 * into PlantSnapshot table using the same watermark pattern as package-sync.
 *
 * Railway cron config:
 *   POST /api/cron/plant-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: called by sync-all-facilities.ts
 */

const ENDPOINT_KEY = 'plants.active';

export async function syncFacilityPlants(facility: MetrcFacility, opts: { mode?: 'incremental' | 'full' } = {}) {
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

  console.log(`[PLANT-SYNC] ${facility.name}: fetching plants (mode=${effectiveMode}${filters ? `, since=${filters.lastModifiedStart}` : ''})...`);
  const plants = await client.getActivePlants(filters);
  const estimatedCalls = Math.max(1, Math.ceil(plants.length / 20));
  await incrementBudget(estimatedCalls);
  console.log(`[PLANT-SYNC] ${facility.name}: fetched ${plants.length} plants (~${estimatedCalls} API calls)`);

  if (plants.length === 0) {
    await updateWatermark(facilityId, now);
    return { facilityId, facilityName: facility.name, status: 'success', count: 0, mode: effectiveMode };
  }

  const seenIds = effectiveMode === 'full' ? new Set<number>(plants.map(p => p.Id)) : null;

  const BATCH = 100;
  let upsertedCount = 0;

  for (let i = 0; i < plants.length; i += BATCH) {
    const batch = plants.slice(i, i + BATCH);
    await Promise.all(
      batch.map(p => {
        const shared = {
          label: p.Label,
          state: p.State || null,
          growthPhase: p.GrowthPhase || null,
          plantBatchName: p.PlantBatchName || null,
          plantBatchTypeName: p.PlantBatchTypeName || null,
          strainName: p.StrainName || null,
          locationName: p.LocationName || null,
          roomName: p.RoomName || null,
          isOnHold: p.IsOnHold ?? false,
          plantedDate: p.PlantedDate ? new Date(p.PlantedDate) : null,
          vegetativeDate: p.VegetativeDate ? new Date(p.VegetativeDate) : null,
          floweringDate: p.FloweringDate ? new Date(p.FloweringDate) : null,
          harvestedDate: p.HarvestedDate ? new Date(p.HarvestedDate) : null,
          destroyedDate: p.DestroyedDate ? new Date(p.DestroyedDate) : null,
          metrcLastModified: p.LastModified ? new Date(p.LastModified) : null,
          rawPayload: p as unknown as Prisma.InputJsonValue,
        };
        return prisma.plantSnapshot.upsert({
          where: { facilityId_metrcPlantId: { facilityId, metrcPlantId: p.Id } },
          update: { ...shared, isActive: true, lastSyncedAt: now },
          create: { facilityId, metrcPlantId: p.Id, ...shared, isActive: true },
        });
      })
    );
    upsertedCount += batch.length;
  }

  // Deactivate missing plants (full mode only)
  let deactivated = 0;
  if (seenIds) {
    const result = await prisma.plantSnapshot.updateMany({
      where: {
        facilityId,
        isActive: true,
        metrcPlantId: { notIn: Array.from(seenIds) },
      },
      data: { isActive: false, lastSyncedAt: now },
    });
    deactivated = result.count;
  }

  await updateWatermark(facilityId, now);
  console.log(`[PLANT-SYNC] ${facility.name}: upserted ${upsertedCount}, deactivated ${deactivated}`);

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
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: { isActive: true, metrcEnvironment: { in: ['production', 'sandbox'] }, organizationId: { in: prodOrgIds } },
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
        const result = await syncFacilityPlants(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PLANT-SYNC] ${facility.name}: FAILED — ${msg}`);
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
    console.error('[PLANT-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
