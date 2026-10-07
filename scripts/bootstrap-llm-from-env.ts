import { prisma } from '../src/lib/prisma';
import { bootstrapProvidersFromEnv } from '../src/services/llm/bootstrap';

bootstrapProvidersFromEnv(prisma as never, process.env)
  .then((names) => {
    console.log(names.length ? `[llm] created providers from env: ${names.join(', ')}` : '[llm] providers unchanged');
    process.exit(0);
  })
  .catch((e) => { console.error('[llm] bootstrap failed:', e instanceof Error ? e.message : e); process.exit(1); });
