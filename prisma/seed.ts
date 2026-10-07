import { dashboardPrisma } from '../src/lib/prisma';
import { seedCore } from '../src/services/setup/seed-core';

seedCore(dashboardPrisma as never)
  .then((r) => { console.log(`[seed] roles=${r.roles} genericDomains=${r.genericDomains}`); process.exit(0); })
  .catch((e) => { console.error('[seed] failed:', e instanceof Error ? e.message : e); process.exit(1); });
