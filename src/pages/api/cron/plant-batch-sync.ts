import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Daily cron for plant batch snapshot sync (active + inactive).
 *
 * Phase 2 re-architecture: syncs plant batches into PlantBatchSnapshot table
 * using the same watermark pattern as package-sync.
 */

const ENDPOINT_KEY = 'plantbatches.active';
// const INACTIVE_ENDPOINT_KEY = 'plantbatches.inactive'; // Phase 2

export async function syncFacilityPlantBatches(facility: MetrcFacility, opts: { mode?: 'incremental' | 'full' } = {}) {
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

  console.log(`[PLANTBATCH-SYNC] ${facility.name}: fetching batches (mode=${effectiveMode}${filters ? `, since=${filters.lastModifiedStart}` : ''})...`);
  const batches = await client.getActivePlantBatches(filters);
  const estimatedCalls = Math.max(1, Math.ceil(batches.length / 20));
  await incrementBudget(estimatedCalls);
  console.log(`[PLANTBATCH-SYNC] ${facility.name}: fetched ${batches.length} batches (~${estimatedCalls} API calls)`);

  if (batches.length === 0) {
    await updateWatermark(facilityId, now);
    return { facilityId, facilityName: facility.name, status: 'success', count: 0, mode: effectiveMode };
  }

  const seenIds = effectiveMode === 'full' ? new Set<number>(batches.map(b => b.Id)) : null;

  const BATCH = 100;
  let upsertedCount = 0;

  for (let i = 0; i < batches.length; i += BATCH) {
    const chunk = batches.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(b => {
        const shared = {
          name: b.Name,
          type: b.Type || null,
          strainName: b.StrainName || null,
          locationName: b.LocationName || null,
          roomName: b.RoomName || null,
          count: b.Count ?? 0,
          untrackedCount: b.UntrackedCount ?? 0,
          trackedCount: b.TrackedCount ?? 0,
          packagedCount: b.PackagedCount ?? 0,
          harvestedCount: b.HarvestedCount ?? 0,
          destroyedCount: b.DestroyedCount ?? 0,
          plantedDate: b.PlantedDate ? new Date(b.PlantedDate) : null,
          metrcLastModified: b.LastModified ? new Date(b.LastModified) : null,
          rawPayload: b as unknown as Prisma.InputJsonValue,
        };
        return prisma.plantBatchSnapshot.upsert({
          where: { facilityId_metrcBatchId: { facilityId, metrcBatchId: b.Id } },
          update: { ...shared, isActive: true, lastSyncedAt: now },
          create: { facilityId, metrcBatchId: b.Id, ...shared, isActive: true },
        });
      })
    );
    upsertedCount += chunk.length;
  }

  // Deactivate missing batches (full mode) or fetch inactive (incremental mode)
  let deactivated = 0;
  if (seenIds) {
    const result = await prisma.plantBatchSnapshot.updateMany({
      where: { facilityId, isActive: true, metrcBatchId: { notIn: Array.from(seenIds) } },
      data: { isActive: false, lastSyncedAt: now },
    });
    deactivated = result.count;
  } else if (filters) {
    try {
      const inactiveBatches = await client.getInactivePlantBatches(filters);
      const inactiveCalls = Math.max(1, Math.ceil(inactiveBatches.length / 20));
      await incrementBudget(inactiveCalls);
      if (inactiveBatches.length > 0) {
        for (let i = 0; i < inactiveBatches.length; i += BATCH) {
          const chunk = inactiveBatches.slice(i, i + BATCH);
          await Promise.all(
            chunk.map(b => {
              const shared = {
                name: b.Name,
                type: b.Type || null,
                strainName: b.StrainName || null,
                locationName: b.LocationName || null,
                roomName: b.RoomName || null,
                count: b.Count ?? 0,
                untrackedCount: b.UntrackedCount ?? 0,
                trackedCount: b.TrackedCount ?? 0,
                packagedCount: b.PackagedCount ?? 0,
                harvestedCount: b.HarvestedCount ?? 0,
                destroyedCount: b.DestroyedCount ?? 0,
                plantedDate: b.PlantedDate ? new Date(b.PlantedDate) : null,
                metrcLastModified: b.LastModified ? new Date(b.LastModified) : null,
                rawPayload: b as unknown as Prisma.InputJsonValue,
              };
              return prisma.plantBatchSnapshot.upsert({
                where: { facilityId_metrcBatchId: { facilityId, metrcBatchId: b.Id } },
                update: { ...shared, isActive: false, lastSyncedAt: now },
                create: { facilityId, metrcBatchId: b.Id, ...shared, isActive: false },
              });
            })
          );
        }
        deactivated = inactiveBatches.length;
      }
    } catch (err) {
      console.warn(`[PLANTBATCH-SYNC] ${facility.name}: inactive sync failed:`, err instanceof Error ? err.message : err);
    }
  }

  await updateWatermark(facilityId, now);
  console.log(`[PLANTBATCH-SYNC] ${facility.name}: upserted ${upsertedCount}, deactivated ${deactivated}`);

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
        const result = await syncFacilityPlantBatches(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PLANTBATCH-SYNC] ${facility.name}: FAILED — ${msg}`);
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
    console.error('[PLANTBATCH-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
