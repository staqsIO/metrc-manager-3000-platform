/**
 * Quick probe script to inspect sandbox state (tags, items, etc.)
 * Usage: METRC_VENDOR_API_KEY_CO=... METRC_USER_API_KEY_CO=... npx tsx scripts/probe-sandbox.ts
 */
import { MetrcClient } from '@metrc-formul8-os/client';

const stateCode = process.argv[2] || 'CO';
const license = process.argv[3] || 'SF-SBX-CO-21-8002';

const vendorKey = process.env[`METRC_VENDOR_API_KEY_${stateCode}`] || process.env.METRC_VENDOR_API_KEY || '';
const userKey = process.env[`METRC_USER_API_KEY_${stateCode}`] || process.env.METRC_USER_API_KEY || '';

if (!vendorKey || !userKey) {
  console.error(`Set METRC_VENDOR_API_KEY_${stateCode} and METRC_USER_API_KEY_${stateCode}`);
  process.exit(1);
}

const client = new MetrcClient({
  stateCode,
  licenseNumber: license,
  vendorApiKey: vendorKey,
  userApiKey: userKey,
  environment: 'sandbox',
  authMethod: 'basic',
});

async function main(): Promise<void> {
  console.log(`Probing ${stateCode} sandbox — ${license}\n`);

  // Tags
  console.log('=== TAGS ===');
  try {
    const tags = await client.getAvailableTags();
    const types = Array.from(new Set(tags.map(t => t.TagTypeName)));
    console.log(`Total tags: ${tags.length}`);
    for (const type of types) {
      const ofType = tags.filter(t => t.TagTypeName === type);
      console.log(`  ${type}: ${ofType.length} tags (sample: ${ofType[0]?.Label})`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Items
  console.log('\n=== ITEMS ===');
  try {
    const items = await client.getActiveItems();
    console.log(`Active items: ${items.length}`);
    for (const item of items.slice(0, 10)) {
      console.log(`  ${item.Name} | cat: ${item.ProductCategoryName} | uom: ${item.UnitOfMeasureName} | strain: ${item.StrainName ?? 'none'}`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Strains
  console.log('\n=== STRAINS ===');
  try {
    const strains = await client.getActiveStrains();
    console.log(`Active strains: ${strains.length}`);
    for (const s of strains.slice(0, 10)) {
      console.log(`  ${s.Name} | testing: ${s.TestingStatus} | thc: ${s.ThcLevel} | cbd: ${s.CbdLevel}`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Locations
  console.log('\n=== LOCATIONS ===');
  try {
    const locations = await client.getActiveLocations();
    console.log(`Active locations: ${locations.length}`);
    for (const loc of locations.slice(0, 10)) {
      console.log(`  ${loc.Name} | type: ${loc.LocationTypeName}`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Plant batches
  console.log('\n=== PLANT BATCHES ===');
  try {
    const batches = await client.getActivePlantBatches();
    console.log(`Active batches: ${batches.length}`);
    for (const b of batches.slice(0, 5)) {
      console.log(`  ${b.Name} | strain: ${b.StrainName} | count: ${b.UntrackedCount}`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Packages
  console.log('\n=== PACKAGES ===');
  try {
    const packages = await client.getActivePackages();
    console.log(`Active packages: ${packages.length}`);
    for (const p of packages.slice(0, 5)) {
      console.log(`  ${p.Label} | ${p.ItemName} | qty: ${p.Quantity} ${p.UnitOfMeasureName}`);
    }
  } catch (e: unknown) {
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
