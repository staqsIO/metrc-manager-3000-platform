import { TRPCError } from '@trpc/server'
import type { OrganizationEnvironment, PrismaClient } from '@prisma/client'

/**
 * Tenant isolation helpers for ADR-020 Phase 3 (FOR-1480).
 *
 * `Organization.environment` partitions tenants into:
 *   - PRODUCTION: real customers; full side effects (Metrc API, cron)
 *   - DEMO:       sales/prospect demos; persistent, no side effects
 *   - TEST:       CI/E2E; auto-purged; no side effects
 *
 * Code paths that perform side effects (write to Metrc API /
 * dispatch billable work / send paying-customer email) MUST gate on
 * `requireProductionTenant()` or check `getOrgEnvironment()` before proceeding.
 *
 * Read-only paths (UI render, facility list, analytics) do not need to gate —
 * non-PRODUCTION orgs can see their own state freely.
 */

export const PRODUCTION: OrganizationEnvironment = 'PRODUCTION'
export const DEMO: OrganizationEnvironment = 'DEMO'
export const TEST: OrganizationEnvironment = 'TEST'

export function isProduction(env: OrganizationEnvironment | null | undefined): boolean {
  return env === 'PRODUCTION'
}

export function isNonProduction(env: OrganizationEnvironment | null | undefined): boolean {
  return env === 'DEMO' || env === 'TEST'
}

/**
 * Fetch the environment for an org id. Falls back to PRODUCTION if the row
 * is missing — defensive default that fails *open* for legitimate customers
 * rather than blocking real ops on a transient DB issue.
 */
export async function getOrgEnvironment(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OrganizationEnvironment> {
  const row = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { environment: true },
  })
  return row?.environment ?? 'PRODUCTION'
}

/**
 * Throws TRPCError(FORBIDDEN) when the org is non-PRODUCTION. Use in tRPC
 * mutation handlers that fan out to side-effecting code paths.
 *
 * Pre-fetched env can be passed via `precomputedEnv` to avoid a redundant
 * DB read when the caller already has it (e.g., from JWT enrichment).
 */
export async function requireProductionTenant(
  prisma: PrismaClient,
  organizationId: string,
  precomputedEnv?: OrganizationEnvironment | null,
): Promise<void> {
  const env = precomputedEnv ?? (await getOrgEnvironment(prisma, organizationId))
  if (!isProduction(env)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `This action is disabled on ${env} tenants. Switch to a production organization.`,
    })
  }
}

/**
 * Backend-side equivalent of `requireProductionTenant` for non-tRPC contexts
 * (cron handlers, Metrc client factory). Returns boolean
 * instead of throwing so the caller can no-op gracefully.
 */
export async function isProductionTenant(
  prisma: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  const env = await getOrgEnvironment(prisma, organizationId)
  return isProduction(env)
}

/**
 * Returns all PRODUCTION organization ids from the Dashboard DB. Cron handlers
 * use this to scope `MetrcFacility.findMany` queries — the Metrc DB lives in
 * a separate Supabase project so a SQL join across DBs is impossible.
 *
 * Pass `dashboardPrisma` (NOT `prisma` which is the Metrc DB client). The
 * resulting array is then plugged into the cron's MetrcFacility.findMany via
 * `where: { organizationId: { in: prodOrgIds } }`.
 */
export async function getProductionOrgIds(dashboardPrisma: PrismaClient): Promise<string[]> {
  const orgs = await dashboardPrisma.organization.findMany({
    where: { environment: 'PRODUCTION' },
    select: { id: true },
  })
  return orgs.map((o) => o.id)
}

/**
 * Throws TRPCError(BAD_REQUEST) when an admin tries to set a facility's
 * `metrcEnvironment` to a non-mock value on a DEMO/TEST tenant. This is the
 * upstream gate that complements the cron-level filter — it prevents the
 * "DEMO org owns a facility wired to real Metrc creds" anti-state from being
 * created in the first place.
 *
 * Allowed combinations:
 *   org.environment = PRODUCTION → any metrcEnvironment
 *   org.environment = DEMO/TEST  → metrcEnvironment must be 'mock'
 */
export async function assertFacilityEnvironmentAllowed(
  dashboardPrisma: PrismaClient,
  organizationId: string,
  requestedMetrcEnvironment: 'mock' | 'sandbox' | 'production',
): Promise<void> {
  if (requestedMetrcEnvironment === 'mock') return
  const env = await getOrgEnvironment(dashboardPrisma, organizationId)
  if (!isProduction(env)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Cannot set metrcEnvironment='${requestedMetrcEnvironment}' on a ${env} organization. Switch the org to PRODUCTION first or keep the facility on mock.`,
    })
  }
}
