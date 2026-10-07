/**
 * sync-all-facilities.ts — Daily Metrc data sync for all active facilities
 *
 * Run by Railway Cron Service. Processes facilities sequentially with per-facility
 * error handling and rate-limit backoff. Direct DB access — no HTTP timeouts.
 *
 * Syncs (per facility):
 *   1. Active + inactive packages → PackageSnapshot table
 *   2. Inactive sales receipts → RetailSaleReceipt table (finalized=true)
 *   3. Active sales receipts → RetailSaleReceipt table (finalized=false; same-day visibility)
 *   4. Plants → PlantSnapshot table
 *   5. Plant batches → PlantBatchSnapshot table
 *   6. Harvests → HarvestSnapshot table
 *   7. Lab tests → LabTestSnapshot table
 *
 * Usage (locally):
 *   npx tsx scripts/sync-all-facilities.ts [--facility=<licenseNumber>] [--only=packages|sales|active-sales|plants|batches|harvests|labtests|transfers] [--mode=incremental|full]
 *
 * Railway Cron Service config:
 *   Daily full sync:    npx tsx scripts/sync-all-facilities.ts                       (schedule: 0 7 * * *)
 *   Hourly active-sales: npx tsx scripts/sync-all-facilities.ts --only=active-sales  (schedule: 0 * * * *)
 */
import type { MetrcFacility } from '@prisma/client';
// Use the shared Prisma instance that applies pgbouncer flags via buildConnectionUrl.
// A bare `new PrismaClient()` here would skip those flags and crash against the
// transaction-mode pooler with `prepared statement "sN" does not exist` —
// regression from FOR-1498 where the cron service's literal DATABASE_URL lost
// its baked-in `?pgbouncer=true` suffix when consolidated to a service ref.
import { prisma } from '../src/lib/prisma';

// Sleep helper for inter-facility backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Throttle between facilities to avoid burst API patterns
const FACILITY_DELAY_MS = 2_000;

async function main() {
  const args = process.argv.slice(2);
  const facilityFilter = args.find(a => a.startsWith('--facility='))?.split('=')[1];
  const onlyArg = args.find(a => a.startsWith('--only='))?.split('=')[1] as
    'packages' | 'sales' | 'active-sales' | 'plants' | 'batches' | 'harvests' | 'labtests' | 'transfers' | undefined;
  const modeArg = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'incremental') as 'incremental' | 'full';

  console.log(`\n=== Metrc Sync ${new Date().toISOString()} ===`);
  console.log(`Mode: ${modeArg} | Filter: facility=${facilityFilter ?? 'all'}, only=${onlyArg ?? 'all'}\n`);

  // Lazy-import sync functions so they share the same Prisma instance via @/lib/prisma
  const { syncFacilityPackages } = await import('../src/pages/api/cron/package-sync');
  const { syncFacilityPlants } = await import('../src/pages/api/cron/plant-sync');
  const { syncFacilityPlantBatches } = await import('../src/pages/api/cron/plant-batch-sync');
  const { syncFacilityHarvests } = await import('../src/pages/api/cron/harvest-sync');
  const { syncFacilityLabTests } = await import('../src/pages/api/cron/lab-test-sync');
  const { syncFacilitySales } = await import('../src/pages/api/cron/retail-sales-sync');
  const { syncFacilityActiveSales } = await import('../src/pages/api/cron/retail-sales-active-sync');
  const { syncFacilityTransfers } = await import('../src/pages/api/cron/transfer-sync');

  const where: Record<string, unknown> = {
    isActive: true,
    metrcEnvironment: { in: ['production', 'sandbox'] },
  };
  if (facilityFilter) where.licenseNumber = facilityFilter;

  const facilities = await prisma.metrcFacility.findMany({ where });

  console.log(`Processing ${facilities.length} facilities\n`);

  interface SyncResult {
    count?: number;
    deactivated?: number;
    error?: string;
  }
  interface FacilityResult {
    facility: string;
    packages?: SyncResult;
    sales?: SyncResult;
    activeSales?: SyncResult;
    transfers?: SyncResult;
    plants?: SyncResult;
    batches?: SyncResult;
    harvests?: SyncResult;
    labTests?: SyncResult;
  }

  const results: FacilityResult[] = [];
  const shouldSync = (entity: string) => !onlyArg || onlyArg === entity;

  for (const facility of facilities) {
    console.log(`\n[${facility.name} / ${facility.licenseNumber}]`);
    const result: FacilityResult = { facility: facility.name };
    let rateLimited = false;

    const runSync = async (
      label: string,
      key: keyof Omit<FacilityResult, 'facility'>,
      fn: () => Promise<{ count: number; deactivated?: number }>,
    ) => {
      if (rateLimited) return;
      try {
        const r = await fn();
        result[key] = { count: r.count, deactivated: r.deactivated };
        console.log(`  ${label}: ${r.count} upserted, ${r.deactivated ?? 0} deactivated`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result[key] = { error: msg };
        console.error(`  ${label} FAILED: ${msg}`);
        if (msg.includes('429') || msg.includes('rate limit')) {
          console.warn('  Rate limited — skipping remaining syncs for this facility');
          rateLimited = true;
        }
      }
    };

    if (shouldSync('packages')) {
      await runSync('packages', 'packages', () => syncFacilityPackages(facility as MetrcFacility, { mode: modeArg }));
    }
    if (shouldSync('sales')) {
      await runSync('sales', 'sales', async () => {
        const r = await syncFacilitySales(facility as MetrcFacility);
        return { count: r.receiptsUpserted ?? 0 };
      });
    }
    if (shouldSync('active-sales')) {
      await runSync('active-sales', 'activeSales', async () => {
        const r = await syncFacilityActiveSales(facility as MetrcFacility);
        return { count: r.receiptsUpserted ?? 0 };
      });
    }
    if (shouldSync('transfers')) {
      await runSync('transfers', 'transfers', () => syncFacilityTransfers(facility as MetrcFacility, { mode: modeArg }));
    }
    if (shouldSync('plants')) {
      await runSync('plants', 'plants', () => syncFacilityPlants(facility as MetrcFacility, { mode: modeArg }));
    }
    if (shouldSync('batches')) {
      await runSync('batches', 'batches', () => syncFacilityPlantBatches(facility as MetrcFacility, { mode: modeArg }));
    }
    if (shouldSync('harvests')) {
      await runSync('harvests', 'harvests', () => syncFacilityHarvests(facility as MetrcFacility, { mode: modeArg }));
    }
    if (shouldSync('labtests')) {
      await runSync('labTests', 'labTests', () => syncFacilityLabTests(facility as MetrcFacility, { mode: modeArg }));
    }

    results.push(result);

    if (rateLimited) {
      // Rate limited on this facility — cool down longer before trying the next one
      console.log('  Cooling down 60s before next facility...');
      rateLimited = false; // Reset so next facility gets a chance
      await sleep(60_000);
    } else if (facilities.indexOf(facility) < facilities.length - 1) {
      // Normal throttle between facilities
      await sleep(FACILITY_DELAY_MS);
    }
  }

  const hasError = (r: FacilityResult) =>
    r.packages?.error || r.sales?.error || r.activeSales?.error || r.transfers?.error || r.plants?.error || r.batches?.error || r.harvests?.error || r.labTests?.error;

  console.log(`\n=== Sync Complete ===`);
  console.log(`Successful: ${results.filter(r => !hasError(r)).length}`);
  console.log(`Failed:     ${results.filter(r => hasError(r)).length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
