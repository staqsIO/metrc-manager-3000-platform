/**
 * Per-facility 24h cache for Metrc package adjust reasons.
 *
 * Reasons are reference data that change on a months-to-years cadence. Caching
 * for 24h cuts a redundant Metrc API call out of every adjust-package dialog
 * open. Cache is keyed by facility id (the canonical platform-level identifier)
 * not licenseNumber.
 *
 * Architecture: module-level in-memory Map. This matches the pattern used by
 * `search-index.ts`. A cold start (process restart) is the only invalidation
 * path needed — at one fetch per facility per restart, the cost is negligible.
 *
 * A Prisma-backed `MetrcReferenceCache` row was rejected because it would add
 * a schema migration and replica-shared state for very little benefit on data
 * that already tolerates 24h staleness.
 */

import type { MetrcPackageAdjustReason } from '@metrc-formul8-os/client';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  reasons: MetrcPackageAdjustReason[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns the cached adjust reasons for a facility if fresh, otherwise calls
 * the supplied fetcher, caches the result for 24h, and returns it.
 *
 * The fetcher is injected so the cache can be unit-tested in isolation
 * without standing up a full Metrc client.
 */
export async function getCachedAdjustReasons(
  facilityId: string,
  fetcher: () => Promise<MetrcPackageAdjustReason[]>,
): Promise<MetrcPackageAdjustReason[]> {
  const now = Date.now();
  const entry = cache.get(facilityId);
  if (entry && entry.expiresAt > now) {
    return entry.reasons;
  }

  const reasons = await fetcher();
  cache.set(facilityId, { reasons, expiresAt: now + TTL_MS });
  return reasons;
}

/**
 * Test-only helper to clear the module-level cache between tests.
 * Not exported for production use.
 */
export function __resetAdjustReasonsCacheForTest(): void {
  cache.clear();
}
