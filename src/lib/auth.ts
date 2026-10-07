import { NextAuthOptions } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient, prisma as metrcPrisma } from '@/lib/prisma'
import { createUserOrganization } from '@/lib/user-organization'
import { upsertIdentityMapping } from '@/lib/identity-map'
import { verifyAutoLoginToken } from '@/lib/token-login'
import { authorizePassword } from '@/lib/password'
import { isGoogleEnabled, isOpenSignupEnabled, isPortalLoginEnabled } from '@/lib/auth-providers'
import { isEmailDomainAllowed, parseDomainList } from '@/lib/email-domains'
import { existingUserLinkUpdate, isOAuthEmailVerified, isTokenRevoked } from '@/lib/oauth-link'
import { needsReenrichment } from '@/lib/jwt-freshness'

// On JWT refresh (no `user` arg), throttle the DB freshness check so we don't
// pay a query on every request. 60s is fast enough that a newly-attached
// membership becomes visible within a minute, slow enough that an idle tab
// doesn't hammer the DB.
const JWT_FRESHNESS_CHECK_INTERVAL_SEC = 60

async function enrichTokenWithOrgData(token: JWT, dbUserId: string): Promise<void> {
  const prisma = createPrismaClient()
  const memberships = await prisma.membership.findMany({
    where: { userId: dbUserId },
    select: {
      organizationId: true,
      organization: {
        select: {
          environment: true,
        },
      },
    },
  })
  token.orgIds = memberships.map((m) => m.organizationId)
  const dbUser = await prisma.user.findUnique({ where: { id: dbUserId }, select: { isPlatformAdmin: true } })
  token.isPlatformAdmin = dbUser?.isPlatformAdmin ?? false
  // Per-org tenant environment (PRODUCTION / DEMO / TEST). Lets the UI render an
  // env banner and tRPC procedures gate on tenant mode without an extra DB hit.
  // See ADR-020 Phase 3 (FOR-1480).
  const orgEnvironments: Record<string, string> = {}
  for (const m of memberships) {
    orgEnvironments[m.organizationId] = m.organization.environment
  }
  token.orgEnvironments = orgEnvironments
}

async function enrichTokenWithFacilityAccess(token: JWT, dbUserId: string): Promise<void> {
  const accessGrants = await metrcPrisma.facilityAccess.findMany({
    where: { userId: dbUserId },
    select: { facilityId: true, role: true },
  })
  const facilityAccess: Record<string, string> = {}
  for (const grant of accessGrants) {
    facilityAccess[grant.facilityId] = grant.role
  }
  token.facilityAccess = facilityAccess
}

/**
 * On JWT refresh, check whether the user's auth-relevant state has been
 * invalidated since the token was last enriched (`token.lastEnrichedAt`; not
 * `iat`, which NextAuth resets on every re-encode). If so, re-run org + facility enrichment
 * and stamp the token so the caller stops seeing a stale `orgIds` / `plan` /
 * `facilityAccess` payload.
 *
 * Without this, NextAuth's stateless JWT strategy means a new membership
 * (e.g., domain-claim attach finishing async) is invisible to the user until
 * `signOut + signIn`. See ADR-016 (Phase 0, structural fix #3).
 */
async function maybeRefreshJwt(token: JWT): Promise<void> {
  const dbUserId = token.uid as string | undefined
  if (!dbUserId) return

  const nowSec = Math.floor(Date.now() / 1000)
  const lastChecked = (token.lastFreshnessCheckAt as number | undefined) ?? 0
  if (nowSec - lastChecked < JWT_FRESHNESS_CHECK_INTERVAL_SEC) return
  token.lastFreshnessCheckAt = nowSec

  let revoked = false
  try {
    const prisma: PrismaClient = createPrismaClient()
    const dbUser = await prisma.user.findUnique({
      where: { id: dbUserId },
      select: { jwtInvalidatedAt: true, sessionsRevokedAt: true },
    })
    revoked = isTokenRevoked(token.authTime as number | undefined, dbUser?.sessionsRevokedAt)
    if (!revoked && needsReenrichment(dbUser?.jwtInvalidatedAt, token.lastEnrichedAt as number | undefined)) {
      await enrichTokenWithOrgData(token, dbUserId)
      await enrichTokenWithFacilityAccess(token, dbUserId)
      // Stamped with the time the check started (before the enrichment
      // reads), so an invalidation landing mid-enrichment in a later second
      // is still picked up next time.
      token.lastEnrichedAt = nowSec
    }
  } catch (error) {
    // Fails open on DB errors (as the freshness check always has) so a
    // transient outage does not sign everyone out.
    console.error('Error checking JWT freshness:', error)
  }

  // NextAuth 4.24's session route clears the session cookie and returns an
  // empty session when the jwt callback throws; returning `{}` instead would
  // yield a "session" with no user id.
  if (revoked) {
    throw new Error('Session revoked')
  }
}

// FOR-1487: NextAuth silently auto-generates a per-instance secret when
// NEXTAUTH_SECRET is unset, which invalidates all sessions on redeploy and
// breaks JWT verification across replicas. Fail fast on boot so the
// failure mode is visible instead of "users keep getting logged out."
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error(
    'NEXTAUTH_SECRET is required. Generate one with `openssl rand -base64 32` ' +
      'and set it in your environment.',
  )
}

// Portal auto-login token provider (id `credentials`). Only registered when
// AUTO_LOGIN_ISSUER_WHITELIST is set.
const portalTokenProvider = CredentialsProvider({
  name: 'Credentials',
  credentials: {
    email: { label: 'Email', type: 'email' },
    token: { label: 'Token', type: 'text' },
  },
  async authorize(credentials) {
    if (!credentials?.token) {
      return null
    }

    const tokenResult = await verifyAutoLoginToken(credentials.token)
    if (!tokenResult) {
      return null
    }

    const emailFromToken = tokenResult.email

    if (credentials.email && credentials.email !== emailFromToken) {
      return null
    }

    const prisma = createPrismaClient()
    const tokenUser = await prisma.user.findUnique({
      where: { email: emailFromToken },
    })

    if (!tokenUser) {
      return null
    }

    return {
      id: tokenUser.id,
      email: tokenUser.email,
      name: tokenUser.name,
      image: tokenUser.image,
    }
  },
})

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      id: 'password',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        return authorizePassword(createPrismaClient(), credentials.email, credentials.password)
      },
    }),
    ...(isGoogleEnabled(process.env)
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })]
      : []),
    ...(isPortalLoginEnabled(process.env) ? [portalTokenProvider] : []),
  ],
  callbacks: {
    session: async ({ session, token }) => {
      if (session?.user) {
        if (token?.uid) {
          session.user.id = token.uid as string
        } else if (token?.sub) {
          session.user.id = token.sub as string
        }

        session.user.orgIds = (token?.orgIds as string[]) ?? []
        session.user.facilityAccess = (token?.facilityAccess as Record<string, string>) ?? {}
        session.user.orgEnvironments = (token?.orgEnvironments as Record<string, string>) ?? {}
        session.user.isPlatformAdmin = (token?.isPlatformAdmin as boolean | undefined) ?? false
      }
      return session
    },
    jwt: async ({ user, token, account }) => {
      if (user) {
        // Initial sign-in: resolve DB user id, run domain-claim/personal-org bootstrap
        // for credentials provider, then enrich JWT with org + facility data.
        let dbUserId = user.id as string
        if (account?.provider !== 'credentials' && user.email) {
          try {
            const lookupPrisma = createPrismaClient()
            const dbUser = await lookupPrisma.user.findUnique({
              where: { email: user.email },
              select: { id: true },
            })
            if (dbUser) {
              dbUserId = dbUser.id
            }
          } catch (error) {
            console.error('Error resolving database user ID from email:', error)
          }
        }

        token.uid = dbUserId
        const signInSec = Math.floor(Date.now() / 1000)
        // Stable issuance time for session revocation (iat is rewritten on
        // every re-encode). Minted after signIn ran, so a revocation performed
        // by this same sign-in is never newer than this token.
        token.authTime = signInSec

        if (account?.provider === 'credentials' && dbUserId) {
          try {
            await createUserOrganization({
              userId: dbUserId,
              userName: user.name || null,
              userEmail: user.email || '',
            })
          } catch (error) {
            console.error('Error ensuring organization for token user:', error)
          }
        }

        let enriched = true
        try {
          await enrichTokenWithOrgData(token, dbUserId)
        } catch (error) {
          console.error('Error enriching JWT with org data:', error)
          if (!token.orgIds) token.orgIds = []
          enriched = false
        }

        try {
          await enrichTokenWithFacilityAccess(token, dbUserId)
        } catch (error) {
          console.error('Error enriching JWT with facility access:', error)
          if (!token.facilityAccess) token.facilityAccess = {}
          enriched = false
        }

        // Stamp lastFreshnessCheckAt so the very next refresh doesn't immediately
        // re-query the dashboard DB for nothing.
        token.lastFreshnessCheckAt = Math.floor(Date.now() / 1000)
        // Enrichment above started at signInSec. A jwtInvalidatedAt bump from this
        // sign-in's own org bootstrap in the same second costs at most one extra
        // re-enrichment on the next check. Left unset on failure so the next
        // freshness check retries once any invalidation is recorded.
        if (enriched) token.lastEnrichedAt = signInSec
      } else {
        // JWT refresh path: re-enrich if jwtInvalidatedAt > token.lastEnrichedAt.
        await maybeRefreshJwt(token)
      }
      return token
    },
    signIn: async ({ user, account, profile }) => {
      // Credentials providers (portal token `credentials`, email+password
      // `password`) have already authenticated against an existing DB user.
      if (!account || account.type === 'credentials') {
        return true
      }

      // Only trust an IdP-verified email to identify or link to an account.
      if (!isOAuthEmailVerified(account.provider, profile)) {
        return '/unavailable'
      }

      if (!isEmailDomainAllowed(user.email ?? '', parseDomainList(process.env.ALLOWED_EMAIL_DOMAINS))) {
        return '/unavailable'
      }

      try {
        const prisma = createPrismaClient()

        const existingUser = await prisma.user.findUnique({
          where: { email: user.email || undefined },
        })

        let dbUserId: string

        if (!existingUser) {
          const newUser = await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name,
              image: user.image,
              emailVerified: new Date(),
            },
          })

          dbUserId = newUser.id

          // A domain claim still attaches the user; a personal org is only
          // bootstrapped when open sign-up is enabled.
          await createUserOrganization({
            userId: newUser.id,
            userName: user.name,
            userEmail: user.email!,
            allowPersonalOrg: isOpenSignupEnabled(process.env),
          })

          console.log(`Created user for OAuth user: ${user.email || 'unknown'}`)
        } else {
          dbUserId = existingUser.id

          // Pre-hijack defence: an unverified row (e.g. a password sign-up by
          // someone else) loses its password once the real owner proves the
          // email via Google.
          const linkUpdate = existingUserLinkUpdate(existingUser, new Date())
          if (linkUpdate) {
            try {
              await prisma.user.update({ where: { id: existingUser.id }, data: linkUpdate })
            } catch (error) {
              // Fail closed: the outer catch allows sign-in, which would leave
              // an attacker-set password on the account.
              console.error('[auth] Failed to verify existing user on OAuth link:', error)
              return '/unavailable'
            }
          }

          await createUserOrganization({
            userId: existingUser.id,
            userName: existingUser.name,
            userEmail: existingUser.email,
            allowPersonalOrg: isOpenSignupEnabled(process.env),
          })
        }

        if (account.providerAccountId && user.email) {
          upsertIdentityMapping({
            userId: dbUserId,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            email: user.email,
          }).catch((err) => {
            console.error('[auth] Identity mapping failed (non-blocking):', err)
          })
        }

        return true
      } catch (error) {
        // Fail closed: continuing would let the jwt callback resolve whatever
        // row owns this email (e.g. an unverified password sign-up that won a
        // create race) without the verification/conversion above.
        console.error(`Failed to create user/organization for ${user.email || 'unknown'}:`, error)
        return '/unavailable'
      }
    },
  },
  session: {
    strategy: 'jwt',
    // ADR-020 Phase 4 (FOR-1481): tighten max-age from the NextAuth default of
    // 30 days to 7 days. The Phase 0 freshness mechanism (User.jwtInvalidatedAt
    // + 60s throttled re-enrichment) handles in-session staleness; this is
    // defense-in-depth so a JWT that survives an unusual freshness-check failure
    // window still rolls over within a week.
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    signIn: '/auth/signin',
  },
}
