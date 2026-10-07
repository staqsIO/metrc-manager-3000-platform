// Pure decision helpers for linking an OAuth sign-in to a users row.

/**
 * Google must assert the email is verified before we trust it to identify (or
 * link to) an account. Other OAuth providers are not configured here and are
 * rejected unless they are added explicitly.
 */
export function isOAuthEmailVerified(provider: string, profile: unknown): boolean {
  if (provider === 'google') {
    return (profile as { email_verified?: unknown } | undefined)?.email_verified === true
  }
  return false
}

/**
 * An IdP-verified OAuth sign-in proves ownership of the email. If the existing
 * row was never verified, any password on it was set by someone who did not
 * prove ownership (possible pre-hijack), so clear it, mark the email verified,
 * and revoke every session issued so far (the attacker may already hold a
 * JWT). jwtInvalidatedAt is bumped too so org data is re-enriched. Returns the
 * update to apply, or null when nothing changes.
 */
export function existingUserLinkUpdate(
  user: { password: string | null; emailVerified: Date | null },
  now: Date,
):
  | { password: null; emailVerified: Date; sessionsRevokedAt: Date; jwtInvalidatedAt: Date }
  | { emailVerified: Date }
  | null {
  if (user.emailVerified) return null
  return user.password
    ? { password: null, emailVerified: now, sessionsRevokedAt: now, jwtInvalidatedAt: now }
    : { emailVerified: now }
}

/**
 * Whether a JWT minted at `authTimeSec` (whole seconds, set once at sign-in;
 * NOT `iat`, which NextAuth rewrites on every re-encode) predates the user's
 * session revocation. Compared in whole seconds with a strict `>` so the
 * sign-in that performs the revocation (same second) keeps its token. A token
 * without an auth time (issued before this claim existed) counts as revoked
 * once any revocation is recorded.
 */
export function isTokenRevoked(authTimeSec: number | undefined, revokedAt: Date | null | undefined): boolean {
  if (!revokedAt) return false
  if (authTimeSec === undefined) return true
  return Math.floor(revokedAt.getTime() / 1000) > authTimeSec
}
