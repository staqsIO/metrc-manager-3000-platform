import { PrismaClient } from '@prisma/client';

// Two client handles share one database by default. `dashboardPrisma` exists so
// deployments that keep users/orgs in a separate database can set
// DASHBOARD_DATABASE_URL; otherwise both use DATABASE_URL.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  dashboardPrisma: PrismaClient | undefined;
};

export function resolveDatabaseUrls(env: Record<string, string | undefined>): { metrcUrl: string; dashboardUrl: string } {
  const metrcUrl = env.DATABASE_URL?.trim();
  if (!metrcUrl) throw new Error('DATABASE_URL is not set');
  const dashboardUrl = env.DASHBOARD_DATABASE_URL?.trim() || metrcUrl;
  return { metrcUrl, dashboardUrl };
}

function buildConnectionUrl(baseUrl: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  // PgBouncer transaction-mode poolers (port 6543) cannot use prepared statements.
  const port = baseUrl.match(/:(\d{4,5})\//)?.[1];
  const params = ['connection_limit=5', 'pool_timeout=10'];
  if (port === '6543') params.push('pgbouncer=true', 'prepared_statements=false');
  return baseUrl + separator + params.join('&');
}

const logLevel = process.env.NODE_ENV === 'development' ? ['error', 'warn'] as const : ['error'] as const;

function createClient(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: buildConnectionUrl(url) } }, log: [...logLevel] });
}

const urls = resolveDatabaseUrls(process.env);

export const prisma = globalForPrisma.prisma ?? createClient(urls.metrcUrl);
export const dashboardPrisma =
  globalForPrisma.dashboardPrisma ?? (urls.dashboardUrl === urls.metrcUrl ? prisma : createClient(urls.dashboardUrl));

/** Kept for auth.ts call sites; returns the users/orgs client. */
export const createPrismaClient = (): PrismaClient => dashboardPrisma;

globalForPrisma.prisma = prisma;
globalForPrisma.dashboardPrisma = dashboardPrisma;
