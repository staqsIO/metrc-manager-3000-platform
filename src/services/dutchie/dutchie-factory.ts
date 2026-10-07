import type { MetrcFacility } from '@prisma/client';
import type { IDutchieClient, DutchieFacilityScope } from './types';
import { DutchieClient, clearStateProductCache } from './dutchie-client';
import { DutchieMockClient } from './dutchie-mock';
import { DutchieNullClient } from './dutchie-null';
import { decrypt } from '@/lib/encryption';

export { clearStateProductCache };

// Cache mock clients per facility to preserve in-memory state.
// Bounded: max 200 entries each. In a long-running Next.js server, facilities
// accumulate as users switch between them. FIFO eviction prevents unbounded growth.
const mockClientCache = new Map<string, DutchieMockClient>();
const realClientCache = new Map<string, DutchieClient>();
const MAX_CLIENT_CACHE_SIZE = 200;

const VALID_SCOPES = new Set<string>(['retail', 'cultivation', 'manufacturing']);

/** Parse raw string array from DB into validated DutchieFacilityScope[]. Defaults to ['retail']. */
function parseFacilityScopes(raw: string[]): DutchieFacilityScope[] {
  const valid = raw.filter((s): s is DutchieFacilityScope => VALID_SCOPES.has(s));
  return valid.length > 0 ? valid : ['retail'];
}

/**
 * Factory that returns the appropriate Dutchie client based on facility config.
 *
 * Dutchie auth model: single API key → token fetched from /util/AuthorizationHeader/{apiKey}
 *
 * Mock mode (default): DutchieMockClient (cached per facility)
 * Sandbox mode: DutchieClient with decrypted sandbox API key
 * Production mode: DutchieClient with decrypted production API key
 *
 * The encrypted API key is stored in the "LocationKey" columns
 * (encryptedDutchieLocationKey / encryptedDutchieSandboxLocationKey).
 */
export function getDutchieClient(facility: MetrcFacility): IDutchieClient {
  const environment = facility.dutchieEnvironment ?? 'none';
  const scopes = parseFacilityScopes(facility.dutchieFacilityTypes);

  if (environment === 'none') {
    return new DutchieNullClient();
  }

  if (environment === 'mock' || environment === '' || !environment) {
    let mockClient = mockClientCache.get(facility.id);
    if (!mockClient) {
      if (mockClientCache.size >= MAX_CLIENT_CACHE_SIZE) {
        const firstKey = mockClientCache.keys().next().value;
        if (firstKey) mockClientCache.delete(firstKey);
      }
      mockClient = new DutchieMockClient({ stateCode: facility.stateCode, facilityScopes: scopes });
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

    if (!facility.encryptedDutchieSandboxLocationKey) {
      throw new Error(
        `Facility "${facility.name}" has Dutchie in sandbox mode but no sandbox API Key configured. ` +
        `Please add Dutchie sandbox credentials or switch to mock mode.`
      );
    }

    const client = new DutchieClient({
      apiKey: decrypt(facility.encryptedDutchieSandboxLocationKey),
      stateCode: facility.stateCode,
      facilityScopes: scopes,
    });
    realClientCache.set(cacheKey, client);
    return client;
  }

  if (environment === 'production') {
    const cacheKey = `${facility.id}:production`;
    const existing = realClientCache.get(cacheKey);
    if (existing) return existing;
    if (realClientCache.size >= MAX_CLIENT_CACHE_SIZE) {
      const firstKey = realClientCache.keys().next().value;
      if (firstKey) realClientCache.delete(firstKey);
    }

    if (!facility.encryptedDutchieLocationKey) {
      throw new Error(
        `Facility "${facility.name}" has Dutchie in production mode but no API Key configured. ` +
        `Please add Dutchie API credentials or switch to mock mode.`
      );
    }

    const client = new DutchieClient({
      apiKey: decrypt(facility.encryptedDutchieLocationKey),
      stateCode: facility.stateCode,
      facilityScopes: scopes,
    });
    realClientCache.set(cacheKey, client);
    return client;
  }

  throw new Error(`Invalid dutchieEnvironment: "${environment}" for facility ${facility.id}`);
}

/**
 * Clear Dutchie client caches for a facility.
 * Also clears the shared product catalog cache for the facility's state.
 */
export function clearDutchieClientCache(facilityId: string, stateCode?: string): void {
  mockClientCache.delete(facilityId);
  realClientCache.delete(`${facilityId}:sandbox`);
  realClientCache.delete(`${facilityId}:production`);
  // Clear product catalog cache for the state to avoid stale data after credential changes
  clearStateProductCache(stateCode);
}
