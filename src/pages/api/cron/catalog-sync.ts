import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Phase 3 catalog sync: Items, Locations, Strains.
 *
 * These Metrc endpoints don't support a `lastModifiedStart` filter, so this is
 * always a full sync. Low cadence (daily, cold tier) keeps costs negligible —
 * ~3 API calls per facility per day regardless of catalog size (pagination handled
 * internally by the client).
 *
 * Always-full semantics: rows not returned by the API are marked isActive=false.
 *
 * Railway cron config:
 *   POST /api/cron/catalog-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: daily (called by sync-all-facilities.ts)
 */

const ITEMS_ENDPOINT = 'catalog.items';
const LOCATIONS_ENDPOINT = 'catalog.locations';
const STRAINS_ENDPOINT = 'catalog.strains';

export async function syncFacilityCatalog(facility: MetrcFacility) {
  const facilityId = facility.id;
  const client = getMetrcClient(facility);
  const now = new Date();

  const [items, locations, strains] = await Promise.all([
    client.getActiveItems(),
    client.getActiveLocations(),
    client.getActiveStrains(),
  ]);

  // 1 call per endpoint minimum, more if paginated large catalogs (estimate /20)
  const estimatedCalls = [items, locations, strains].reduce(
    (sum, arr) => sum + Math.max(1, Math.ceil(arr.length / 20)),
    0,
  );
  await incrementBudget(estimatedCalls);

  // ---- Items ----
  const itemIds = new Set(items.map(i => i.Id));
  const BATCH = 100;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(
      batch.map(it => {
        const shared = {
          name: it.Name,
          productCategoryName: it.ProductCategoryName || null,
          productCategoryType: it.ProductCategoryType || null,
          quantityType: it.QuantityType || null,
          defaultLabTestingState: it.DefaultLabTestingState || null,
          unitOfMeasureName: it.UnitOfMeasureName || null,
          strainName: it.StrainName || null,
          rawPayload: it as unknown as Prisma.InputJsonValue,
        };
        return prisma.itemSnapshot.upsert({
          where: { facilityId_metrcItemId: { facilityId, metrcItemId: it.Id } },
          update: { ...shared, isActive: true, lastSyncedAt: now },
          create: { facilityId, metrcItemId: it.Id, ...shared, isActive: true },
        });
      }),
    );
  }
  const itemsDeactivated = itemIds.size === 0
    ? 0
    : (await prisma.itemSnapshot.updateMany({
        where: { facilityId, isActive: true, metrcItemId: { notIn: Array.from(itemIds) } },
        data: { isActive: false, lastSyncedAt: now },
      })).count;

  // ---- Locations ----
  const locationIds = new Set(locations.map(l => l.Id));
  for (let i = 0; i < locations.length; i += BATCH) {
    const batch = locations.slice(i, i + BATCH);
    await Promise.all(
      batch.map(loc => {
        const shared = {
          name: loc.Name,
          locationTypeId: loc.LocationTypeId ?? null,
          locationTypeName: loc.LocationTypeName || null,
          rawPayload: loc as unknown as Prisma.InputJsonValue,
        };
        return prisma.locationSnapshot.upsert({
          where: { facilityId_metrcLocationId: { facilityId, metrcLocationId: loc.Id } },
          update: { ...shared, isActive: true, lastSyncedAt: now },
          create: { facilityId, metrcLocationId: loc.Id, ...shared, isActive: true },
        });
      }),
    );
  }
  const locationsDeactivated = locationIds.size === 0
    ? 0
    : (await prisma.locationSnapshot.updateMany({
        where: { facilityId, isActive: true, metrcLocationId: { notIn: Array.from(locationIds) } },
        data: { isActive: false, lastSyncedAt: now },
      })).count;

  // ---- Strains ----
  const strainIds = new Set(strains.map(s => s.Id));
  for (let i = 0; i < strains.length; i += BATCH) {
    const batch = strains.slice(i, i + BATCH);
    await Promise.all(
      batch.map(s => {
        const shared = {
          name: s.Name,
          testingStatus: s.TestingStatus || null,
          thcLevel: s.ThcLevel != null ? new Prisma.Decimal(s.ThcLevel) : null,
          cbdLevel: s.CbdLevel != null ? new Prisma.Decimal(s.CbdLevel) : null,
          indicaPercentage: s.IndicaPercentage != null ? new Prisma.Decimal(s.IndicaPercentage) : null,
          sativaPercentage: s.SativaPercentage != null ? new Prisma.Decimal(s.SativaPercentage) : null,
          rawPayload: s as unknown as Prisma.InputJsonValue,
        };
        return prisma.strainSnapshot.upsert({
          where: { facilityId_metrcStrainId: { facilityId, metrcStrainId: s.Id } },
          update: { ...shared, isActive: true, lastSyncedAt: now },
          create: { facilityId, metrcStrainId: s.Id, ...shared, isActive: true },
        });
      }),
    );
  }
  const strainsDeactivated = strainIds.size === 0
    ? 0
    : (await prisma.strainSnapshot.updateMany({
        where: { facilityId, isActive: true, metrcStrainId: { notIn: Array.from(strainIds) } },
        data: { isActive: false, lastSyncedAt: now },
      })).count;

  // Watermarks — three separate endpoints, all advanced to now
  await Promise.all(
    [ITEMS_ENDPOINT, LOCATIONS_ENDPOINT, STRAINS_ENDPOINT].map(endpoint =>
      prisma.syncWatermark.upsert({
        where: { facilityId_endpoint: { facilityId, endpoint } },
        update: {
          watermark: now.toISOString(),
          lastRunAt: now,
          lastRunStatus: 'success',
          runCount: { increment: 1 },
        },
        create: {
          facilityId,
          endpoint,
          watermark: now.toISOString(),
          lastRunAt: now,
          lastRunStatus: 'success',
          runCount: 1,
        },
      }),
    ),
  );

  console.log(
    `[CATALOG-SYNC] ${facility.name}: items=${items.length} (-${itemsDeactivated}), locations=${locations.length} (-${locationsDeactivated}), strains=${strains.length} (-${strainsDeactivated})`,
  );

  return {
    facilityId,
    facilityName: facility.name,
    status: 'success' as const,
    count: items.length + locations.length + strains.length,
    items: items.length,
    locations: locations.length,
    strains: strains.length,
    deactivated: itemsDeactivated + locationsDeactivated + strainsDeactivated,
  };
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
        const r = await syncFacilityCatalog(facility as MetrcFacility);
        results.push(r);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CATALOG-SYNC] ${facility.name}: FAILED — ${msg}`);
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
    console.error('[CATALOG-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
