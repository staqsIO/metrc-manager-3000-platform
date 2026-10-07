import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';

/**
 * Nightly cron for incremental inactive sales sync.
 *
 * For each active facility, fetches recently-modified inactive receipts
 * from the Metrc API using lastModifiedStart/lastModifiedEnd window,
 * and upserts into the RetailSaleReceipt summary table.
 *
 * Uses SyncWatermark to track last successful sync per facility.
 * Budget: ~22 API calls/day per facility (420 receipts ÷ 20 per page).
 *
 * Railway cron config:
 *   POST /api/cron/retail-sales-sync
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 0 8 * * *  (3 AM ET = 8 AM UTC)
 */

const ENDPOINT_KEY = 'sales.receipts.inactive';
const OVERLAP_MINUTES = 30; // Safety overlap for clock skew

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

    console.log(`[RETAIL-SYNC] Starting sync for ${facilities.length} facilities`);

    const results: Array<{
      facilityId: string;
      facilityName: string;
      status: string;
      receiptsUpserted?: number;
      errorMessage?: string;
    }> = [];

    for (const facility of facilities) {
      try {
        const result = await syncFacilitySales(facility as MetrcFacility);
        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[RETAIL-SYNC] ${facility.name}: FAILED — ${msg}`);

        // If rate limited, stop processing remaining facilities
        if (msg.includes('429') || msg.includes('rate limit')) {
          console.warn('[RETAIL-SYNC] Rate limited — stopping all syncs');
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

    console.log(`[RETAIL-SYNC] Complete. ${results.length} facilities processed.`);
    return res.status(200).json({ results });
  } catch (err) {
    console.error('[RETAIL-SYNC] Fatal error:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}

export async function syncFacilitySales(facility: MetrcFacility) {
  const facilityId = facility.id;

  // Load or create watermark
  const watermark = await prisma.syncWatermark.findUnique({
    where: { facilityId_endpoint: { facilityId, endpoint: ENDPOINT_KEY } },
  });

  // Determine date range
  const now = new Date();
  const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
  let startDate: Date;

  if (watermark?.watermark) {
    // Resume from last watermark with safety overlap
    startDate = new Date(new Date(watermark.watermark).getTime() - OVERLAP_MINUTES * 60 * 1000);
  } else {
    // First sync: fetch last 7 days (initial catchup)
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const lastModifiedStart = startDate.toISOString().split('T')[0]!;
  const lastModifiedEnd = endDate.toISOString().split('T')[0]!;

  console.log(`[RETAIL-SYNC] ${facility.name}: fetching ${lastModifiedStart} → ${lastModifiedEnd}`);

  // Fetch inactive receipts via the inner client's `get` method directly.
  // The v2 patch rewrites /sales/v1/receipts/inactive → /sales/v2/receipts/inactive
  // and auto-paginates through ALL pages (unlike getSalesReceipts() which caps
  // inactive at 20 items to protect live page loads).
  const client = getMetrcClient(facility);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientAny = client as any;

  // Access inner client (MetrcCachedClient.inner → MetrcClient with v2 patch)
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
    // Direct call to /sales/v1/receipts/inactive with date filters.
    // v2 patch auto-rewrites and paginates through all pages.
    const result = await getFn('/sales/v1/receipts/inactive', {
      lastModifiedStart,
      lastModifiedEnd,
    });
    receipts = Array.isArray(result) ? result : [];
  } else {
    // Fallback: use getSalesReceipts which merges active+inactive (capped at 20 inactive)
    const all = await client.getSalesReceipts();
    receipts = all.filter(
      (r: unknown) => (r as Record<string, unknown>)._saleStatus === 'inactive'
    ) as ReceiptRow[];
  }

  console.log(`[RETAIL-SYNC] ${facility.name}: fetched ${receipts.length} inactive receipts`);

  if (receipts.length === 0) {
    await upsertWatermark(facilityId, now, 'success');
    return {
      facilityId,
      facilityName: facility.name,
      status: 'success',
      receiptsUpserted: 0,
    };
  }

  // Batch upsert into RetailSaleReceipt
  let upsertedCount = 0;
  const BATCH = 100;

  for (let i = 0; i < receipts.length; i += BATCH) {
    const batch = receipts.slice(i, i + BATCH);
    await Promise.all(
      batch.map(r =>
        prisma.retailSaleReceipt.upsert({
          where: {
            facilityId_receiptId: { facilityId, receiptId: r.Id },
          },
          update: {
            customerType: r.SalesCustomerType || null,
            lineItemCount: r.TotalPackages,
            totalPrice: new Prisma.Decimal(r.TotalPrice),
            soldAt: new Date(r.SalesDateTime),
            finalized: true,
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
            finalized: true,
          },
        })
      )
    );
    upsertedCount += batch.length;
  }

  // Track the max LastModified for the watermark
  const maxLastModified = receipts.reduce((max, r) => {
    const d = new Date(r.LastModified);
    return d > max ? d : max;
  }, new Date(0));

  await upsertWatermark(facilityId, maxLastModified, 'success');

  console.log(`[RETAIL-SYNC] ${facility.name}: upserted ${upsertedCount} receipts, watermark=${maxLastModified.toISOString()}`);

  return {
    facilityId,
    facilityName: facility.name,
    status: 'success',
    receiptsUpserted: upsertedCount,
  };
}

async function upsertWatermark(
  facilityId: string,
  watermarkDate: Date,
  status: string,
) {
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
