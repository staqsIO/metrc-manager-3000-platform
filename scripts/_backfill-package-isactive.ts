/**
 * One-off backfill: mark PackageSnapshot rows as isActive=false when they're
 * effectively inactive (quantity <= 0, finishedDate set, or archivedDate set).
 *
 * Pairs with the read-layer fix in snapshot-utils.ts and the cron-side fix in
 * package-sync.ts. The read-layer filter masks the symptom; this backfill
 * corrects the underlying snapshot state so future queries that use isActive
 * directly (without the quantity gate) also behave correctly.
 *
 * Run: pnpm tsx scripts/_backfill-package-isactive.ts
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const before = await prisma.packageSnapshot.count({
    where: {
      isActive: true,
      OR: [
        { quantity: { lte: 0 } },
        { finishedDate: { not: null } },
        { archivedDate: { not: null } },
      ],
    },
  });

  console.log(`[backfill] ${before} rows match: isActive=true AND (qty<=0 OR finishedDate set OR archivedDate set)`);
  if (before === 0) {
    console.log('[backfill] nothing to do');
    return;
  }

  const result = await prisma.packageSnapshot.updateMany({
    where: {
      isActive: true,
      OR: [
        { quantity: { lte: 0 } },
        { finishedDate: { not: null } },
        { archivedDate: { not: null } },
      ],
    },
    data: { isActive: false, lastSyncedAt: new Date() },
  });

  console.log(`[backfill] updated ${result.count} rows → isActive=false`);

  const remainingZeroQty = await prisma.packageSnapshot.count({
    where: { isActive: true, quantity: { lte: 0 } },
  });
  console.log(`[backfill] remaining isActive=true rows with quantity<=0: ${remainingZeroQty}`);
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
