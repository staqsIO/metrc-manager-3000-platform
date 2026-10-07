import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Daily cron for package snapshot sync (active + inactive).
 *
 * For each active facility, fetches active and inactive packages from Metrc,
 * upserts into PackageSnapshot, and marks packages no longer in the
 * response as isActive=false (sold/transferred).
 *
 * Phase 1 re-architecture: also syncs inactive packages and populates
 * promoted fields (labTestingState, isOnHold, sourceHarvestNames, metrcLastModified).
 *
 * Railway/GitHub Actions cron config:
 *   POST /api/cron/package-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 0 7 * * *  (3 AM ET = 7 AM UTC)
 */

const ENDPOINT_KEY = 'packages.active';
// const INACTIVE_ENDPOINT_KEY = 'packages.inactive'; // Phase 2: inactive package sync

export async function syncFacilityPackages(facility: MetrcFacility, opts: { mode?: 'incremental' | 'full' } = {}) {
  const facilityId = facility.id;
  const client = getMetrcClient(facility);
  const mode = opts.mode ?? 'incremental';
  const now = new Date();

  // Load watermark for incremental mode
  const watermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
  });

  // First-time setup (no watermark yet) auto-promotes to full sync.
  // After that, incremental forever (with monthly full reconciliation).
  const effectiveMode: 'incremental' | 'full' =
    mode === 'incremental' && !watermark?.watermark ? 'full' : mode;

  // Build filter params for incremental sync
  let filters: Record<string, string> | undefined;
  if (effectiveMode === 'incremental' && watermark?.watermark) {
    // Fetch packages modified since last sync (with 1 hour overlap for safety)
    const since = new Date(new Date(watermark.watermark).getTime() - 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    filters = {
      lastModifiedStart: since.toISOString().split('T')[0]!,
      lastModifiedEnd: tomorrow.toISOString().split('T')[0]!,
    };
  }

  console.log(`[PACKAGE-SYNC] ${facility.name}: fetching active packages (mode=${effectiveMode}${filters ? `, since=${filters.lastModifiedStart}` : ''})...`);
  const packages = await client.getActivePackages(filters);
  // Track API calls used (getActivePackages paginates internally — estimate from result size)
  const estimatedCalls = Math.max(1, Math.ceil(packages.length / 20));
  await incrementBudget(estimatedCalls);
  console.log(`[PACKAGE-SYNC] ${facility.name}: fetched ${packages.length} packages (~${estimatedCalls} API calls)`);

  if (packages.length === 0) {
    // Update watermark even if no changes, so we don't refetch the same window
    await updateWatermark(facilityId, now);
    return { facilityId, facilityName: facility.name, status: 'success', count: 0, mode };
  }

  // For FULL sync only: track which IDs we saw so we can mark missing ones inactive.
  // For INCREMENTAL sync: we only fetch a subset — can't tell what's missing,
  // so don't deactivate. Weekly full sync handles deactivation reconciliation.
  const seenIds = effectiveMode === 'full' ? new Set<number>(packages.map(p => p.Id)) : null;

  // Batch upsert in chunks to avoid overwhelming the connection pool
  const BATCH = 100;
  let upsertedCount = 0;

  for (let i = 0; i < packages.length; i += BATCH) {
    const batch = packages.slice(i, i + BATCH);
    await Promise.all(
      batch.map(p => {
        const finishedDate = p.FinishedDate ? new Date(p.FinishedDate) : null;
        const archivedDate = p.ArchivedDate ? new Date(p.ArchivedDate) : null;
        // Metrc's "active" list still returns packages with FinishedDate or
        // ArchivedDate set. Treat them as inactive in our snapshot — the
        // dates are the authoritative signal.
        const effectivelyActive =
          !finishedDate && !archivedDate && Number(p.Quantity) > 0;
        const shared = {
          packageLabel: p.Label,
          packageType: p.PackageType || null,
          itemId: p.ItemId,
          itemName: p.ItemName,
          itemCategory: p.ItemCategory || null,
          quantity: new Prisma.Decimal(p.Quantity),
          unitOfMeasure: p.UnitOfMeasureName || null,
          itemStrainName: p.ItemStrainName || null,
          locationName: p.LocationName || null,
          packagedDate: p.PackagedDate ? new Date(p.PackagedDate) : null,
          finishedDate,
          archivedDate,
          // Phase 1 promoted fields
          metrcLastModified: p.LastModified ? new Date(p.LastModified) : null,
          labTestingState: p.LabTestingState || null,
          isOnHold: p.IsOnHold ?? false,
          sourceHarvestNames: p.SourceHarvestNames || null,
          rawPayload: p as unknown as Prisma.InputJsonValue,
        };
        return prisma.packageSnapshot.upsert({
          where: {
            facilityId_metrcPackageId: { facilityId, metrcPackageId: p.Id },
          },
          update: {
            ...shared,
            isActive: effectivelyActive,
            lastSyncedAt: now,
          },
          create: {
            facilityId,
            metrcPackageId: p.Id,
            ...shared,
            isActive: effectivelyActive,
          },
        });
      })
    );
    upsertedCount += batch.length;
  }

  // Deactivate missing packages — only safe in FULL mode (we have complete list).
  // Incremental mode handles deactivation by fetching newly-inactive packages below.
  let deactivated = 0;
  if (seenIds) {
    const result = await prisma.packageSnapshot.updateMany({
      where: {
        facilityId,
        isActive: true,
        metrcPackageId: { notIn: Array.from(seenIds) },
      },
      data: { isActive: false, lastSyncedAt: now },
    });
    deactivated = result.count;
  } else if (filters) {
    // Incremental mode: also fetch packages that became INACTIVE since last sync.
    // Phase 1: fully upsert inactive packages into PackageSnapshot (not just flip isActive).
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = client as any;
      if (typeof clientAny.getInactivePackages === 'function') {
        const inactivePkgs = await clientAny.getInactivePackages(filters) as Array<Record<string, unknown>>;
        const inactiveCalls = Math.max(1, Math.ceil(inactivePkgs.length / 20));
        await incrementBudget(inactiveCalls);
        if (inactivePkgs.length > 0) {
          for (let i = 0; i < inactivePkgs.length; i += BATCH) {
            const batch = inactivePkgs.slice(i, i + BATCH);
            await Promise.all(
              batch.map((p) => {
                const id = p.Id as number;
                const shared = {
                  packageLabel: (p.Label as string) ?? '',
                  packageType: (p.PackageType as string) || null,
                  itemId: (p.ItemId as number) ?? null,
                  itemName: (p.ItemName as string) ?? '',
                  itemCategory: (p.ItemCategory as string) || null,
                  quantity: new Prisma.Decimal((p.Quantity as number) ?? 0),
                  unitOfMeasure: (p.UnitOfMeasureName as string) || null,
                  itemStrainName: (p.ItemStrainName as string) || null,
                  locationName: (p.LocationName as string) || null,
                  packagedDate: p.PackagedDate ? new Date(p.PackagedDate as string) : null,
                  finishedDate: p.FinishedDate ? new Date(p.FinishedDate as string) : null,
                  archivedDate: p.ArchivedDate ? new Date(p.ArchivedDate as string) : null,
                  metrcLastModified: p.LastModified ? new Date(p.LastModified as string) : null,
                  labTestingState: (p.LabTestingState as string) || null,
                  isOnHold: (p.IsOnHold as boolean) ?? false,
                  sourceHarvestNames: (p.SourceHarvestNames as string) || null,
                  rawPayload: p as unknown as Prisma.InputJsonValue,
                };
                return prisma.packageSnapshot.upsert({
                  where: { facilityId_metrcPackageId: { facilityId, metrcPackageId: id } },
                  update: { ...shared, isActive: false, lastSyncedAt: now },
                  create: { facilityId, metrcPackageId: id, ...shared, isActive: false },
                });
              })
            );
          }
          deactivated = inactivePkgs.length;
        }
      }
    } catch (err) {
      console.warn(`[PACKAGE-SYNC] ${facility.name}: inactive sync failed:`, err instanceof Error ? err.message : err);
    }
  }

  await updateWatermark(facilityId, now);

  console.log(`[PACKAGE-SYNC] ${facility.name}: upserted ${upsertedCount}, deactivated ${deactivated}`);

  return {
    facilityId,
    facilityName: facility.name,
    status: 'success',
    count: upsertedCount,
    deactivated,
    mode: effectiveMode,
  };
}

async function updateWatermark(facilityId: string, now: Date) {
  await prisma.syncWatermark.upsert({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
    update: {
      watermark: now.toISOString(),
      lastRunAt: now,
      lastRunStatus: 'success',
      runCount: { increment: 1 },
    },
    create: {
      facilityId,
      endpoint: ENDPOINT_KEY,
      watermark: now.toISOString(),
      lastRunAt: now,
      lastRunStatus: 'success',
      runCount: 1,
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
    const facilityFilter = req.query.facilityId as string | undefined;
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: {
        isActive: true,
        metrcEnvironment: { in: ['production', 'sandbox'] },
        ...(facilityFilter ? { id: facilityFilter } : {}),
        organizationId: { in: prodOrgIds },
      },
    });

    console.log(`[PACKAGE-SYNC] Starting for ${facilities.length} facilities`);

    // Pre-flight budget check
    const budgetCheck = await checkBudget();
    console.log(`[PACKAGE-SYNC] Budget: ${budgetCheck.callsUsed}/${budgetCheck.callsCap} (${budgetCheck.percentUsed}%) — status: ${budgetCheck.status}`);

    const results: Array<{
      facilityId: string;
      facilityName: string;
      status: string;
      count?: number;
      deactivated?: number;
      errorMessage?: string;
    }> = [];

    if (budgetCheck.status === 'sync_blocked' || budgetCheck.status === 'all_blocked') {
      console.warn(`[PACKAGE-SYNC] Budget ${budgetCheck.status} (${budgetCheck.percentUsed}%) — skipping all syncs`);
      return res.status(200).json({
        results: [],
        budget: budgetCheck,
        skipped: true,
        reason: `Monthly API budget at ${budgetCheck.percentUsed}% — sync blocked at 95%`,
      });
    }

    const mode = (req.query.mode === 'full' ? 'full' : 'incremental') as 'full' | 'incremental';
    console.log(`[PACKAGE-SYNC] Mode: ${mode}`);

    for (const facility of facilities) {
      // Check budget before each facility
      const { allowed, budget } = await canSync();
      if (!allowed) {
        console.warn(`[PACKAGE-SYNC] Budget threshold reached (${budget.percentUsed}%) — stopping after ${results.length} facilities`);
        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'budget_blocked',
          errorMessage: `Monthly budget at ${budget.percentUsed}%`,
        });
        break;
      }

      try {
        const result = await syncFacilityPackages(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PACKAGE-SYNC] ${facility.name}: FAILED — ${msg}`);

        if (msg.includes('429') || msg.includes('rate limit')) {
          console.warn('[PACKAGE-SYNC] Rate limited — stopping all syncs');
          results.push({
            facilityId: facility.id,
            facilityName: facility.name,
            status: 'rate_limited',
            errorMessage: msg,
          });
          break;
        }

        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'failed',
          errorMessage: msg,
        });
      }
    }

    // Final budget status in response
    const finalBudget = await checkBudget();
    return res.status(200).json({ results, budget: finalBudget });
  } catch (err) {
    console.error('[PACKAGE-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
