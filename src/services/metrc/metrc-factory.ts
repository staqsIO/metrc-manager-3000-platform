import type { MetrcFacility, PrismaClient } from '@prisma/client';
import type { IMetrcClient } from '@metrc-formul8-os/client';
import { MetrcClient, MetrcRateLimiter, withRetryClient, withRateLimitClient } from '@metrc-formul8-os/client';
import { patchClientForV2 } from './metrc-v2-client';
import { decrypt } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { MetrcMockClient } from './metrc-mock';
import { MetrcCachedClient } from './metrc-cache';
import { createInstrumentedClient } from './instrumented-client';

type MetrcEnvironmentOrMock = 'mock' | 'sandbox' | 'production';

// States where Metrc requires v2 endpoints (v1 returns 401).
// CA v2 returns empty { Data: [], Total: 0 } — do NOT add CA here.
const V2_REQUIRED_STATES = new Set(['MA', 'CA']);

/**
 * Resolve the Formul8 vendor API key from environment variables.
 * Keys are per-state, per-environment: METRC_VENDOR_KEY_{STATE}_{ENV}
 * Falls back to the per-facility encrypted key for backward compat.
 */
function getVendorKeyFromEnv(stateCode: string, environment: 'sandbox' | 'production'): string | null {
  const state = stateCode.toUpperCase();
  // Check current convention: METRC_VENDOR_API_KEY_MA
  // Then legacy convention: METRC_VENDOR_KEY_MA_PROD
  // Then general fallback: METRC_VENDOR_API_KEY
  const envSuffix = environment === 'sandbox' ? 'SANDBOX' : 'PROD';
  const key =
    process.env[`METRC_VENDOR_API_KEY_${state}`] ??
    process.env[`METRC_VENDOR_KEY_${state}_${envSuffix}`] ??
    process.env['METRC_VENDOR_API_KEY'] ??
    null;
  return key || null;
}

// Cache mock clients per facility to preserve in-memory state during session
const mockClientCache = new Map<string, MetrcMockClient>();

// Cache wrapped clients per facility+environment (+optional userId for write clients)
// Read clients are MetrcCachedClient; write clients are raw IMetrcClient (no cache layer)
const clientCache = new Map<string, IMetrcClient>();

// Shared rate limiter singleton — per-facility token tracking
const sharedRateLimiter = new MetrcRateLimiter();

function validateEnvironment(value: string, facilityId: string): MetrcEnvironmentOrMock {
  if (value === 'mock' || value === 'sandbox' || value === 'production') {
    return value;
  }
  throw new Error(`Invalid metrcEnvironment: "${value}" for facility ${facilityId}`);
}

/**
 * Factory that returns the appropriate Metrc client based on facility config.
 *
 * Mock mode: MetrcMockClient (cached per facility for in-memory state)
 * Sandbox mode: MetrcClient using sandbox credentials + sandbox API URL
 * Production mode: MetrcClient using production credentials + production API URL
 *
 * Both sandbox and production clients are wrapped in MetrcCachedClient (30s TTL).
 * Cache keys include the environment to prevent stale data when switching.
 */
export function getMetrcClient(facility: MetrcFacility): IMetrcClient {
  const environment = validateEnvironment(facility.metrcEnvironment, facility.id);

  if (environment === 'mock') {
    // Reuse mock client for same facility to preserve in-memory write state
    const mockCacheKey = `${facility.id}:mock`;
    const existingMock = clientCache.get(mockCacheKey);
    if (existingMock) return existingMock;

    let mockClient = mockClientCache.get(facility.id);
    if (!mockClient) {
      mockClient = new MetrcMockClient();
      mockClientCache.set(facility.id, mockClient);
    }
    // Wrap mock in cache too — prevents redundant computation during a request burst
    const cachedMock = new MetrcCachedClient(mockClient, { ttlMs: 5000 }, facility.id);
    clientCache.set(mockCacheKey, cachedMock);
    return cachedMock;
  }

  // Resolve user key from facility
  const encryptedUserApiKey = environment === 'sandbox'
    ? facility.encryptedSandboxUserApiKey
    : facility.encryptedUserApiKey;

  if (!encryptedUserApiKey) {
    throw new Error(
      `Facility "${facility.name}" is in ${environment} mode but has no ${environment} User API Key configured. ` +
      `Please add your Metrc User API Key in Facility Settings or switch to mock mode.`
    );
  }

  // Resolve vendor key: env var first (centralized per-state), then per-facility fallback
  const envVendorKey = getVendorKeyFromEnv(facility.stateCode, environment);
  const encryptedVendorApiKey = environment === 'sandbox'
    ? facility.encryptedSandboxVendorApiKey
    : facility.encryptedVendorApiKey;

  if (!envVendorKey && !encryptedVendorApiKey) {
    throw new Error(
      `No vendor API key found for ${facility.stateCode} ${environment}. ` +
      `Set METRC_VENDOR_KEY_${facility.stateCode.toUpperCase()}_${environment === 'sandbox' ? 'SANDBOX' : 'PROD'} in environment variables.`
    );
  }

  // Cache key includes environment so sandbox and production don't share stale data
  const cacheKey = `${facility.id}:${environment}`;
  const existingCached = clientCache.get(cacheKey);
  if (existingCached) {
    return existingCached;
  }

  // Decrypt keys before passing to shared package client (package expects plaintext)
  const vendorApiKey = envVendorKey ?? decrypt(encryptedVendorApiKey!);
  const userApiKey = decrypt(encryptedUserApiKey);

  // Create real client with retry + rate limiting wrappers
  // Metrc API uses HTTP Basic auth (base64 vendor:user) for all environments
  const baseClient = new MetrcClient({
    stateCode: facility.stateCode,
    licenseNumber: facility.licenseNumber,
    vendorApiKey,
    userApiKey,
    environment,
    authMethod: 'basic',
  });
  let realClient: IMetrcClient = V2_REQUIRED_STATES.has(facility.stateCode.toUpperCase())
    ? patchClientForV2(baseClient)
    : baseClient;
  // Rate limit wraps retry so retried requests still consume rate limiter tokens
  realClient = withRateLimitClient(withRetryClient(realClient), sharedRateLimiter, facility.id);

  // Per-call observability sits BELOW the cache: cache hits skip the wrapper
  // entirely so MetrcApiCall rows record only real network requests.
  const instrumented = createInstrumentedClient(realClient, facility.id, prisma);

  // Wrap in cache layer (30s TTL for real API calls)
  const cachedClient = new MetrcCachedClient(instrumented, { ttlMs: 30000 }, facility.id);
  clientCache.set(cacheKey, cachedClient);

  return cachedClient;
}

/**
 * Get a Metrc client for write operations using per-user credentials.
 * Looks up the user's personal Metrc User API Key; falls back to facility key.
 * If facility.requirePerUserCredentials is true and no user key found, throws.
 *
 * This function performs a DB lookup. Do not call from read-only query paths.
 * Use getMetrcClient(facility) for reads.
 */
export async function getMetrcClientForWrite(
  facility: MetrcFacility,
  userId: string | undefined,
  prisma: PrismaClient,
): Promise<IMetrcClient> {
  const environment = validateEnvironment(facility.metrcEnvironment, facility.id);

  // Mock mode and no userId: skip per-user lookup
  if (!userId || environment === 'mock') {
    return getMetrcClient(facility);
  }

  // Look up user credential
  const userCred = await prisma.facilityUserCredential.findUnique({
    where: { facilityId_userId: { facilityId: facility.id, userId } },
  });

  const encryptedUserKey = environment === 'sandbox'
    ? userCred?.encryptedSandboxUserApiKey
    : userCred?.encryptedUserApiKey;

  if (!encryptedUserKey || !userCred?.isActive) {
    // No per-user key — check enforcement
    if ((facility as MetrcFacility & { requirePerUserCredentials?: boolean }).requirePerUserCredentials) {
      throw new Error(
        'This facility requires a personal Metrc User API Key. Please configure it in Facility Settings > Team.'
      );
    }
    // Fall back to facility-level key
    return getMetrcClient(facility);
  }

  // Per-user cache key
  const cacheKey = `${facility.id}:${environment}:${userId}`;
  const existing = clientCache.get(cacheKey);
  if (existing) return existing;

  // Vendor key: env var first, then per-facility fallback
  const envVendorKey = getVendorKeyFromEnv(facility.stateCode, environment);
  const encryptedVendorApiKey = environment === 'sandbox'
    ? facility.encryptedSandboxVendorApiKey
    : facility.encryptedVendorApiKey;

  if (!envVendorKey && !encryptedVendorApiKey) {
    throw new Error(
      `No vendor API key found for ${facility.stateCode} ${environment}.`
    );
  }

  const vendorApiKey = envVendorKey ?? decrypt(encryptedVendorApiKey!);
  const userApiKey = decrypt(encryptedUserKey);

  const writeBaseClient = new MetrcClient({
    stateCode: facility.stateCode,
    licenseNumber: facility.licenseNumber,
    vendorApiKey,
    userApiKey,
    environment,
    authMethod: 'basic',
  });
  let realClient: IMetrcClient = V2_REQUIRED_STATES.has(facility.stateCode.toUpperCase())
    ? patchClientForV2(writeBaseClient)
    : writeBaseClient;
  realClient = withRateLimitClient(withRetryClient(realClient), sharedRateLimiter, facility.id);
  // Per-call observability — every write call writes a MetrcApiCall row.
  const instrumented = createInstrumentedClient(realClient, facility.id, prisma);
  // Write clients must NOT be wrapped in MetrcCachedClient.
  // Caching reads on a per-user write client creates stale entries that are
  // never invalidated by facility-level write operations on the shared client.
  // Write operations must always hit the live API.
  clientCache.set(cacheKey, instrumented);
  return instrumented;
}

/**
 * Clear all client caches for a facility (e.g., when switching environments).
 * Uses prefix matching to also clear per-user entries.
 */
export function clearClientCache(facilityId: string): void {
  // Clear ALL entries for this facility (including per-user entries)
  for (const key of Array.from(clientCache.keys())) {
    if (key.startsWith(`${facilityId}:`)) {
      clientCache.delete(key);
    }
  }
  mockClientCache.delete(facilityId);
}

/**
 * Clear cached clients for a specific user on a facility (e.g., when user updates their key).
 */
export function clearUserClientCache(facilityId: string, userId: string): void {
  clientCache.delete(`${facilityId}:sandbox:${userId}`);
  clientCache.delete(`${facilityId}:production:${userId}`);
}

/**
 * Get rate limiter stats for monitoring.
 */
export function getRateLimiterStats(facilityId: string): { tokens: number; queued: number } {
  return sharedRateLimiter.getStats(facilityId);
}
