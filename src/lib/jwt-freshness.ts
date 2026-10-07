/**
 * Whether a JWT must be re-enriched (orgIds, facilityAccess, isPlatformAdmin)
 * because the user's auth-relevant state changed after the token was last
 * enriched.
 *
 * Compares against the custom `lastEnrichedAt` claim (whole seconds), not
 * `iat`: NextAuth 4.24 re-encodes the JWT, resetting `iat`, on every session
 * call, so an `iat` comparison loses invalidations whenever the first request
 * after one falls inside the freshness throttle. A token without
 * `lastEnrichedAt` (issued before the claim existed) is treated as never
 * enriched.
 *
 * `>=`: an invalidation in the same second as the last enrichment may have
 * landed after its reads, so it re-enriches. The freshness throttle bounds the
 * cost to at most one redundant re-enrichment.
 */
export function needsReenrichment(invalidatedAt: Date | null | undefined, lastEnrichedAtSec: number | undefined): boolean {
  if (!invalidatedAt) return false
  return Math.floor(invalidatedAt.getTime() / 1000) >= (lastEnrichedAtSec ?? 0)
}
