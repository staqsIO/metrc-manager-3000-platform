/**
 * seed-demo.ts — fill an EMPTY, freshly migrated database with fictional demo data.
 *
 * Creates a DEMO organization (Metrc is forced to the in-process mock client and
 * crons skip it), a shared demo login, three mock facilities, and populates every
 * snapshot table by running the regular sync functions against the mock client.
 * No real Metrc call is ever made and no real customer data is involved.
 *
 * Run by `entrypoint.sh demo-reset`, which wipes the database first. Refuses to run
 * unless DEMO_MODE=1, because a demo reset is destructive by design.
 *
 * Env:
 *   DEMO_MODE=1                     required
 *   DEMO_EMAIL / DEMO_PASSWORD      shared demo login (defaults below)
 *   ADMIN_EMAIL / ADMIN_PASSWORD    optional super admin for the operator (not shared)
 */
import type { MetrcFacility, Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { demoLogin } from '../src/lib/auth-providers';
import { createAdmin } from '../src/services/setup/create-admin';
import { getMetrcClient } from '../src/services/metrc/metrc-factory';
import { DEFAULT_RULES } from '../src/services/engines/default-rules';
import { evaluateAndCreateAlerts } from '../src/services/engines/rules-evaluation';


const FACILITIES = [
  { name: 'Green Valley Cultivation', licenseNumber: 'DEMO-CO-CULT-0001', stateCode: 'CO', facilityType: 'Cultivator', timezone: 'America/Denver' },
  { name: 'Summit Extracts', licenseNumber: 'DEMO-CO-MFG-0002', stateCode: 'CO', facilityType: 'Manufacturer', timezone: 'America/Denver' },
  { name: 'Harbor Dispensary', licenseNumber: 'DEMO-MA-RET-0003', stateCode: 'MA', facilityType: 'Dispensary', timezone: 'America/New_York' },
];

const PARTNERS = [
  { name: 'Mesa Processing Co. (fictional)', license: 'DEMO-PARTNER-01' },
  { name: 'Riverbend Labs (fictional)', license: 'DEMO-PARTNER-02' },
  { name: 'Northside Wellness (fictional)', license: 'DEMO-PARTNER-03' },
];

const STRAINS = [
  { strain: 'Blue Dream', thc: 21.2, cbd: 0.1 },
  { strain: 'OG Kush', thc: 24.0, cbd: 0.3 },
  { strain: 'Wedding Cake', thc: 25.0, cbd: 0.1 },
  { strain: 'ACDC', thc: 1.0, cbd: 20.0 },
];

function monthsFromNow(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + n, 1);
  return d;
}

async function step(label: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    const count = (r && typeof r === 'object' && 'count' in r) ? ` (${(r as { count: unknown }).count})` : '';
    console.log(`  ✓ ${label}${count}`);
  } catch (e) {
    // One failing feature must not leave the whole demo empty.
    console.warn(`  ✗ ${label}: ${e instanceof Error ? e.message : e}`);
  }
}

async function createDemoTenant(DEMO_EMAIL: string, DEMO_PASSWORD: string) {
  const owner = await dashboardPrisma.role.findUnique({ where: { name: 'OWNER' } });
  if (!owner) throw new Error('OWNER role missing — run migrations and the core seed first');

  const user = await dashboardPrisma.user.create({
    data: { email: DEMO_EMAIL, name: 'Demo User', password: await hashPassword(DEMO_PASSWORD), emailVerified: new Date() },
  });
  const org = await dashboardPrisma.organization.create({
    data: {
      name: 'Demo Cannabis Co.',
      slug: 'demo',
      environment: 'DEMO',
      description: 'Fictional demo tenant. Reset every night.',
      ownerId: user.id,
      memberships: { create: { userId: user.id, roleId: owner.id } },
    },
  });
  return { userId: user.id, organizationId: org.id };
}

async function seedFacility(f: MetrcFacility) {
  console.log(`\n${f.name} (${f.licenseNumber})`);
  const sync = (mod: string) => import(`../src/pages/api/cron/${mod}`);

  await step('catalog', async () => (await sync('catalog-sync')).syncFacilityCatalog(f));
  await step('packages', async () => (await sync('package-sync')).syncFacilityPackages(f, { mode: 'full' }));
  await step('plants', async () => (await sync('plant-sync')).syncFacilityPlants(f, { mode: 'full' }));
  await step('plant batches', async () => (await sync('plant-batch-sync')).syncFacilityPlantBatches(f, { mode: 'full' }));
  await step('harvests', async () => (await sync('harvest-sync')).syncFacilityHarvests(f, { mode: 'full' }));
  await step('lab tests', async () => (await sync('lab-test-sync')).syncFacilityLabTests(f, { mode: 'full' }));
  await step('transfers', async () => (await sync('transfer-sync')).syncFacilityTransfers(f, { mode: 'full' }));
  await step('sales', async () => (await sync('retail-sales-sync')).syncFacilitySales(f));
  await step('active sales', async () => (await sync('retail-sales-active-sync')).syncFacilityActiveSales(f));

  await step('business rules', () => prisma.businessRule.createMany({
    data: DEFAULT_RULES.filter((r) => !r.stateCode || r.stateCode === f.stateCode).map((r) => ({
      facilityId: f.id,
      name: r.name,
      description: r.description,
      category: r.category,
      severity: r.severity,
      stateCode: r.stateCode,
      conditions: r.conditions as unknown as Prisma.InputJsonValue,
      actionType: r.actionType,
      actionParams: r.actionParams as unknown as Prisma.InputJsonValue | undefined,
      metadata: r.metadata as Prisma.InputJsonValue | undefined,
      isActive: true,
      isDefault: true,
    })),
  }));
  await step('compliance alerts', async () => {
    const r = await evaluateAndCreateAlerts(prisma as never, f.id, getMetrcClient(f), { stateCode: f.stateCode });
    return { count: r.alertsCreated };
  });

  await step('tolling agreements', () => prisma.tollingAgreement.createMany({
    data: PARTNERS.map((p, i) => ({
      facilityId: f.id,
      partnerName: p.name,
      partnerLicense: p.license,
      agreementType: i % 2 === 0 ? 'OUTBOUND' : 'INBOUND',
      status: i === 2 ? 'COMPLETED' : 'ACTIVE',
      startDate: monthsFromNow(-3 - i),
      endDate: monthsFromNow(i === 2 ? -1 : 3 + i),
      inputWeight: 3000 + i * 1500,
      outputWeight: 2200 + i * 1100,
      processingFee: 2 + i * 0.5,
      totalFees: (2200 + i * 1100) * (2 + i * 0.5),
      inputPackageIds: [],
      outputPackageIds: [],
      terms: { yieldGuarantee: `${70 + i * 5}%`, timeline: `${10 + i * 4} business days` },
      notes: 'Demo agreement',
    })),
  }));

  await step('yield records', () => prisma.yieldRecord.createMany({
    data: STRAINS.flatMap(({ strain, thc, cbd }, i) => {
      let input = 3000 + i * 600;
      return ['HARVEST', 'DRYING', 'TRIM', 'PACKAGING'].map((stage) => {
        const output = Math.round(input * (stage === 'PACKAGING' ? 0.97 : 0.8));
        const row = {
          facilityId: f.id, strainName: strain, stage, inputWeight: input, outputWeight: output,
          yieldPercent: Math.round((output / input) * 10000) / 100, potencyThc: thc, potencyCbd: cbd, notes: 'Demo data',
        };
        input = output;
        return row;
      });
    }),
  }));

  await step('audit snapshot', async () => {
    const bySeverity = await prisma.complianceAlert.groupBy({ by: ['severity'], where: { facilityId: f.id }, _count: true });
    const n = (s: string) => bySeverity.find((a) => a.severity === s)?._count ?? 0;
    const [critical, warning, info] = [n('CRITICAL'), n('WARNING'), n('INFO')];
    return prisma.auditSnapshot.create({
      data: {
        facilityId: f.id,
        auditType: 'SELF_AUDIT',
        overallScore: Math.max(0, 100 - (critical * 2 + warning)),
        categoryScores: { aging: 82, compliance: 76, inventory: 91, operations: 88, labTesting: 79 },
        totalFindings: critical + warning + info,
        criticalCount: critical,
        warningCount: warning,
        infoCount: info,
        findings: [
          { category: 'compliance', severity: 'WARNING', description: `${warning} open warnings from business rules`, recommendation: 'Review the Compliance tab' },
        ],
      },
    });
  });

  await prisma.metrcFacility.update({ where: { id: f.id }, data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS' } });
}

async function main() {
  const demo = demoLogin(process.env);
  if (!demo) {
    console.error('[seed-demo] refusing to run: set DEMO_MODE=1 (this seeds fictional data for a public demo)');
    process.exit(2);
  }
  if (await dashboardPrisma.organization.findFirst({ where: { slug: 'demo' } })) {
    console.error('[seed-demo] demo organization already exists — run `demo-reset` to wipe and reseed');
    process.exit(3);
  }

  const { organizationId } = await createDemoTenant(demo.email, demo.password);
  console.log(`[seed-demo] demo login ${demo.email}`);

  for (const spec of FACILITIES) {
    const facility = await prisma.metrcFacility.create({ data: { ...spec, organizationId, metrcEnvironment: 'mock' } });
    await seedFacility(facility);
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const r = await createAdmin(dashboardPrisma as never, {
      email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, orgName: 'Operators',
    });
    console.log(`[seed-demo] super admin ready (organization ${r.organizationId})`);
  }
  console.log('\n[seed-demo] done');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[seed-demo] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
