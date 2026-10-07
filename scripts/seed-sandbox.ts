/**
 * Comprehensive Metrc Sandbox Seeder
 *
 * Populates a single facility with realistic data so all platform views show content:
 *   - Strains, Items, Plant Batches, Growth Phase transitions
 *   - Packages (varied ages, categories, lab states)
 *   - Transfers (varied employees for Operations view)
 *   - Lab Tests (THC/CBD/terpene/pesticide pass/fail mix)
 *   - DB: Business Rules, Compliance Alerts, Tolling Agreements, Audit Snapshots
 *
 * Usage:
 *   cd formul8-metrc-platform
 *
 *   # Seed a specific facility comprehensively
 *   npx tsx scripts/seed-sandbox.ts --facilityId <FACILITY_ID>
 *
 *   # Dry run — show what would be created
 *   npx tsx scripts/seed-sandbox.ts --facilityId <FACILITY_ID> --dry-run
 *
 *   # Legacy mode: provision all 28 CO sandbox facilities into DB (no --facilityId)
 *   npx tsx scripts/seed-sandbox.ts --provision-all
 *
 * Prerequisites:
 *   - .env.local must contain METRC_ENCRYPTION_KEY, METRC_ENCRYPTION_SALT, DATABASE_URL
 *   - Prisma client must be generated (pnpm db:generate)
 *   - The target facility must already exist in the database (run --provision-all first)
 */
import crypto from 'crypto';
import './load-env'; // must precede the prisma import so env is populated
import { prisma, dashboardPrisma } from '../src/lib/prisma';

// ── Constants ─────────────────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}. Get sandbox keys from METRC (see README → METRC keys).`);
    process.exit(1);
  }
  return v;
}

const SANDBOX_STATES = {
  CO: {
    label: 'Colorado',
    baseUrl: 'https://sandbox-api-co.metrc.com',
    get vendorKey() { return requireEnv('METRC_VENDOR_API_KEY_CO'); },
    get userKey() { return requireEnv('METRC_USER_API_KEY_CO'); },
  },
  MA: {
    label: 'Massachusetts',
    baseUrl: 'https://sandbox-api-ma.metrc.com',
    get vendorKey() { return requireEnv('METRC_VENDOR_API_KEY_MA'); },
    get userKey() { return requireEnv('METRC_USER_API_KEY_MA'); },
  },
};
const DELAY_MS = 400;

// ── Parse CLI args ───────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const DRY_RUN = args.includes('--dry-run');
const PROVISION_ALL = args.includes('--provision-all');
const FACILITY_ID = getArg('facilityId');

// ── Encryption ───────────────────────────────────────────────────────
function encrypt(text: string): string {
  const key = process.env.METRC_ENCRYPTION_KEY;
  const salt = process.env.METRC_ENCRYPTION_SALT;
  if (!key || !salt) throw new Error('METRC_ENCRYPTION_KEY and METRC_ENCRYPTION_SALT must be set');
  const derivedKey = crypto.scryptSync(key, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

// ── HTTP helpers ─────────────────────────────────────────────────────
// Active state for API calls — set by seedFacility() based on facility.stateCode
let activeBaseUrl: string = SANDBOX_STATES.CO.baseUrl;
let activeAuthHeader = '';

function setActiveState(stateCode: string) {
  const cfg = SANDBOX_STATES[stateCode as keyof typeof SANDBOX_STATES];
  if (!cfg) throw new Error(`No sandbox config for state: ${stateCode}`);
  activeBaseUrl = cfg.baseUrl;
  activeAuthHeader = `Basic ${Buffer.from(`${cfg.vendorKey}:${cfg.userKey}`).toString('base64')}`;
}

async function metrcGet<T>(endpoint: string, license: string): Promise<T> {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${activeBaseUrl}${endpoint}${sep}licenseNumber=${license}`;
  const res = await fetch(url, { headers: { Authorization: activeAuthHeader } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${endpoint} [${license}] → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function metrcPost(endpoint: string, license: string, data: unknown): Promise<{ ok: boolean; body: string; status: number }> {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${activeBaseUrl}${endpoint}${sep}licenseNumber=${license}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: activeAuthHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.text().catch(() => '');
  return { ok: res.ok, body, status: res.status };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Types ────────────────────────────────────────────────────────────
interface SandboxFacility {
  FacilityId: number;
  Name: string;
  License: { Number: string; LicenseType: string };
  FacilityType: {
    CanGrowPlants: boolean;
    CanCreateDerivedPackages: boolean;
    CanSellToConsumers: boolean;
    CanTestPackages: boolean;
    CanInfuseProducts: boolean;
    CanReportStrainProperties: boolean;
    // Confirmed by Metrc support (case #02372700, Feb 2026):
    // These flags control which transfer and package creation endpoints are available.
    CanCreateOpeningBalancePackages: boolean;
    CanTransferFromExternalFacilities: boolean;
  };
}

interface SandboxTag { Id: number; Label: string; FacilityId?: number }
interface SandboxLocation { Id: number; Name: string; LocationTypeName: string; ForPlantBatches: boolean; ForPlants: boolean; ForHarvests: boolean; ForPackages: boolean }
interface SandboxItem { Id: number; Name: string; ProductCategoryName: string; UnitOfMeasureName: string; StrainName: string }
interface SandboxStrain { Id: number; Name: string }
interface SandboxPackage { Id: number; Label: string; Quantity: number; UnitOfMeasureName: string; ItemName?: string; Item?: { Name: string }; PackagedDate?: string; LabTestingState?: string; ItemCategory?: string }

// ── Strain definitions (10 strains with varied profiles) ─────────────
const STRAINS_TO_CREATE = [
  { Name: 'Blue Dream', TestingStatus: 'None', ThcLevel: 0.21, CbdLevel: 0.001, IndicaPercentage: 40, SativaPercentage: 60 },
  { Name: 'OG Kush', TestingStatus: 'None', ThcLevel: 0.24, CbdLevel: 0.003, IndicaPercentage: 75, SativaPercentage: 25 },
  { Name: 'Girl Scout Cookies', TestingStatus: 'None', ThcLevel: 0.25, CbdLevel: 0.002, IndicaPercentage: 60, SativaPercentage: 40 },
  { Name: 'Sour Diesel', TestingStatus: 'None', ThcLevel: 0.22, CbdLevel: 0.002, IndicaPercentage: 10, SativaPercentage: 90 },
  { Name: 'Granddaddy Purple', TestingStatus: 'None', ThcLevel: 0.20, CbdLevel: 0.01, IndicaPercentage: 80, SativaPercentage: 20 },
  { Name: 'Jack Herer', TestingStatus: 'None', ThcLevel: 0.23, CbdLevel: 0.003, IndicaPercentage: 20, SativaPercentage: 80 },
  { Name: 'Wedding Cake', TestingStatus: 'None', ThcLevel: 0.25, CbdLevel: 0.001, IndicaPercentage: 70, SativaPercentage: 30 },
  { Name: 'Gelato', TestingStatus: 'None', ThcLevel: 0.26, CbdLevel: 0.001, IndicaPercentage: 55, SativaPercentage: 45 },
  { Name: 'ACDC', TestingStatus: 'None', ThcLevel: 0.01, CbdLevel: 0.20, IndicaPercentage: 50, SativaPercentage: 50 },
  { Name: 'Harlequin', TestingStatus: 'None', ThcLevel: 0.05, CbdLevel: 0.10, IndicaPercentage: 25, SativaPercentage: 75 },
];

// ── Employee names (used in transfers for Operations view) ───────────
const EMPLOYEE_NAMES = [
  'jsmith@facility.com',
  'maria.garcia@facility.com',
  'david.chen@facility.com',
  'sarah.johnson@facility.com',
  'alex.rivera@facility.com',
  'mike.thompson@facility.com',
  'lisa.nguyen@facility.com',
  'james.wilson@facility.com',
];

// ── Partner facilities (for transfers) — must use REAL sandbox licenses ──
const PARTNER_FACILITIES = [
  { name: 'Sandbox Retail MIP', license: 'SF-SBX-CO-22-8002' },
  { name: 'Sandbox Retail Store', license: 'SF-SBX-CO-24-8002' },
  { name: 'Sandbox Retail Testing Lab', license: 'SF-SBX-CO-25-8002' },
  { name: 'Sandbox Medical Marijuana Store', license: 'SF-SBX-CO-9-8002' },
  { name: 'Sandbox Medical Testing Lab', license: 'SF-SBX-CO-11-8002' },
  { name: 'Sandbox Retail Off Premises Storage', license: 'SF-SBX-CO-23-8002' },
];

// =====================================================================
// PROVISION ALL (legacy mode)
// =====================================================================

function classifyFacility(f: SandboxFacility): string {
  if (f.FacilityType.CanGrowPlants) return 'Cultivator';
  if (f.FacilityType.CanInfuseProducts) return 'Manufacturer';
  if (f.FacilityType.CanSellToConsumers) return 'Dispensary';
  if (f.FacilityType.CanTestPackages) return 'Testing Lab';
  if (f.License.LicenseType.toLowerCase().includes('transporter')) return 'Transporter';
  if (f.License.LicenseType.toLowerCase().includes('storage')) return 'Storage';
  if (f.License.LicenseType.toLowerCase().includes('operator')) return 'Operator';
  return 'Other';
}

async function provisionAll() {
  // Resolve org from Dashboard DB
  const memberships = await dashboardPrisma.membership.findMany({
    select: { organizationId: true },
    take: 1,
  });
  if (memberships.length === 0) {
    console.log('  ERROR: No membership found. Create an account in the app first.');
    return;
  }
  const orgId = memberships[0].organizationId;
  console.log(`  Using organization: ${orgId}`);

  // Ensure the Organization record exists in the Metrc DB (fresh DB won't have it).
  // The Metrc schema has a real FK: MetrcFacility → Organization → User.
  const existingOrg = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existingOrg) {
    const dashboardOrg = await dashboardPrisma.organization.findUnique({ where: { id: orgId } });
    if (!dashboardOrg) {
      console.log('  ERROR: Organization not found in Dashboard DB.');
      return;
    }
    // Sync the owner User first (Organization.ownerId FK requires it)
    const existingUser = await prisma.user.findUnique({ where: { id: dashboardOrg.ownerId } });
    if (!existingUser) {
      const dashboardUser = await dashboardPrisma.user.findUnique({ where: { id: dashboardOrg.ownerId } });
      if (dashboardUser) {
        await prisma.user.create({
          data: { id: dashboardUser.id, name: dashboardUser.name, email: dashboardUser.email },
        });
        console.log(`  Synced user ${dashboardUser.email} to Metrc DB`);
      } else {
        console.log('  ERROR: Owner user not found in Dashboard DB.');
        return;
      }
    }
    await prisma.organization.create({
      data: {
        id: dashboardOrg.id,
        name: dashboardOrg.name,
        slug: dashboardOrg.slug,
        ownerId: dashboardOrg.ownerId,
      },
    });
    console.log(`  Synced organization "${dashboardOrg.name}" to Metrc DB`);
  }

  // Provision each state
  let totalCreated = 0;
  for (const [stateCode, cfg] of Object.entries(SANDBOX_STATES)) {
    console.log(`\n=== Provisioning ${cfg.label} (${stateCode}) sandbox facilities ===`);
    const authHeader = `Basic ${Buffer.from(`${cfg.vendorKey}:${cfg.userKey}`).toString('base64')}`;
    const url = `${cfg.baseUrl}/facilities/v2/`;
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      console.log(`  ERROR: Failed to fetch ${stateCode} facilities: HTTP ${res.status}`);
      continue;
    }
    const facilities = await res.json() as SandboxFacility[];
    console.log(`  Found ${facilities.length} facilities`);

    const encVendor = encrypt(cfg.vendorKey);
    const encUser = encrypt(cfg.userKey);
    let created = 0;

    for (const f of facilities) {
      const license = f.License.Number;
      const facilityType = classifyFacility(f);
      try {
        await prisma.metrcFacility.upsert({
          where: { organizationId_licenseNumber: { organizationId: orgId, licenseNumber: license } },
          update: {
            name: f.Name, facilityType, metrcEnvironment: 'sandbox',
            encryptedSandboxVendorApiKey: encVendor, encryptedSandboxUserApiKey: encUser, isActive: true,
          },
          create: {
            organizationId: orgId, name: f.Name, licenseNumber: license, stateCode,
            facilityType, metrcEnvironment: 'sandbox',
            encryptedSandboxVendorApiKey: encVendor, encryptedSandboxUserApiKey: encUser, isActive: true,
          },
        });
        created++;
        console.log(`  + ${license} | ${f.Name} (${facilityType})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  - ${license} SKIP: ${msg.slice(0, 500)}`);
      }
    }
    console.log(`  Done: ${created} ${stateCode} facilities upserted`);
    totalCreated += created;

    // Create strains on eligible facilities (using state-specific auth)
    console.log(`\n=== Creating strains (${stateCode}) ===`);
    const strainFacilities = facilities.filter(f => f.FacilityType.CanReportStrainProperties);
    for (const f of strainFacilities) {
      const license = f.License.Number;
      // Use state-specific API for strain operations
      const sep = '/strains/v1/active'.includes('?') ? '&' : '?';
      const getUrl = `${cfg.baseUrl}/strains/v1/active${sep}licenseNumber=${license}`;
      const getRes = await fetch(getUrl, { headers: { Authorization: authHeader } });
      if (!getRes.ok) { console.log(`  ${license}: error fetching strains (HTTP ${getRes.status})`); continue; }
      const existing = await getRes.json() as SandboxStrain[];
      const existingNames = new Set(existing.map((s: SandboxStrain) => s.Name));
      const toCreate = STRAINS_TO_CREATE.filter(s => !existingNames.has(s.Name));
      if (toCreate.length === 0) { console.log(`  ${license}: all strains exist`); continue; }
      const postUrl = `${cfg.baseUrl}/strains/v1/create?licenseNumber=${license}`;
      const postRes = await fetch(postUrl, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(toCreate),
      });
      const body = await postRes.text();
      console.log(`  ${license}: ${postRes.ok ? `created ${toCreate.length}` : `error: ${body.slice(0, 80)}`}`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n  Total: ${totalCreated} facilities upserted across all states`);
}

// =====================================================================
// COMPREHENSIVE FACILITY SEEDER
// =====================================================================

async function seedFacility(facilityId: string) {
  // Load facility from DB
  const facility = await prisma.metrcFacility.findUnique({ where: { id: facilityId } });
  if (!facility) {
    console.error(`Facility not found: ${facilityId}`);
    console.error('Run --provision-all first to add sandbox facilities to the database.');
    process.exit(1);
  }

  const LICENSE = facility.licenseNumber;
  console.log(`\nTarget facility: ${facility.name}`);
  console.log(`License: ${LICENSE}`);
  console.log(`State: ${facility.stateCode}`);
  console.log(`Environment: ${facility.metrcEnvironment}`);
  console.log(`Dry run: ${DRY_RUN}`);

  // Set the active METRC API credentials for this facility's state
  setActiveState(facility.stateCode);

  if (facility.metrcEnvironment !== 'sandbox') {
    console.error('ERROR: This script only targets sandbox environments for safety.');
    process.exit(1);
  }

  // ── Fetch reference data ────────────────────────────────────────
  console.log('\n=== Step 0: Fetching reference data ===');
  const [locations, existingStrains, existingItems, pkgTags, plantTags] = await Promise.all([
    metrcGet<SandboxLocation[]>('/locations/v1/active', LICENSE),
    metrcGet<SandboxStrain[]>('/strains/v1/active', LICENSE),
    metrcGet<SandboxItem[]>('/items/v1/active', LICENSE),
    metrcGet<SandboxTag[]>('/tags/v2/package/available', LICENSE),
    metrcGet<SandboxTag[]>('/tags/v2/plant/available', LICENSE).catch(() => [] as SandboxTag[]),
  ]);

  console.log(`  Locations: ${locations.length}`);
  console.log(`  Strains: ${existingStrains.length}`);
  console.log(`  Items: ${existingItems.length}`);
  console.log(`  Package tags available: ${pkgTags.length}`);
  console.log(`  Plant tags available: ${plantTags.length}`);

  const batchLoc = locations.find(l => l.ForPlantBatches) ?? locations[0];
  const plantLoc = locations.find(l => l.ForPlants) ?? locations[0];
  const harvestLoc = locations.find(l => l.ForHarvests) ?? locations[0];
  const pkgLoc = locations.find(l => l.ForPackages) ?? locations[0];

  if (!batchLoc) {
    console.error('ERROR: No locations found. Facility may need initial setup in Metrc.');
    process.exit(1);
  }

  let pkgTagIdx = 0;
  let plantTagIdx = 0;

  // ── Step 1: Create strains ──────────────────────────────────────
  console.log('\n=== Step 1: Creating strains ===');
  const existingStrainNames = new Set(existingStrains.map(s => s.Name));
  const strainsToCreate = STRAINS_TO_CREATE.filter(s => !existingStrainNames.has(s.Name));

  if (strainsToCreate.length === 0) {
    console.log('  All 10 strains already exist');
  } else if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create ${strainsToCreate.length} strains: ${strainsToCreate.map(s => s.Name).join(', ')}`);
  } else {
    const strainRes = await metrcPost('/strains/v1/create', LICENSE, strainsToCreate);
    if (strainRes.ok) {
      console.log(`  Created ${strainsToCreate.length} strains`);
    } else {
      console.log(`  Strain creation error: ${strainRes.body.slice(0, 200)}`);
    }
    await sleep(DELAY_MS);
  }

  // Refresh strains after creation
  const strains = DRY_RUN ? [...existingStrains, ...strainsToCreate.map((s, i) => ({ Id: 999000 + i, Name: s.Name }))]
    : await metrcGet<SandboxStrain[]>('/strains/v1/active', LICENSE);

  // ── Step 1.5: Create items (Pre-Roll, Concentrate, Edible, Vape) ──
  console.log('\n=== Step 1.5: Creating items for diversified categories ===');

  // Discover valid item categories from the sandbox
  interface SandboxItemCategory { Name: string; ProductCategoryType: string; QuantityType: string; RequiresStrain: boolean }
  let itemCategories: SandboxItemCategory[] = [];
  try {
    itemCategories = await metrcGet<SandboxItemCategory[]>('/items/v1/categories', LICENSE);
    console.log(`  Found ${itemCategories.length} item categories`);
  } catch (err) {
    console.log(`  Could not fetch item categories: ${err instanceof Error ? err.message : err}`);
  }

  // Build a lookup of which categories require strains
  const catRequiresStrain = new Map<string, boolean>();
  for (const c of itemCategories) catRequiresStrain.set(c.Name, c.RequiresStrain);

  // Use REAL Metrc category names from the sandbox:
  //   Buds (WeightBased, RequiresStrain)           → flower
  //   Shake/Trim (by strain) (WeightBased, Strain) → trim / biomass
  //   Concentrate (WeightBased, no strain)          → bulk concentrates
  //   Concentrate (Each) (CountBased, no strain)    → packaged concentrate units
  //   Infused (edible) (CountBased, no strain)      → gummies, chocolate, etc.
  //   Infused (non-edible) (CountBased, no strain)  → pre-rolls, vape carts, tinctures, topicals
  //   Bud allocated for extraction (WeightBased)    → extraction feedstock
  //   Shake/Trim allocated for extraction (Weight)  → extraction feedstock
  const catNames = itemCategories.map(c => c.Name);
  console.log(`  Available categories: ${catNames.join(', ')}`);

  // Define items using actual Metrc categories and correct POST field names.
  // Metrc POST /items/v1/create uses different field names than GET responses:
  //   POST: UnitOfMeasure, Strain, ItemCategory
  //   GET:  UnitOfMeasureName, StrainName, ProductCategoryName
  // Required potency fields vary by category:
  //   Buds/Shake/Concentrate: UnitThcPercent, UnitCbdPercent
  //   Infused (edible/non-edible): UnitThcContent, UnitThcContentUnitOfMeasure, UnitCbdPercent
  const itemStrains = ['Blue Dream', 'OG Kush', 'Girl Scout Cookies', 'Sour Diesel', 'Gelato'];
  const strainThc: Record<string, number> = {
    'Blue Dream': 21.0, 'OG Kush': 24.0, 'Girl Scout Cookies': 25.0,
    'Sour Diesel': 22.0, 'Gelato': 26.0,
  };
  type MetrcItemPayload = Record<string, unknown>;
  const ITEMS_TO_CREATE: MetrcItemPayload[] = [];

  for (const strain of itemStrains) {
    const thc = strainThc[strain] ?? 22.0;
    // Flower buds (Buds — WeightBased, RequiresStrain)
    ITEMS_TO_CREATE.push({ Name: `${strain} Buds`, ItemCategory: 'Buds', UnitOfMeasure: 'Grams', Strain: strain, UnitThcPercent: thc, UnitCbdPercent: 0.1 });
    // Shake/Trim for biomass (Shake/Trim by strain — WeightBased, RequiresStrain)
    ITEMS_TO_CREATE.push({ Name: `${strain} Shake/Trim`, ItemCategory: 'Shake/Trim (by strain)', UnitOfMeasure: 'Grams', Strain: strain, UnitThcPercent: thc * 0.6, UnitCbdPercent: 0.1 });
    // Extraction feedstock (Bud allocated for extraction — WeightBased, RequiresStrain)
    ITEMS_TO_CREATE.push({ Name: `${strain} Extraction Buds`, ItemCategory: 'Bud allocated for extraction', UnitOfMeasure: 'Grams', Strain: strain, UnitThcPercent: thc, UnitCbdPercent: 0.1 });
  }

  // Categories that do NOT require strain — product-level items
  // Concentrates — bulk weight (Concentrate — WeightBased, uses UnitThcPercent)
  ITEMS_TO_CREATE.push({ Name: 'Live Resin Bulk', ItemCategory: 'Concentrate', UnitOfMeasure: 'Grams', UnitThcPercent: 75.0, UnitCbdPercent: 0.5 });
  ITEMS_TO_CREATE.push({ Name: 'Shatter Bulk', ItemCategory: 'Concentrate', UnitOfMeasure: 'Grams', UnitThcPercent: 80.0, UnitCbdPercent: 0.3 });
  ITEMS_TO_CREATE.push({ Name: 'Distillate Bulk', ItemCategory: 'Concentrate', UnitOfMeasure: 'Grams', UnitThcPercent: 90.0, UnitCbdPercent: 0.1 });
  // Concentrates — packaged units (Concentrate (Each) — CountBased, requires UnitWeight)
  ITEMS_TO_CREATE.push({ Name: 'Live Resin 1g Jar', ItemCategory: 'Concentrate (Each)', UnitOfMeasure: 'Each', UnitThcPercent: 75.0, UnitCbdPercent: 0.5, UnitWeight: 1.0, UnitWeightUnitOfMeasure: 'Grams' });
  ITEMS_TO_CREATE.push({ Name: 'Shatter 1g Slab', ItemCategory: 'Concentrate (Each)', UnitOfMeasure: 'Each', UnitThcPercent: 80.0, UnitCbdPercent: 0.3, UnitWeight: 1.0, UnitWeightUnitOfMeasure: 'Grams' });
  ITEMS_TO_CREATE.push({ Name: 'Distillate 1g Syringe', ItemCategory: 'Concentrate (Each)', UnitOfMeasure: 'Each', UnitThcPercent: 90.0, UnitCbdPercent: 0.1, UnitWeight: 1.0, UnitWeightUnitOfMeasure: 'Grams' });
  // Edibles (Infused (edible) — CountBased, uses UnitThcContent in mg)
  ITEMS_TO_CREATE.push({ Name: 'Gummies 10pk 100mg', ItemCategory: 'Infused (edible)', UnitOfMeasure: 'Each', UnitThcContent: 100.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: 'Chocolate Bar 100mg', ItemCategory: 'Infused (edible)', UnitOfMeasure: 'Each', UnitThcContent: 100.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: 'Mints Tin 100mg', ItemCategory: 'Infused (edible)', UnitOfMeasure: 'Each', UnitThcContent: 50.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  // Pre-Rolls & Vape Carts (Infused (non-edible) — CountBased, uses UnitThcContent in mg)
  // In CO Metrc, pre-rolls and vapes are classified as "Infused (non-edible)"
  ITEMS_TO_CREATE.push({ Name: '1g Infused Pre-Roll', ItemCategory: 'Infused (non-edible)', UnitOfMeasure: 'Each', UnitThcContent: 200.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: '0.5g Infused Pre-Roll', ItemCategory: 'Infused (non-edible)', UnitOfMeasure: 'Each', UnitThcContent: 100.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: '1g Vape Cartridge', ItemCategory: 'Infused (non-edible)', UnitOfMeasure: 'Each', UnitThcContent: 800.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: '0.5g Vape Cartridge', ItemCategory: 'Infused (non-edible)', UnitOfMeasure: 'Each', UnitThcContent: 400.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 0.1 });
  ITEMS_TO_CREATE.push({ Name: 'Tincture 30ml', ItemCategory: 'Infused (non-edible)', UnitOfMeasure: 'Each', UnitThcContent: 300.0, UnitThcContentUnitOfMeasure: 'Milligrams', UnitCbdPercent: 5.0 });

  const existingItemNames = new Set(existingItems.map(i => i.Name));
  const itemsToCreate = ITEMS_TO_CREATE.filter(i => !existingItemNames.has(i.Name as string));

  if (itemsToCreate.length === 0) {
    console.log('  All diversified items already exist');
  } else if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create ${itemsToCreate.length} items:`);
    const byCat = new Map<string, number>();
    for (const i of itemsToCreate) byCat.set(i.ItemCategory as string, (byCat.get(i.ItemCategory as string) ?? 0) + 1);
    for (const [cat, count] of Array.from(byCat)) console.log(`    ${cat}: ${count} items`);
  } else {
    // Metrc POST /items/v1/create accepts arrays — batch in groups of 20
    for (let i = 0; i < itemsToCreate.length; i += 20) {
      const batch = itemsToCreate.slice(i, i + 20);
      const res = await metrcPost('/items/v1/create', LICENSE, batch);
      if (res.ok) {
        console.log(`  Created ${batch.length} items (batch ${Math.floor(i / 20) + 1})`);
      } else {
        console.log(`  FAIL creating items batch: ${res.body.slice(0, 200)}`);
      }
      await sleep(DELAY_MS);
    }
    console.log(`  Total new items attempted: ${itemsToCreate.length}`);
  }

  // ── Step 2: Create plant batches ────────────────────────────────
  console.log('\n=== Step 2: Creating plant batches ===');
  const batchConfigs = [
    // Mix of Seed and Clone, varied ages, spread across strains
    { name: 'F8-BlueDream-Seed-01', strain: 'Blue Dream', type: 'Seed', count: 30, daysAgo: 85 },
    { name: 'F8-BlueDream-Clone-02', strain: 'Blue Dream', type: 'Clone', count: 20, daysAgo: 60 },
    { name: 'F8-OGKush-Seed-01', strain: 'OG Kush', type: 'Seed', count: 25, daysAgo: 75 },
    { name: 'F8-OGKush-Clone-02', strain: 'OG Kush', type: 'Clone', count: 15, daysAgo: 45 },
    { name: 'F8-GSC-Seed-01', strain: 'Girl Scout Cookies', type: 'Seed', count: 35, daysAgo: 90 },
    { name: 'F8-SourDiesel-Clone-01', strain: 'Sour Diesel', type: 'Clone', count: 25, daysAgo: 50 },
    { name: 'F8-GDP-Seed-01', strain: 'Granddaddy Purple', type: 'Seed', count: 20, daysAgo: 70 },
    { name: 'F8-JackHerer-Clone-01', strain: 'Jack Herer', type: 'Clone', count: 30, daysAgo: 40 },
    { name: 'F8-WeddingCake-Seed-01', strain: 'Wedding Cake', type: 'Seed', count: 25, daysAgo: 55 },
    { name: 'F8-Gelato-Clone-01', strain: 'Gelato', type: 'Clone', count: 20, daysAgo: 35 },
    { name: 'F8-ACDC-Seed-01', strain: 'ACDC', type: 'Seed', count: 15, daysAgo: 65 },
    { name: 'F8-Harlequin-Clone-01', strain: 'Harlequin', type: 'Clone', count: 10, daysAgo: 30 },
  ];

  for (const batch of batchConfigs) {
    const strainExists = strains.some(s => s.Name === batch.strain);
    if (!strainExists) {
      console.log(`  SKIP ${batch.name}: strain "${batch.strain}" not found`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create batch: ${batch.name} (${batch.type}, ${batch.count} plants, ${batch.strain}, ${batch.daysAgo} days ago)`);
      continue;
    }

    const res = await metrcPost('/plantbatches/v1/createplantings', LICENSE, [{
      Name: batch.name,
      Type: batch.type,
      Count: batch.count,
      Strain: batch.strain,
      Location: batchLoc.Name,
      ActualDate: daysAgo(batch.daysAgo),
    }]);

    if (res.ok) {
      console.log(`  Created ${batch.name}: ${batch.count} ${batch.type}s (${batch.strain})`);
    } else {
      console.log(`  FAIL ${batch.name}: ${res.body.slice(0, 120)}`);
    }
    await sleep(DELAY_MS);
  }

  // ── Step 3: Change growth phases ────────────────────────────────
  console.log('\n=== Step 3: Changing growth phases ===');
  // Move older batches to Flowering
  const phaseChanges = [
    { batch: 'F8-BlueDream-Seed-01', count: 15, phase: 'Flowering' as const, daysAgo: 60 },
    { batch: 'F8-OGKush-Seed-01', count: 12, phase: 'Flowering' as const, daysAgo: 50 },
    { batch: 'F8-GSC-Seed-01', count: 18, phase: 'Flowering' as const, daysAgo: 55 },
    { batch: 'F8-GDP-Seed-01', count: 10, phase: 'Flowering' as const, daysAgo: 45 },
    { batch: 'F8-BlueDream-Seed-01', count: 10, phase: 'Vegetative' as const, daysAgo: 70 },
    { batch: 'F8-OGKush-Seed-01', count: 10, phase: 'Vegetative' as const, daysAgo: 60 },
    { batch: 'F8-SourDiesel-Clone-01', count: 12, phase: 'Vegetative' as const, daysAgo: 35 },
    { batch: 'F8-JackHerer-Clone-01', count: 15, phase: 'Vegetative' as const, daysAgo: 25 },
    { batch: 'F8-WeddingCake-Seed-01', count: 12, phase: 'Vegetative' as const, daysAgo: 40 },
    { batch: 'F8-Gelato-Clone-01', count: 10, phase: 'Vegetative' as const, daysAgo: 20 },
  ];

  for (const change of phaseChanges) {
    if (plantTagIdx + change.count > plantTags.length) {
      console.log(`  STOP: Not enough plant tags (need ${change.count}, have ${plantTags.length - plantTagIdx})`);
      break;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would move ${change.count} from ${change.batch} → ${change.phase}`);
      plantTagIdx += change.count;
      continue;
    }

    const startTag = plantTags[plantTagIdx].Label;
    plantTagIdx += change.count;

    const res = await metrcPost('/plantbatches/v1/changegrowthphase', LICENSE, [{
      Name: change.batch,
      Count: change.count,
      StartingTag: startTag,
      GrowthPhase: change.phase,
      NewLocation: change.phase === 'Flowering' ? plantLoc.Name : batchLoc.Name,
      GrowthDate: daysAgo(change.daysAgo),
    }]);

    if (res.ok) {
      console.log(`  ${change.batch}: ${change.count} → ${change.phase}`);
    } else {
      console.log(`  FAIL ${change.batch} → ${change.phase}: ${res.body.slice(0, 120)}`);
    }
    await sleep(DELAY_MS);
  }

  // ── Step 4: Harvest flowering plants ────────────────────────────
  console.log('\n=== Step 4: Harvesting flowering plants ===');
  if (!DRY_RUN) {
    let floweringPlants: Array<{ Id: number; Label: string; StrainName: string }> = [];
    try {
      floweringPlants = await metrcGet<Array<{ Id: number; Label: string; StrainName: string }>>(
        '/plants/v1/flowering',
        LICENSE,
      );
    } catch {
      console.log('  SKIPPED: Facility does not support plant endpoints (non-cultivator)');
    }
    console.log(`  Found ${floweringPlants.length} flowering plants`);

    // Harvest in groups by strain
    const byStrain = new Map<string, typeof floweringPlants>();
    for (const p of floweringPlants) {
      const list = byStrain.get(p.StrainName) ?? [];
      list.push(p);
      byStrain.set(p.StrainName, list);
    }

    for (const [strainName, plants] of Array.from(byStrain.entries())) {
      const toHarvest = plants.slice(0, Math.min(8, plants.length));
      if (toHarvest.length === 0) continue;

      const harvestName = `F8-Harvest-${strainName.replace(/\s+/g, '')}-${Date.now().toString(36).slice(-4)}`;
      const harvestPayload = toHarvest.map((p: { Id: number; Label: string; StrainName: string }) => ({
        Plant: p.Label,
        Weight: randomInt(150, 350),
        UnitOfWeight: 'Grams',
        DryingLocation: harvestLoc.Name,
        HarvestName: harvestName,
        ActualDate: daysAgo(randomInt(5, 25)),
      }));

      const res = await metrcPost('/plants/v1/harvestplants', LICENSE, harvestPayload);
      if (res.ok) {
        console.log(`  Harvested ${toHarvest.length} ${strainName} plants → ${harvestName}`);
      } else {
        console.log(`  FAIL harvest ${strainName}: ${res.body.slice(0, 120)}`);
      }
      await sleep(DELAY_MS);
    }
  } else {
    console.log('  [DRY RUN] Would harvest flowering plants grouped by strain');
  }

  // ── Step 5: Create packages from harvests ───────────────────────
  console.log('\n=== Step 5: Creating packages from harvests ===');
  const items = DRY_RUN ? existingItems : await metrcGet<SandboxItem[]>('/items/v1/active', LICENSE);
  const budItems = items.filter(i => i.ProductCategoryName === 'Buds');
  const shakeItems = items.filter(i => i.ProductCategoryName.startsWith('Shake'));

  if (!DRY_RUN) {
    // v2 harvests return { Data: [...] }
    let harvestList: Array<{ Id: number; Name: string; CurrentWeight: number }> = [];
    try {
      const harvestResp = await metrcGet<{ Data?: Array<{ Id: number; Name: string; CurrentWeight: number }> } | Array<{ Id: number; Name: string; CurrentWeight: number }>>('/harvests/v2/active', LICENSE);
      harvestList = Array.isArray(harvestResp) ? harvestResp : (harvestResp.Data ?? []);
    } catch {
      console.log('  SKIPPED: Facility does not support harvest endpoints');
    }
    console.log(`  Active harvests: ${harvestList.length}`);

    // Age distribution for packages: vary ActualDate
    const ageBuckets = [
      { weight: 0.30, minDays: 0, maxDays: 30 },   // fresh
      { weight: 0.25, minDays: 31, maxDays: 60 },   // normal
      { weight: 0.25, minDays: 61, maxDays: 90 },   // aging
      { weight: 0.20, minDays: 91, maxDays: 120 },  // critical
    ];

    let totalPkgsCreated = 0;
    for (const harvest of harvestList) {
      if (harvest.CurrentWeight < 50) continue;

      // Create 2-4 packages per harvest
      const numPkgs = randomInt(2, 4);
      const weightPerPkg = Math.floor(harvest.CurrentWeight / (numPkgs + 1));

      for (let i = 0; i < numPkgs; i++) {
        if (pkgTagIdx >= pkgTags.length) {
          console.log('  Out of package tags');
          break;
        }

        // Pick age bucket based on distribution
        const roll = Math.random();
        let cumulative = 0;
        let bucket = ageBuckets[0];
        for (const b of ageBuckets) {
          cumulative += b.weight;
          if (roll <= cumulative) { bucket = b; break; }
        }

        const item = i % 2 === 0
          ? (budItems[i % budItems.length] ?? items[0])
          : (shakeItems[i % Math.max(1, shakeItems.length)] ?? budItems[0] ?? items[0]);
        if (!item) continue;

        const tag = pkgTags[pkgTagIdx].Label;
        pkgTagIdx++;
        const pkgAge = randomInt(bucket.minDays, bucket.maxDays);

        const res = await metrcPost('/harvests/v2/packages', LICENSE, [{
          Tag: tag,
          Location: pkgLoc.Name,
          Item: item.Name,
          UnitOfWeight: 'Grams',
          ActualDate: daysAgo(pkgAge),
          Ingredients: [{ HarvestId: harvest.Id, Weight: weightPerPkg, UnitOfWeight: 'Grams' }],
        }]);

        if (res.ok) {
          totalPkgsCreated++;
          console.log(`  Package ${tag.slice(-6)} (${item.ProductCategoryName}, ${weightPerPkg}g, ${pkgAge}d old)`);
        } else {
          console.log(`  FAIL pkg: ${res.body.slice(0, 120)}`);
        }
        await sleep(DELAY_MS);
      }
    }
    console.log(`  Total packages created: ${totalPkgsCreated}`);
  } else {
    console.log('  [DRY RUN] Would create 40-60 packages from harvests with varied age distribution');
  }

  // ── Step 5b: Create diversified packages (Pre-Rolls, Concentrates, Biomass) ──
  console.log('\n=== Step 5b: Creating diversified packages (derived from existing) ===');

  // Refresh items after Step 1.5 creation — use real Metrc category names
  const allItems = DRY_RUN ? existingItems : await metrcGet<SandboxItem[]>('/items/v1/active', LICENSE);
  // Infused (non-edible) = pre-rolls, vape carts, tinctures in CO Metrc
  const infusedNonEdibleItems = allItems.filter(i => i.ProductCategoryName === 'Infused (non-edible)');
  // Concentrate = bulk weight; Concentrate (Each) = packaged units
  const concentrateItems = allItems.filter(i => i.ProductCategoryName === 'Concentrate' || i.ProductCategoryName === 'Concentrate (Each)');
  // Infused (edible) = gummies, chocolate, mints
  const edibleItems = allItems.filter(i => i.ProductCategoryName === 'Infused (edible)');
  // Shake/Trim + Buds for biomass
  const biomassItems = allItems.filter(i =>
    i.ProductCategoryName === 'Shake/Trim' || i.ProductCategoryName === 'Shake/Trim (by strain)'
    || i.ProductCategoryName === 'Buds'
  );

  console.log(`  Available items: Infused non-edible (pre-roll/vape)=${infusedNonEdibleItems.length}, Concentrate=${concentrateItems.length}, Edible=${edibleItems.length}, Biomass=${biomassItems.length}`);

  if (!DRY_RUN) {
    // Get source packages to derive from (need packages with enough quantity)
    const sourcePkgs = await metrcGet<SandboxPackage[]>('/packages/v1/active', LICENSE);
    // Use a low threshold — sandbox packages from harvests may be small (20-100g)
    const viableSources = sourcePkgs.filter(p => p.Quantity >= 10);
    // Separate weight-based vs count-based sources — Metrc rejects consuming
    // "Grams" from an "Each" package (WeightBased vs CountBased mismatch).
    const weightSources = viableSources.filter(p => p.UnitOfMeasureName === 'Grams' || p.UnitOfMeasureName === 'Ounces' || p.UnitOfMeasureName === 'Pounds');
    const eachSources = viableSources.filter(p => p.UnitOfMeasureName === 'Each');
    console.log(`  Viable source packages (≥10 qty): ${viableSources.length} (${weightSources.length} weight-based, ${eachSources.length} count-based)`);

    // Refresh available package tags
    const freshPkgTags = await metrcGet<SandboxTag[]>('/tags/v2/package/available', LICENSE);
    let derivedTagIdx = 0;

    let derivedPkgsCreated = 0;

    // Helper: create a derived package from a source package
    const createDerivedPackage = async (
      sourceLabel: string,
      sourceQty: number,
      sourceUoM: string,
      item: SandboxItem,
      quantity: number,
      agedays: number,
    ): Promise<boolean> => {
      if (derivedTagIdx >= freshPkgTags.length) {
        console.log('  Out of package tags for derived packages');
        return false;
      }
      const tag = freshPkgTags[derivedTagIdx].Label;
      derivedTagIdx++;

      const useQty = Math.min(quantity, sourceQty * 0.3); // Never use more than 30% of source

      const res = await metrcPost('/packages/v1/create', LICENSE, [{
        Tag: tag,
        Location: pkgLoc.Name,
        Item: item.Name,
        Quantity: useQty,
        UnitOfMeasure: item.UnitOfMeasureName,
        ActualDate: daysAgo(agedays),
        Ingredients: [{
          Package: sourceLabel,
          Quantity: useQty,
          // Ingredient UoM must match the source package's UoM, not the derived item's.
          UnitOfMeasure: sourceUoM,
        }],
      }]);

      if (res.ok) {
        derivedPkgsCreated++;
        console.log(`  Derived ${tag.slice(-6)} → ${item.Name} (${useQty} ${item.UnitOfMeasureName}, ${agedays}d old)`);
        return true;
      } else {
        console.log(`  FAIL derived ${item.Name}: ${res.body.slice(0, 150)}`);
        return false;
      }
    }

    // Each category loop picks source packages via modulo so we cycle
    // through available sources even when there are fewer sources than
    // total derived packages across all categories.

    // All derived items consume from weight-based source packages (harvest output
    // is always Grams). Using weightSources avoids "WeightBased vs CountBased"
    // Metrc errors when a source package happens to be in "Each".

    // Infused (non-edible) packages: pre-rolls + vape carts (50-500 Each)
    if (infusedNonEdibleItems.length > 0 && weightSources.length > 0) {
      console.log('  Creating Infused (non-edible) packages (pre-rolls, vape carts)...');
      for (let i = 0; i < Math.min(8, infusedNonEdibleItems.length); i++) {
        const src = weightSources[i % weightSources.length];
        const qty = randomInt(50, 500);
        await createDerivedPackage(src.Label, src.Quantity, src.UnitOfMeasureName, infusedNonEdibleItems[i % infusedNonEdibleItems.length], qty, randomInt(5, 60));
        await sleep(DELAY_MS);
      }
    }

    // Concentrate packages: 100-1000 (Grams for bulk, Each for packaged)
    if (concentrateItems.length > 0 && weightSources.length > 0) {
      console.log('  Creating Concentrate packages...');
      for (let i = 0; i < Math.min(6, concentrateItems.length); i++) {
        const src = weightSources[i % weightSources.length];
        const item = concentrateItems[i % concentrateItems.length];
        const qty = item.UnitOfMeasureName === 'Each' ? randomInt(50, 300) : randomInt(100, 1000);
        await createDerivedPackage(src.Label, src.Quantity, src.UnitOfMeasureName, item, qty, randomInt(10, 75));
        await sleep(DELAY_MS);
      }
    }

    // Edible packages: Infused (edible) — 20-200 Each
    if (edibleItems.length > 0 && weightSources.length > 0) {
      console.log('  Creating Infused (edible) packages...');
      for (let i = 0; i < Math.min(4, edibleItems.length); i++) {
        const src = weightSources[i % weightSources.length];
        const qty = randomInt(20, 200);
        await createDerivedPackage(src.Label, src.Quantity, src.UnitOfMeasureName, edibleItems[i % edibleItems.length], qty, randomInt(5, 45));
        await sleep(DELAY_MS);
      }
    }

    // Biomass/Trim + Buds packages: large quantities (2000-10000g = ~4-22 lbs)
    if (biomassItems.length > 0 && weightSources.length > 0) {
      console.log('  Creating Biomass/Trim packages (large qty)...');
      for (let i = 0; i < Math.min(4, biomassItems.length); i++) {
        const src = weightSources[i % weightSources.length];
        const qty = randomInt(2000, 10000);
        await createDerivedPackage(src.Label, src.Quantity, src.UnitOfMeasureName, biomassItems[i % biomassItems.length], qty, randomInt(15, 90));
        await sleep(DELAY_MS);
      }
    }

    console.log(`  Total derived packages created: ${derivedPkgsCreated}`);
  } else {
    console.log('  [DRY RUN] Would create ~22 derived packages:');
    console.log('    Infused (non-edible) [pre-roll/vape]: ~8 packages (50-500 Each)');
    console.log('    Concentrate / Concentrate (Each): ~6 packages (100-1000g or 50-300 Each)');
    console.log('    Infused (edible): ~4 packages (20-200 Each)');
    console.log('    Biomass (Buds/Shake/Trim): ~4 packages (2000-10000g = 4-22 lbs)');
  }

  // ── Step 6: Adjust some packages for compliance issues ──────────
  console.log('\n=== Step 6: Creating compliance-triggering package states ===');
  if (!DRY_RUN) {
    const allPkgs = await metrcGet<SandboxPackage[]>('/packages/v1/active', LICENSE);
    console.log(`  Active packages: ${allPkgs.length}`);

    // Zero out a few packages (triggers Zero Quantity rule)
    const toZero = allPkgs.filter(p => p.Quantity > 0 && p.Quantity < 200).slice(0, 3);
    for (const pkg of toZero) {
      const res = await metrcPost('/packages/v1/adjust', LICENSE, [{
        Label: pkg.Label,
        Quantity: -pkg.Quantity,
        UnitOfMeasureName: pkg.UnitOfMeasureName,
        AdjustmentReason: 'Waste',
        AdjustmentDate: daysAgo(2),
        ReasonNote: 'Quality inspection - product degradation',
      }]);
      if (res.ok) {
        console.log(`  Zeroed ${pkg.Label.slice(-6)} (was ${pkg.Quantity})`);
      }
      await sleep(DELAY_MS);
    }
  } else {
    console.log('  [DRY RUN] Would zero out 3 small packages for compliance alerts');
  }

  // ── Step 6a: Create outgoing transfer templates ────────────────
  // NOTE (confirmed by Metrc support, case #02372700, Feb 2026):
  //   Transfers are template-only via the METRC API. The correct endpoint is
  //   POST /transfers/v2/templates/outgoing. The endpoint
  //   POST /transfers/v2/external/outgoing does NOT exist (returns 404).
  //   POST /transfers/v2/external/incoming requires
  //   FacilityType.CanTransferFromExternalFacilities=true (testing labs only in CO).
  //   Templates require: Name, TransporterFacilityLicenseNumber,
  //   Destinations[].Transporters[] (driver info), and PlannedRoute.
  //   Templates appear in the /transfers/v2/templates/outgoing endpoint.
  //   They won't appear in /transfers/v1/outgoing until physically dispatched,
  //   but the Operations view uses both template and transfer data.
  console.log('\n=== Step 6a: Creating outgoing transfer templates ===');
  if (!DRY_RUN) {
    const transferPkgs = await metrcGet<SandboxPackage[]>('/packages/v1/active', LICENSE);
    const availableForTransfer = transferPkgs.filter(p => p.Quantity > 0).slice(0, 30);

    // Fetch transfer types — v2 response wraps in { Data: [...] }
    let transferTypeNames: string[] = [];
    try {
      const typesResp = await metrcGet<{ Data?: Array<{ Name: string }> } | Array<{ Name: string }>>('/transfers/v2/types', LICENSE);
      const typesList = Array.isArray(typesResp) ? typesResp : (typesResp.Data ?? []);
      transferTypeNames = typesList.map(t => t.Name);
      console.log(`  Transfer types: ${transferTypeNames.slice(0, 5).join(', ')}${transferTypeNames.length > 5 ? '...' : ''}`);
    } catch (err) {
      console.log(`  Could not fetch transfer types: ${err instanceof Error ? err.message : err}`);
    }

    // Use 'Transfer to Testing Facility' (no WholesalePrice) or 'Unaffiliated' (with price)
    const testTransferType = transferTypeNames.find(t => t === 'Transfer to Testing Facility');
    const unaffiliatedType = transferTypeNames.find(t => t === 'Unaffiliated');

    let transferPkgIdx = 0;
    let transfersCreated = 0;

    const transferConfigs = [
      { partner: PARTNER_FACILITIES[0], driver: EMPLOYEE_NAMES[0], daysAgo: 3, pkgCount: 2, type: 'test' as const },
      { partner: PARTNER_FACILITIES[1], driver: EMPLOYEE_NAMES[1], daysAgo: 7, pkgCount: 2, type: 'unaffiliated' as const },
      { partner: PARTNER_FACILITIES[2], driver: EMPLOYEE_NAMES[2], daysAgo: 12, pkgCount: 3, type: 'test' as const },
      { partner: PARTNER_FACILITIES[3], driver: EMPLOYEE_NAMES[3], daysAgo: 15, pkgCount: 2, type: 'unaffiliated' as const },
      { partner: PARTNER_FACILITIES[4], driver: EMPLOYEE_NAMES[4], daysAgo: 18, pkgCount: 2, type: 'test' as const },
      { partner: PARTNER_FACILITIES[5], driver: EMPLOYEE_NAMES[5], daysAgo: 22, pkgCount: 2, type: 'unaffiliated' as const },
      { partner: PARTNER_FACILITIES[0], driver: EMPLOYEE_NAMES[6], daysAgo: 25, pkgCount: 2, type: 'test' as const },
      { partner: PARTNER_FACILITIES[1], driver: EMPLOYEE_NAMES[7], daysAgo: 28, pkgCount: 2, type: 'unaffiliated' as const },
    ];

    for (const tc of transferConfigs) {
      if (transferPkgIdx + tc.pkgCount > availableForTransfer.length) {
        console.log(`  Not enough packages for more transfers`);
        break;
      }

      const typeName = tc.type === 'test' ? testTransferType : unaffiliatedType;
      if (!typeName) {
        console.log(`  SKIP: Transfer type "${tc.type}" not available`);
        continue;
      }

      const transferPackages = [];
      for (let i = 0; i < tc.pkgCount; i++) {
        const pkg = availableForTransfer[transferPkgIdx++];
        const pkgEntry: Record<string, unknown> = {
          PackageLabel: pkg.Label,
          GrossWeight: Math.min(pkg.Quantity, 100),
          GrossUnitOfWeightName: 'Grams',
        };
        // Unaffiliated transfers support WholesalePrice; testing transfers don't
        if (tc.type === 'unaffiliated') {
          pkgEntry.WholesalePrice = randomInt(200, 3000);
        }
        transferPackages.push(pkgEntry);
      }

      const shipDate = daysAgo(tc.daysAgo);
      const arriveDate = daysAgo(Math.max(0, tc.daysAgo - 1));
      const driverName = tc.driver.split('@')[0].replace('.', ' ');

      const payload = [{
        Name: `F8-Transfer-${tc.partner.name.slice(0, 10).replace(/\s/g, '')}-${Date.now().toString(36).slice(-4)}`,
        TransporterFacilityLicenseNumber: LICENSE,
        TransporterFacilityName: facility.name,
        Destinations: [{
          RecipientLicenseNumber: tc.partner.license,
          TransferTypeName: typeName,
          PlannedRoute: `Route ${String.fromCharCode(65 + transfersCreated)} - Direct`,
          EstimatedDepartureDateTime: `${shipDate}T08:00:00.000`,
          EstimatedArrivalDateTime: `${arriveDate}T14:00:00.000`,
          Transporters: [{
            TransporterFacilityLicenseNumber: LICENSE,
            TransporterFacilityName: facility.name,
            TransporterDirection: 'Outbound',
            EstimatedDepartureDateTime: `${shipDate}T08:00:00.000`,
            EstimatedArrivalDateTime: `${arriveDate}T14:00:00.000`,
            DriverName: driverName,
            DriverLicenseNumber: `DL-${randomInt(100000, 999999)}`,
            VehicleMake: randomChoice(['Ford', 'Toyota', 'Chevrolet', 'RAM']),
            VehicleModel: randomChoice(['Transit', 'Tacoma', 'Express', 'ProMaster']),
            VehicleLicensePlateNumber: `CO-${randomInt(100, 999)}-${String.fromCharCode(65 + randomInt(0, 25))}${String.fromCharCode(65 + randomInt(0, 25))}${String.fromCharCode(65 + randomInt(0, 25))}`,
          }],
          Packages: transferPackages,
        }],
      }];

      const res = await metrcPost('/transfers/v2/templates/outgoing', LICENSE, payload);
      if (res.ok) {
        transfersCreated++;
        console.log(`  Template to ${tc.partner.name} (${tc.pkgCount} pkgs, ${typeName}) by ${driverName}`);
      } else {
        console.log(`  FAIL ${tc.partner.name}: ${res.body.slice(0, 200)}`);
      }
      await sleep(DELAY_MS);
    }
    console.log(`  Total transfer templates created: ${transfersCreated}`);
  } else {
    console.log('  [DRY RUN] Would create 8 outgoing transfer templates with varied drivers');
  }

  // ── Step 6b: Record lab test results ──────────────────────────
  // NOTE (confirmed by Metrc support, case #02372700, Feb 2026):
  //   Only Testing Lab facility types (FacilityType.CanTestPackages=true)
  //   can call POST /labtests/v1/record. Non-lab facilities get HTTP 401.
  //   The package must also be physically present at the lab (transferred there).
  //   For a cultivation facility, lab tests require a multi-facility workflow:
  //     1. Create outgoing transfer template to testing lab
  //     2. Testing lab receives the transfer
  //     3. Testing lab records lab tests using their license
  //   This script creates the outgoing templates (Step 6a) but cannot complete
  //   the full cycle. Lab test data remains empty on sandbox cultivation facilities.
  console.log('\n=== Step 6b: Lab test results ===');
  console.log('  SKIPPED: Lab test recording requires a Testing Lab facility license.');
  console.log('  Cultivation facilities cannot call POST /labtests/v1/record directly.');
  console.log('  Packages remain in "NotSubmitted" lab testing state.');

  // ── Step 7: Seed DB — Business Rules ────────────────────────────
  console.log('\n=== Step 7: Seeding business rules ===');
  const existingRules = await prisma.businessRule.count({ where: { facilityId } });

  if (existingRules > 0) {
    console.log(`  ${existingRules} rules already exist, skipping`);
  } else if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create 10 default business rules`);
  } else {
    const DEFAULT_RULES = [
      { name: 'Aging Warning (60+ days)', description: 'Package has been in inventory for over 60 days', category: 'aging', severity: 'WARNING', conditions: [{ field: 'ageDays', operator: 'gte', value: 60 }], actionType: 'ALERT', metadata: { thresholdDays: 60 } },
      { name: 'Aging Critical (90+ days)', description: 'Package has been in inventory for over 90 days and requires immediate attention', category: 'aging', severity: 'CRITICAL', conditions: [{ field: 'ageDays', operator: 'gte', value: 90 }], actionType: 'ALERT', metadata: { thresholdDays: 90 } },
      { name: 'Low Quantity Flower', description: 'Flower package quantity is critically low (under 10g)', category: 'inventory', severity: 'INFO', conditions: [{ field: 'Quantity', operator: 'lt', value: 10, itemCategory: 'Flower' }], actionType: 'ALERT' },
      { name: 'Zero Quantity Package', description: 'Package has zero or negative quantity and should be finished', category: 'inventory', severity: 'WARNING', conditions: [{ field: 'Quantity', operator: 'lte', value: 0 }], actionType: 'ALERT' },
      { name: 'Large Package Warning', description: 'Package has unusually large quantity (over 4000 units)', category: 'inventory', severity: 'INFO', conditions: [{ field: 'Quantity', operator: 'gt', value: 4000 }], actionType: 'ALERT' },
      { name: 'Package On Hold', description: 'Package is currently on administrative hold', category: 'compliance', severity: 'CRITICAL', conditions: [{ field: 'IsOnHold', operator: 'eq', value: true }], actionType: 'ALERT' },
      { name: 'Remediation Required', description: 'Package requires remediation and has not been processed', category: 'compliance', severity: 'CRITICAL', conditions: [{ field: 'ProductRequiresRemediation', operator: 'eq', value: true }], actionType: 'ALERT' },
      { name: 'Lab Testing Not Submitted', description: 'Package has not been submitted for lab testing', category: 'compliance', severity: 'WARNING', conditions: [{ field: 'LabTestingState', operator: 'eq', value: 'NotSubmitted' }, { field: 'ageDays', operator: 'gte', value: 14 }], actionType: 'ALERT', metadata: { gracePeriodDays: 14 } },
      { name: 'Lab Test Failed', description: 'Package has failed lab testing and needs remediation or destruction', category: 'compliance', severity: 'CRITICAL', conditions: [{ field: 'LabTestingState', operator: 'eq', value: 'TestFailed' }], actionType: 'ALERT' },
      { name: 'Slow Moving Inventory (90+ days)', description: 'Package has not moved in over 90 days - urgent action required', category: 'operations', severity: 'WARNING', conditions: [{ field: 'ageDays', operator: 'gte', value: 90 }], actionType: 'NOTIFICATION' },
    ];

    for (const rule of DEFAULT_RULES) {
      await prisma.businessRule.create({
        data: {
          facilityId,
          name: rule.name,
          description: rule.description,
          category: rule.category,
          severity: rule.severity,
          conditions: rule.conditions,
          actionType: rule.actionType,
          metadata: rule.metadata ?? undefined,
          isActive: true,
          isDefault: true,
        },
      });
    }
    console.log(`  Created ${DEFAULT_RULES.length} business rules`);
  }

  // ── Step 8: Evaluate rules → generate compliance alerts ─────────
  console.log('\n=== Step 8: Evaluating rules & generating compliance alerts ===');
  if (DRY_RUN) {
    console.log('  [DRY RUN] Would evaluate rules against packages and create 10-20 alerts');
  } else {
    // Fetch current packages for rule evaluation
    const allPkgs = await metrcGet<SandboxPackage[]>('/packages/v1/active', LICENSE);
    const rules = await prisma.businessRule.findMany({ where: { facilityId, isActive: true } });

    // Simple in-script rule evaluation (mirrors rules-engine.ts logic)
    const alerts: Array<{
      facilityId: string; category: string; severity: string;
      title: string; description: string; packageLabel: string;
      ruleId: string; status: string;
    }> = [];

    for (const pkg of allPkgs) {
      const pkgDate = pkg.PackagedDate ?? '';
      const ageDays = pkgDate
        ? Math.floor((Date.now() - new Date(pkgDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const itemName = pkg.ItemName ?? (pkg.Item?.Name ?? 'Unknown');

      for (const rule of rules) {
        const conditions = rule.conditions as Array<{ field: string; operator: string; value: unknown; itemCategory?: string }>;
        if (!conditions?.length) continue;

        const allMatch = conditions.every(c => {
          let fieldVal: unknown;
          switch (c.field) {
            case 'ageDays': fieldVal = ageDays; break;
            case 'Quantity': fieldVal = pkg.Quantity; break;
            case 'LabTestingState': fieldVal = pkg.LabTestingState; break;
            case 'IsOnHold': fieldVal = false; break; // we don't have this from active endpoint easily
            case 'ProductRequiresRemediation': fieldVal = false; break;
            default: fieldVal = undefined;
          }
          if (fieldVal === undefined) return false;
          switch (c.operator) {
            case 'gte': return typeof fieldVal === 'number' && fieldVal >= (c.value as number);
            case 'gt': return typeof fieldVal === 'number' && fieldVal > (c.value as number);
            case 'lte': return typeof fieldVal === 'number' && fieldVal <= (c.value as number);
            case 'lt': return typeof fieldVal === 'number' && fieldVal < (c.value as number);
            case 'eq': return fieldVal === c.value;
            default: return false;
          }
        });

        if (allMatch) {
          alerts.push({
            facilityId,
            category: rule.category,
            severity: rule.severity,
            title: `${rule.name}: ${itemName}`,
            description: `${rule.description}. Package: ${pkg.Label}, Qty: ${pkg.Quantity}, Age: ${ageDays}d`,
            packageLabel: pkg.Label,
            ruleId: rule.id,
            status: 'OPEN',
          });
        }
      }
    }

    // Deduplicate: one alert per package per rule
    const uniqueAlerts = new Map<string, typeof alerts[0]>();
    for (const a of alerts) {
      const key = `${a.packageLabel}:${a.ruleId}`;
      if (!uniqueAlerts.has(key)) uniqueAlerts.set(key, a);
    }
    const deduped = Array.from(uniqueAlerts.values());

    if (deduped.length > 0) {
      // Clear old alerts first to avoid duplicates on re-run
      await prisma.complianceAlert.deleteMany({ where: { facilityId, status: 'OPEN' } });
      await prisma.complianceAlert.createMany({ data: deduped });
      console.log(`  Created ${deduped.length} compliance alerts`);
      const bySeverity = { CRITICAL: 0, WARNING: 0, INFO: 0 };
      for (const a of deduped) {
        if (a.severity in bySeverity) bySeverity[a.severity as keyof typeof bySeverity]++;
      }
      console.log(`  Breakdown: ${bySeverity.CRITICAL} critical, ${bySeverity.WARNING} warning, ${bySeverity.INFO} info`);
    } else {
      console.log('  No rule violations found (this may happen if packages are very new)');
    }
  }

  // ── Step 9: Seed tolling agreements ─────────────────────────────
  console.log('\n=== Step 9: Seeding tolling agreements ===');
  const existingAgreements = await prisma.tollingAgreement.count({ where: { facilityId } });

  if (existingAgreements > 0) {
    console.log(`  ${existingAgreements} agreements already exist, skipping`);
  } else if (DRY_RUN) {
    console.log('  [DRY RUN] Would create 4 tolling agreements');
  } else {
    const now = new Date();
    const agreements = [
      {
        facilityId,
        partnerName: 'Sandbox Retail MIP',
        partnerLicense: 'SF-SBX-CO-22-8002',
        agreementType: 'OUTBOUND',
        status: 'ACTIVE',
        startDate: new Date(now.getFullYear(), now.getMonth() - 3, 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + 3, 1),
        inputWeight: 5000,
        outputWeight: 3500,
        processingFee: 2.50,
        totalFees: 8750,
        inputPackageIds: [],
        outputPackageIds: [],
        terms: { yieldGuarantee: '70%', qualityStandards: 'COA required', timeline: '14 business days' },
        notes: 'Concentrate extraction - shatter and live resin',
      },
      {
        facilityId,
        partnerName: 'Sandbox Retail Testing Lab',
        partnerLicense: 'SF-SBX-CO-25-8002',
        agreementType: 'INBOUND',
        status: 'ACTIVE',
        startDate: new Date(now.getFullYear(), now.getMonth() - 2, 15),
        endDate: new Date(now.getFullYear(), now.getMonth() + 4, 15),
        inputWeight: 3000,
        outputWeight: 2400,
        processingFee: 3.00,
        totalFees: 7200,
        inputPackageIds: [],
        outputPackageIds: [],
        terms: { yieldGuarantee: '80%', qualityStandards: 'Full panel testing', timeline: '10 business days' },
        notes: 'Flower processing and trimming services',
      },
      {
        facilityId,
        partnerName: 'Sandbox Retail Store',
        partnerLicense: 'SF-SBX-CO-24-8002',
        agreementType: 'OUTBOUND',
        status: 'ACTIVE',
        startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + 5, 1),
        inputWeight: 8000,
        outputWeight: null,
        processingFee: 1.75,
        totalFees: null,
        inputPackageIds: [],
        outputPackageIds: [],
        terms: { yieldGuarantee: '65%', qualityStandards: 'State compliant', timeline: '21 business days' },
        notes: 'Edible infusion and pre-roll manufacturing',
      },
      {
        facilityId,
        partnerName: 'Sandbox Medical Marijuana Store',
        partnerLicense: 'SF-SBX-CO-9-8002',
        agreementType: 'INBOUND',
        status: 'COMPLETED',
        startDate: new Date(now.getFullYear(), now.getMonth() - 6, 1),
        endDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        inputWeight: 4500,
        outputWeight: 3800,
        processingFee: 2.00,
        totalFees: 7600,
        inputPackageIds: [],
        outputPackageIds: [],
        terms: { yieldGuarantee: '85%', qualityStandards: 'Premium grade', timeline: '7 business days' },
        notes: 'Completed processing contract - premium flower',
      },
    ];

    await prisma.tollingAgreement.createMany({ data: agreements });
    console.log(`  Created ${agreements.length} tolling agreements`);
  }

  // ── Step 10: Seed audit snapshot ────────────────────────────────
  console.log('\n=== Step 10: Seeding audit snapshot ===');
  const existingSnapshots = await prisma.auditSnapshot.count({ where: { facilityId } });

  if (existingSnapshots > 0) {
    console.log(`  ${existingSnapshots} snapshots already exist, skipping`);
  } else if (DRY_RUN) {
    console.log('  [DRY RUN] Would create 1 audit snapshot');
  } else {
    const alertCounts = await prisma.complianceAlert.groupBy({
      by: ['severity'],
      where: { facilityId },
      _count: true,
    });

    const criticalCount = alertCounts.find(a => a.severity === 'CRITICAL')?._count ?? 0;
    const warningCount = alertCounts.find(a => a.severity === 'WARNING')?._count ?? 0;
    const infoCount = alertCounts.find(a => a.severity === 'INFO')?._count ?? 0;
    const totalFindings = criticalCount + warningCount + infoCount;

    // Score: 100 - (critical * 10 + warning * 3 + info * 1), minimum 0
    const overallScore = Math.max(0, 100 - (criticalCount * 10 + warningCount * 3 + infoCount));

    await prisma.auditSnapshot.create({
      data: {
        facilityId,
        auditType: 'SELF_AUDIT',
        overallScore,
        categoryScores: {
          aging: Math.max(0, 100 - criticalCount * 15),
          compliance: Math.max(0, 100 - criticalCount * 12),
          inventory: Math.max(0, 100 - warningCount * 5),
          operations: Math.max(0, 100 - infoCount * 2),
          labTesting: Math.max(0, 100 - warningCount * 8),
        },
        totalFindings,
        criticalCount,
        warningCount,
        infoCount,
        findings: [
          ...(criticalCount > 0 ? [{
            category: 'aging', severity: 'CRITICAL',
            description: `${criticalCount} packages exceed 90-day aging threshold`,
            recommendation: 'Implement FIFO rotation or consider discounting aging inventory',
          }] : []),
          ...(warningCount > 0 ? [{
            category: 'compliance', severity: 'WARNING',
            description: `${warningCount} packages have compliance issues (lab testing, zero quantity)`,
            recommendation: 'Submit pending lab tests and finish zero-quantity packages',
          }] : []),
          ...(infoCount > 0 ? [{
            category: 'inventory', severity: 'INFO',
            description: `${infoCount} inventory observations noted`,
            recommendation: 'Review low-quantity and large packages for optimization',
          }] : []),
        ],
      },
    });
    console.log(`  Created audit snapshot (score: ${overallScore}, ${totalFindings} findings)`);
  }

  // ── Step 11: Seed yield records ─────────────────────────────────
  console.log('\n=== Step 11: Seeding yield records ===');
  const existingYields = await prisma.yieldRecord.count({ where: { facilityId } });

  if (existingYields > 0) {
    console.log(`  ${existingYields} yield records already exist, skipping`);
  } else if (DRY_RUN) {
    console.log('  [DRY RUN] Would create yield records for 6 strains');
  } else {
    const yieldData: Array<{
      facilityId: string; strainName: string; stage: string;
      inputWeight: number; outputWeight: number; yieldPercent: number;
      potencyThc?: number; potencyCbd?: number; notes?: string;
    }> = [];

    const strainYields = [
      { strain: 'Blue Dream', stages: [
        { stage: 'HARVEST', input: 4500, output: 3600, thc: 21.2, cbd: 0.1 },
        { stage: 'DRYING', input: 3600, output: 2880, thc: 21.2, cbd: 0.1 },
        { stage: 'TRIM', input: 2880, output: 2300, thc: 22.5, cbd: 0.1 },
        { stage: 'PACKAGING', input: 2300, output: 2250, thc: 22.5, cbd: 0.1 },
      ]},
      { strain: 'OG Kush', stages: [
        { stage: 'HARVEST', input: 3800, output: 3040, thc: 24.0, cbd: 0.3 },
        { stage: 'DRYING', input: 3040, output: 2432, thc: 24.0, cbd: 0.3 },
        { stage: 'TRIM', input: 2432, output: 1946, thc: 25.1, cbd: 0.3 },
        { stage: 'PACKAGING', input: 1946, output: 1900, thc: 25.1, cbd: 0.3 },
      ]},
      { strain: 'Girl Scout Cookies', stages: [
        { stage: 'HARVEST', input: 5200, output: 4160, thc: 25.0, cbd: 0.2 },
        { stage: 'DRYING', input: 4160, output: 3328, thc: 25.0, cbd: 0.2 },
        { stage: 'TRIM', input: 3328, output: 2662, thc: 26.2, cbd: 0.2 },
        { stage: 'PACKAGING', input: 2662, output: 2600, thc: 26.2, cbd: 0.2 },
      ]},
      { strain: 'Sour Diesel', stages: [
        { stage: 'HARVEST', input: 3500, output: 2800, thc: 22.0, cbd: 0.2 },
        { stage: 'DRYING', input: 2800, output: 2240, thc: 22.0, cbd: 0.2 },
        { stage: 'TRIM', input: 2240, output: 1792, thc: 23.3, cbd: 0.2 },
      ]},
      { strain: 'Wedding Cake', stages: [
        { stage: 'HARVEST', input: 4000, output: 3200, thc: 25.0, cbd: 0.1 },
        { stage: 'DRYING', input: 3200, output: 2560, thc: 25.0, cbd: 0.1 },
        { stage: 'EXTRACTION', input: 2560, output: 640, thc: 78.5, cbd: 0.3 },
      ]},
      { strain: 'ACDC', stages: [
        { stage: 'HARVEST', input: 2000, output: 1600, thc: 1.0, cbd: 20.0 },
        { stage: 'DRYING', input: 1600, output: 1280, thc: 1.0, cbd: 20.0 },
        { stage: 'TRIM', input: 1280, output: 1024, thc: 1.1, cbd: 21.5 },
      ]},
    ];

    for (const sy of strainYields) {
      for (const s of sy.stages) {
        yieldData.push({
          facilityId,
          strainName: sy.strain,
          stage: s.stage,
          inputWeight: s.input,
          outputWeight: s.output,
          yieldPercent: Math.round((s.output / s.input) * 10000) / 100,
          potencyThc: s.thc,
          potencyCbd: s.cbd,
          notes: `Automated seed data - ${sy.strain} ${s.stage}`,
        });
      }
    }

    await prisma.yieldRecord.createMany({ data: yieldData });
    console.log(`  Created ${yieldData.length} yield records across ${strainYields.length} strains`);
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  if (!DRY_RUN) {
    try {
      const [pkgs, batches, strainsCount, rulesCount, alertsCount, tollingCount, yieldsCount] = await Promise.all([
        metrcGet<unknown[]>('/packages/v1/active', LICENSE).then(r => r.length).catch(() => -1),
        metrcGet<unknown[]>('/plantbatches/v1/active', LICENSE).then(r => r.length).catch(() => -1),
        metrcGet<unknown[]>('/strains/v1/active', LICENSE).then(r => r.length).catch(() => -1),
        prisma.businessRule.count({ where: { facilityId } }),
        prisma.complianceAlert.count({ where: { facilityId, status: 'OPEN' } }),
        prisma.tollingAgreement.count({ where: { facilityId } }),
        prisma.yieldRecord.count({ where: { facilityId } }),
      ]);
      console.log(`  Metrc Sandbox:`);
      console.log(`    Packages: ${pkgs}`);
      console.log(`    Plant Batches: ${batches}`);
      console.log(`    Strains: ${strainsCount}`);
      console.log(`  Database:`);
      console.log(`    Business Rules: ${rulesCount}`);
      console.log(`    Compliance Alerts (open): ${alertsCount}`);
      console.log(`    Tolling Agreements: ${tollingCount}`);
      console.log(`    Yield Records: ${yieldsCount}`);
    } catch (err) {
      console.log(`  (Could not fetch summary: ${err instanceof Error ? err.message : err})`);
    }
  }

  console.log('\nRefresh your browser to see the data in the dashboard.');
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('Formul8 Comprehensive Sandbox Seeder');
  console.log('====================================');

  if (!FACILITY_ID && !PROVISION_ALL) {
    console.log('Usage:');
    console.log('  npx tsx scripts/seed-sandbox.ts --facilityId <ID>           # Seed one facility');
    console.log('  npx tsx scripts/seed-sandbox.ts --facilityId <ID> --dry-run # Preview changes');
    console.log('  npx tsx scripts/seed-sandbox.ts --provision-all             # Add all 28 CO facilities to DB');
    console.log('\nTo find your facility ID, check the database or the URL in the dashboard.');
    process.exit(0);
  }

  try {
    if (PROVISION_ALL) {
      await provisionAll();
    }

    if (FACILITY_ID) {
      await seedFacility(FACILITY_ID);
    }

    console.log('\n=== DONE ===');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await dashboardPrisma.$disconnect();
  }
}

main();
