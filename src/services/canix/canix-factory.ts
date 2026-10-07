import type { MetrcFacility } from '@prisma/client';
import type { ICanixClient } from './types';
import { CanixClient } from './canix-client';
import { CanixCachedClient } from './canix-cache';
import { CanixMockClient } from './canix-mock';
import { CanixNullClient } from './canix-null';
import { decrypt } from '@/lib/encryption';

// Cache mock clients per facility to preserve in-memory state.
// Cache real clients keyed by facilityId:environment to isolate sandbox from production.
// Bounded: max 200 entries each. FIFO eviction prevents unbounded growth.
const mockClientCache = new Map<string, CanixMockClient>();
const realClientCache = new Map<string, CanixCachedClient>();
const MAX_CLIENT_CACHE_SIZE = 200;

/** Default cache TTL for Canix data: 120s (ERP data changes on human timescales). */
const CANIX_CACHE_TTL_MS = 120_000;

/**
 * Factory that returns the appropriate Canix client based on facility config.
 *
 * Canix auth model: company-level API key via X-API-KEY header.
 *
 * none (default): CanixNullClient — all features degrade gracefully
 * mock:           CanixMockClient (cached per facility, in-memory state)
 * sandbox:        CanixClient → CanixCachedClient (decrypted sandbox key)
 * production:     CanixClient → CanixCachedClient (decrypted production key)
 */
export function getCanixClient(facility: MetrcFacility): ICanixClient {
  const environment = facility.canixEnvironment ?? 'none';

  if (environment === 'none') {
    return new CanixNullClient();
  }

  if (environment === 'mock') {
    let mockClient = mockClientCache.get(facility.id);
    if (!mockClient) {
      if (mockClientCache.size >= MAX_CLIENT_CACHE_SIZE) {
        const firstKey = mockClientCache.keys().next().value;
        if (firstKey) mockClientCache.delete(firstKey);
      }
      mockClient = new CanixMockClient();
      mockClientCache.set(facility.id, mockClient);
    }
    return mockClient;
  }

  if (environment === 'sandbox') {
    const cacheKey = `${facility.id}:sandbox`;
    const existing = realClientCache.get(cacheKey);
    if (existing) return existing;
    if (realClientCache.size >= MAX_CLIENT_CACHE_SIZE) {
      const firstKey = realClientCache.keys().next().value;
      if (firstKey) realClientCache.delete(firstKey);
    }

    if (!facility.encryptedCanixSandboxApiKey) {
      throw new Error(
        `Facility "${facility.name}" has Canix in sandbox mode but no sandbox API key configured. ` +
        `Please add Canix sandbox credentials or switch to mock mode.`
      );
    }

    const rawClient = new CanixClient({ apiKey: decrypt(facility.encryptedCanixSandboxApiKey) });
    const cachedClient = new CanixCachedClient(rawClient, { ttlMs: CANIX_CACHE_TTL_MS });
    realClientCache.set(cacheKey, cachedClient);
    return cachedClient;
  }

  if (environment === 'production') {
    const cacheKey = `${facility.id}:production`;
    const existing = realClientCache.get(cacheKey);
    if (existing) return existing;
    if (realClientCache.size >= MAX_CLIENT_CACHE_SIZE) {
      const firstKey = realClientCache.keys().next().value;
      if (firstKey) realClientCache.delete(firstKey);
    }

    if (!facility.encryptedCanixApiKey) {
      throw new Error(
        `Facility "${facility.name}" has Canix in production mode but no API key configured. ` +
        `Please add Canix API credentials or switch to mock mode.`
      );
    }

    const rawClient = new CanixClient({ apiKey: decrypt(facility.encryptedCanixApiKey) });
    const cachedClient = new CanixCachedClient(rawClient, { ttlMs: CANIX_CACHE_TTL_MS });
    realClientCache.set(cacheKey, cachedClient);
    return cachedClient;
  }

  throw new Error(`Invalid canixEnvironment: "${environment}" for facility ${facility.id}`);
}

/**
 * Clear Canix client caches for a facility.
 * Call this when Canix credentials change.
 */
export function clearCanixClientCache(facilityId: string): void {
  mockClientCache.delete(facilityId);
  realClientCache.delete(`${facilityId}:sandbox`);
  realClientCache.delete(`${facilityId}:production`);
}
