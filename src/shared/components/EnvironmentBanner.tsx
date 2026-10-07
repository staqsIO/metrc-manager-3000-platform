/**
 * Persistent banner shown when the active org is non-PRODUCTION (DEMO or TEST).
 * Reads the active-org cookie + session.orgEnvironments map server-side; renders
 * nothing for PRODUCTION orgs or when no active org is set.
 *
 * See ADR-020 Phase 3 (FOR-1480) — `Organization.environment` enum.
 */
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { ACTIVE_ORG_COOKIE } from '@/lib/active-org'

export default async function EnvironmentBanner(): Promise<React.ReactElement | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const cookieStore = cookies()
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value
  if (!activeOrgId) return null

  const env = session.user.orgEnvironments?.[activeOrgId]
  if (!env || env === 'PRODUCTION') return null

  const isTest = env === 'TEST'
  const tone = isTest
    ? 'bg-red-950 border-red-800 text-red-100'
    : 'bg-yellow-950 border-yellow-800 text-yellow-100'
  const label = isTest ? 'TEST MODE' : 'DEMO MODE'
  const subtext = isTest
    ? 'Ephemeral tenant. Data may be auto-purged. Side effects (Metrc API, cron) are disabled.'
    : 'Sales/prospect tenant. Side effects (Metrc API, cron) are disabled. Not a paying customer.'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full border-b ${tone}`}
      data-testid="env-banner"
      data-environment={env}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-xs">
        <span className="rounded bg-black/30 px-2 py-0.5 font-mono font-bold tracking-wider">{label}</span>
        <span className="opacity-90">{subtext}</span>
      </div>
    </div>
  )
}
