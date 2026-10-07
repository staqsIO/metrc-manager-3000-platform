import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';

/**
 * Hourly cron for incremental ACTIVE (not-yet-finalized) sales sync.
 *
 * Sister endpoint to retail-sales-sync.ts (which handles inactive/finalized
 * receipts). Active receipts are same-day or recent transactions that Metrc
 * has not yet flipped to finalized — typically a 24-48h window before a
 * receipt becomes "inactive". Without this endpoint, the dashboard sees
 * sales on a 2-day lag because only the inactive cron writes data.
 *
 * Each upsert lands `finalized: false`. The inactive cron later upserts the
 * same `(facilityId, receiptId)` and flips `finalized: true` once Metrc
 * finalizes — the existing unique constraint handles the lifecycle cleanly.
 *
 * Uses SyncWatermark with endpoint key 'sales.receipts.active' to track the
 * max LastModified seen, then resumes from there on the next run with a
 * safety overlap.
 *
 * API budget per facility per run (with 12h lastModified window):
 *   - typical dispensary: 2-4 API calls (200-400 active receipts at 100/page)
 *   - hourly schedule: ~72-96 calls/day per dispensary
 *   - 3 MA dispensaries × 24h × ~3 calls = ~216/day
 *   - well inside the 125K monthly cap
 *
 * Railway cron config:
 *   POST /api/cron/retail-sales-active-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 0 * * * *  (hourly at top of hour, UTC)
 */

const ENDPOINT_KEY = 'sales.receipts.active';
const OVERLAP_MINUTES = 30; // Safety overlap for clock skew
const INITIAL_BACKFILL_HOURS = 48; // First run pulls last 48h of activity
const RECURRING_WINDOW_HOURS = 12; // Subsequent runs pull at least this far back

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
      where: {
        isActive: true,
        metrcEnvironment: { in: ['production', 'sandbox'] },
        organizationId: { in: prodOrgIds },
      },
    });

    console.log(`[ACTIVE-SALES-SYNC] Starting sync for ${facilities.length} facilities`);

    const results: Array<{
      facilityId: string;
      facilityName: string;
      status: string;
      receiptsUpserted?: number;
      errorMessage?: string;
    }> = [];

    for (const facility of facilities) {
      try {
        const result = await syncFacilityActiveSales(facility as MetrcFacility);
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ACTIVE-SALES-SYNC] ${facility.name}: FAILED — ${msg}`);

        // If rate limited, stop processing remaining facilities
        if (msg.includes('429') || msg.includes('rate limit')) {
          console.warn('[ACTIVE-SALES-SYNC] Rate limited — stopping all syncs');
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

    console.log(`[ACTIVE-SALES-SYNC] Complete. ${results.length} facilities processed.`);
    return res.status(200).json({ results });
  } catch (err) {
    console.error('[ACTIVE-SALES-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}

export async function syncFacilityActiveSales(facility: MetrcFacility) {
  const facilityId = facility.id;

  const watermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
  });

  // Determine date range. Active receipts have a short natural lifetime
  // (~24-48h before Metrc finalizes them), so the lookback window is
  // tighter than for inactive sync.
  const now = new Date();
  const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
  let startDate: Date;

  if (watermark?.watermark) {
    // Resume from last watermark with safety overlap, but never look back
    // less than RECURRING_WINDOW_HOURS — guards against a stuck watermark
    // missing late-arriving modifications.
    const watermarkStart = new Date(
      new Date(watermark.watermark).getTime() - OVERLAP_MINUTES * 60 * 1000,
    );
    const minStart = new Date(now.getTime() - RECURRING_WINDOW_HOURS * 60 * 60 * 1000);
    startDate = watermarkStart < minStart ? watermarkStart : minStart;
  } else {
    startDate = new Date(now.getTime() - INITIAL_BACKFILL_HOURS * 60 * 60 * 1000);
  }

  const lastModifiedStart = startDate.toISOString().split('T')[0]!;
  const lastModifiedEnd = endDate.toISOString().split('T')[0]!;

  console.log(
    `[ACTIVE-SALES-SYNC] ${facility.name}: fetching ${lastModifiedStart} → ${lastModifiedEnd}`,
  );

  // Fetch active receipts via the inner client's `get` method. The v2 patch
  // (src/services/metrc/metrc-v2-client.ts) rewrites /sales/v1/receipts/active
  // → /sales/v2/receipts/active and auto-paginates through all pages.
  const client = getMetrcClient(facility);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientAny = client as any;

  const innerClient = clientAny.inner ?? clientAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getFn = (innerClient as any).get?.bind(innerClient);

  type ReceiptRow = {
    Id: number;
    ReceiptNumber: string;
    SalesDateTime: string;
    SalesCustomerType: string;
    TotalPackages: number;
    TotalPrice: number;
    LastModified: string;
  };

  let receipts: ReceiptRow[];

  if (typeof getFn === 'function') {
    const result = await getFn('/sales/v1/receipts/active', {
      lastModifiedStart,
      lastModifiedEnd,
    });
    receipts = Array.isArray(result) ? result : [];
  } else {
    // Fallback: getSalesReceipts merges active + inactive (capped); filter to active
    const all = await client.getSalesReceipts();
    receipts = all.filter(
      (r: unknown) => (r as Record<string, unknown>)._saleStatus === 'active',
    ) as ReceiptRow[];
  }

  console.log(
    `[ACTIVE-SALES-SYNC] ${facility.name}: fetched ${receipts.length} active receipts`,
  );

  if (receipts.length === 0) {
    await upsertWatermark(facilityId, now, 'success');
    return {
      facilityId,
      facilityName: facility.name,
      status: 'success',
      receiptsUpserted: 0,
    };
  }

  // Batch upsert into RetailSaleReceipt with finalized=false. The inactive
  // cron will later upsert the same (facilityId, receiptId) and flip
  // finalized=true once Metrc finalizes the receipt.
  let upsertedCount = 0;
  const BATCH = 100;

  for (let i = 0; i < receipts.length; i += BATCH) {
    const batch = receipts.slice(i, i + BATCH);
    await Promise.all(
      batch.map((r) =>
        prisma.retailSaleReceipt.upsert({
          where: {
            facilityId_receiptId: { facilityId, receiptId: r.Id },
          },
          // Only overwrite when the existing row is also active. Otherwise
          // the inactive cron has already flipped finalized=true and we
          // don't want to clobber its richer data.
          update: {
            customerType: r.SalesCustomerType || null,
            lineItemCount: r.TotalPackages,
            totalPrice: new Prisma.Decimal(r.TotalPrice),
            soldAt: new Date(r.SalesDateTime),
            // Intentionally do NOT set finalized here — preserve whatever
            // the inactive cron may have set. New rows default to false.
            updatedAt: new Date(),
          },
          create: {
            facilityId,
            receiptId: r.Id,
            receiptNumber: r.ReceiptNumber,
            customerType: r.SalesCustomerType || null,
            lineItemCount: r.TotalPackages,
            totalPrice: new Prisma.Decimal(r.TotalPrice),
            soldAt: new Date(r.SalesDateTime),
            finalized: false,
          },
        }),
      ),
    );
    upsertedCount += batch.length;
  }

  const maxLastModified = receipts.reduce((max, r) => {
    const d = new Date(r.LastModified);
    return d > max ? d : max;
  }, new Date(0));

  await upsertWatermark(facilityId, maxLastModified, 'success');

  console.log(
    `[ACTIVE-SALES-SYNC] ${facility.name}: upserted ${upsertedCount} active receipts, watermark=${maxLastModified.toISOString()}`,
  );

  return {
    facilityId,
    facilityName: facility.name,
    status: 'success',
    receiptsUpserted: upsertedCount,
  };
}

async function upsertWatermark(facilityId: string, watermarkDate: Date, status: string) {
  await prisma.syncWatermark.upsert({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
    update: {
      watermark: watermarkDate.toISOString(),
      lastRunAt: new Date(),
      lastRunStatus: status,
      runCount: { increment: 1 },
    },
    create: {
      facilityId,
      endpoint: ENDPOINT_KEY,
      watermark: watermarkDate.toISOString(),
      lastRunAt: new Date(),
      lastRunStatus: status,
      runCount: 1,
    },
  });
}
