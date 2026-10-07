import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { canSync, incrementBudget, checkBudget } from '@/services/metrc/budget-guard';

/**
 * Daily cron for lab test snapshot sync.
 *
 * Phase 2 re-architecture: syncs lab test results into LabTestSnapshot table
 * using the same watermark pattern as package-sync.
 *
 * Lab tests are linked to packages via packageLabel/packageId.
 */

const ENDPOINT_KEY = 'labtests.results';

export async function syncFacilityLabTests(facility: MetrcFacility, opts: { mode?: 'incremental' | 'full' } = {}) {
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

  console.log(`[LABTEST-SYNC] ${facility.name}: fetching lab tests (mode=${effectiveMode}${filters ? `, since=${filters.lastModifiedStart}` : ''})...`);
  const labTests = await client.getLabTestResults(filters);
  const estimatedCalls = Math.max(1, Math.ceil(labTests.length / 20));
  await incrementBudget(estimatedCalls);
  console.log(`[LABTEST-SYNC] ${facility.name}: fetched ${labTests.length} lab tests (~${estimatedCalls} API calls)`);

  if (labTests.length === 0) {
    await updateWatermark(facilityId, now);
    return { facilityId, facilityName: facility.name, status: 'success', count: 0, mode: effectiveMode };
  }

  const BATCH = 100;
  let upsertedCount = 0;

  for (let i = 0; i < labTests.length; i += BATCH) {
    const chunk = labTests.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(t => {
        const shared = {
          packageLabel: t.PackageLabel,
          testPerformedDate: t.TestPerformedDate ? new Date(t.TestPerformedDate) : null,
          overallPassed: t.OverallPassed,
          testTypeName: t.TestTypeName || null,
          testResultLevel: t.TestResultLevel != null ? new Prisma.Decimal(t.TestResultLevel) : null,
          testResultUnit: t.TestResultUnit || null,
          labFacilityName: t.LabFacilityName || null,
          rawPayload: t as unknown as Prisma.InputJsonValue,
        };
        return prisma.labTestSnapshot.upsert({
          where: {
            facilityId_packageId_testTypeName: {
              facilityId,
              packageId: t.PackageId,
              testTypeName: t.TestTypeName || '',
            },
          },
          update: { ...shared, lastSyncedAt: now },
          create: { facilityId, packageId: t.PackageId, ...shared },
        });
      })
    );
    upsertedCount += chunk.length;
  }

  await updateWatermark(facilityId, now);
  console.log(`[LABTEST-SYNC] ${facility.name}: upserted ${upsertedCount}`);

  return { facilityId, facilityName: facility.name, status: 'success', count: upsertedCount, mode: effectiveMode };
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
    const results: Array<{ facilityId: string; facilityName: string; status: string; count?: number; errorMessage?: string }> = [];

    for (const facility of facilities) {
      const { allowed, budget } = await canSync();
      if (!allowed) {
        results.push({ facilityId: facility.id, facilityName: facility.name, status: 'budget_blocked', errorMessage: `Monthly budget at ${budget.percentUsed}%` });
        break;
      }

      try {
        const result = await syncFacilityLabTests(facility as MetrcFacility, { mode });
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[LABTEST-SYNC] ${facility.name}: FAILED — ${msg}`);
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
    console.error('[LABTEST-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
