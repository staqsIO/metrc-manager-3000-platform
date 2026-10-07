/**
 * One-time backfill script: populate empty inactive PackageSnapshot records
 * from Metrc Excel exports.
 *
 * Reads ~/Downloads/Massachusetts *Inactive Packages.xlsx files,
 * matches by facilityId + packageLabel, and updates records that have
 * empty metadata (itemName, itemCategory, etc.).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-inactive-packages.ts
 *   npx tsx src/scripts/backfill-inactive-packages.ts --dry-run
 */

import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 10; // Small batches to stay within Supabase session-mode pool (15 connections)

interface ExcelRow {
  tag: string;
  sourceHarvests: string | null;
  location: string | null;
  item: string | null;
  category: string | null;
  itemStrain: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  labTestStatus: string | null;
  packagedDate: Date | null;
}

// Column indices (0-based) matching the 23-column A-W schema
const COL = {
  TAG: 1,              // A
  SOURCE_HARVESTS: 2,  // B
  LOCATION: 6,         // F
  ITEM: 9,             // I
  CATEGORY: 10,        // J
  ITEM_STRAIN: 11,     // K
  QUANTITY: 12,         // L
  UNIT_OF_MEASURE: 13, // M
  LAB_TEST_STATUS: 16, // P
  PACKAGED_DATE: 20,   // T
} as const;

function parseRow(row: ExcelJS.Row): ExcelRow | null {
  const tag = row.getCell(COL.TAG).value;
  if (!tag || typeof tag !== 'string') return null;

  const rawDate = row.getCell(COL.PACKAGED_DATE).value;
  let packagedDate: Date | null = null;
  if (rawDate instanceof Date) {
    packagedDate = rawDate;
  } else if (typeof rawDate === 'string' && rawDate) {
    const parsed = new Date(rawDate);
    if (!isNaN(parsed.getTime())) packagedDate = parsed;
  }

  return {
    tag: tag.trim(),
    sourceHarvests: cellStr(row, COL.SOURCE_HARVESTS),
    location: cellStr(row, COL.LOCATION),
    item: cellStr(row, COL.ITEM),
    category: cellStr(row, COL.CATEGORY),
    itemStrain: cellStr(row, COL.ITEM_STRAIN),
    quantity: Number(row.getCell(COL.QUANTITY).value) || 0,
    unitOfMeasure: cellStr(row, COL.UNIT_OF_MEASURE),
    labTestStatus: cellStr(row, COL.LAB_TEST_STATUS),
    packagedDate,
  };
}

function cellStr(row: ExcelJS.Row, col: number): string | null {
  const val = row.getCell(col).value;
  if (val === null || val === undefined || val === '') return null;
  return String(val).trim() || null;
}

function extractLicense(filename: string): string | null {
  // "Massachusetts MR000103 Inactive Packages.xlsx" → "MR000103"
  const parts = filename.split(' ');
  return parts.length >= 2 ? parts[1]! : null;
}

async function processFile(filePath: string, filename: string) {
  const license = extractLicense(filename);
  if (!license) {
    console.error(`  Could not extract license from: ${filename}`);
    return;
  }

  // Look up facility by license number
  const facility = await prisma.metrcFacility.findFirst({
    where: { licenseNumber: license },
    select: { id: true, name: true, licenseNumber: true },
  });

  if (!facility) {
    console.error(`  No facility found for license: ${license}`);
    return;
  }

  console.log(`\n  Facility: ${facility.name} (${license})`);
  console.log(`  File: ${filename}`);

  // Read Excel
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    console.error('  No worksheet found');
    return;
  }

  // Parse all rows (skip header)
  const rows: ExcelRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const parsed = parseRow(row);
    if (parsed) rows.push(parsed);
  });

  console.log(`  Excel rows: ${rows.length}`);

  // Pre-fetch all existing package labels for this facility to build a lookup map
  // This avoids N individual queries
  const existingPackages = await prisma.packageSnapshot.findMany({
    where: { facilityId: facility.id },
    select: { id: true, packageLabel: true, itemName: true },
  });

  const labelToId = new Map<string, { id: string; itemName: string }>();
  for (const pkg of existingPackages) {
    labelToId.set(pkg.packageLabel, { id: pkg.id, itemName: pkg.itemName });
  }

  console.log(`  DB records: ${existingPackages.length}`);

  let updated = 0;
  let skippedNoMatch = 0;
  let skippedAlreadyPopulated = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const updates: Promise<unknown>[] = [];

    for (const row of batch) {
      const existing = labelToId.get(row.tag);
      if (!existing) {
        skippedNoMatch++;
        continue;
      }

      // Skip if itemName is already populated (not empty string)
      if (existing.itemName && existing.itemName.trim() !== '') {
        skippedAlreadyPopulated++;
        continue;
      }

      if (DRY_RUN) {
        updated++;
        continue;
      }

      updates.push(
        prisma.packageSnapshot.update({
          where: { id: existing.id },
          data: {
            itemName: row.item ?? '',
            itemCategory: row.category,
            itemStrainName: row.itemStrain,
            quantity: new Prisma.Decimal(row.quantity),
            unitOfMeasure: row.unitOfMeasure,
            locationName: row.location,
            sourceHarvestNames: row.sourceHarvests,
            labTestingState: row.labTestStatus,
            packagedDate: row.packagedDate,
          },
        })
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      updated += updates.length;
    }

    // Progress indicator every 10K rows
    if ((i + BATCH_SIZE) % 10000 < BATCH_SIZE) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} rows processed`);
    }
  }

  console.log(`  Results${DRY_RUN ? ' (DRY RUN)' : ''}:`);
  console.log(`    Updated: ${updated}`);
  console.log(`    Skipped (no DB match): ${skippedNoMatch}`);
  console.log(`    Skipped (already populated): ${skippedAlreadyPopulated}`);
}

async function main() {
  console.log(`Inactive Package Backfill${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log('=========================================');

  const downloadsDir = join(homedir(), 'Downloads');
  const files = readdirSync(downloadsDir)
    .filter(f => f.includes('Inactive Packages') && f.endsWith('.xlsx'))
    .sort();

  console.log(`Found ${files.length} Excel files`);

  for (const file of files) {
    await processFile(join(downloadsDir, file), file);
  }

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
