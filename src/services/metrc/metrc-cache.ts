/**
 * Per-facility TTL cache layer for Metrc API responses.
 *
 * Wraps any IMetrcClient and caches GET responses for a configurable TTL.
 * Multiple tRPC endpoints sharing the same underlying data (e.g., inventory.getActive,
 * inventory.getAgingSummary, analytics.trends) all benefit from a single cached fetch.
 *
 * Write operations pass through to the inner client AND invalidate related caches.
 */

import { MetrcApiError, MetrcRateLimitError } from '@metrc-formul8-os/client';

import type {
  IMetrcClient,
  MetrcPackage,
  MetrcPlant,
  MetrcTransfer,
  MetrcDelivery,
  MetrcDeliveryPackage,
  MetrcDeliveryPackageWholesale,
  MetrcSaleReceipt,
  MetrcLabTest,
  MetrcStrain,
  MetrcItem,
  MetrcLocation,
  MetrcHarvest,
  MetrcHarvestWaste,
  MetrcPlantBatch,
  MetrcPlantBatchWaste,
  MetrcWasteReason,
  MetrcPackageAdjustReason,
  MetrcWasteMethod,
  MetrcTag,
  MetrcPaginationParams,
} from './types';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

export interface CacheConfig {
  /** Cache TTL in milliseconds. Default: 30000 (30 seconds) */
  ttlMs: number;
  /** Enable debug logging. Default: false */
  debug: boolean;
}

const DEFAULT_CONFIG: CacheConfig = {
  ttlMs: 30000,
  debug: false,
};

/**
 * Extended TTL for read-heavy endpoints that rarely change.
 * These are full-collection fetches (all active packages, items, strains, locations).
 * Write operations invalidate these caches, so staleness is bounded.
 */
const EXTENDED_TTL_PREFIXES: Record<string, number> = {
  'packages:active': 120_000,   // 2 minutes — changes on sales/transfers
  'packages:onhold': 120_000,
  'packages:inactive': 120_000,
  'items:active': 300_000,      // 5 minutes — item definitions rarely change
  'strains:active': 300_000,    // 5 minutes — strain definitions rarely change
  'locations:active': 300_000,  // 5 minutes — location definitions rarely change
  'plants:active': 120_000,
  'plantbatches:active': 120_000,
  'harvests:active': 120_000,
  'harvests:inactive': 120_000,
  'transfers:incoming': 120_000,
  'transfers:outgoing': 120_000,
  // Sales receipts: Metrc rate-limits the inactive endpoint aggressively (429
  // observed in production after a single fetch). Long TTL — historical
  // receipts don't change often, and the user-facing "Inactive" tab tolerates
  // 5 min staleness. Active gets a shorter TTL since users expect freshness.
  'transfers:deliveries': 300_000, // 5 minutes — delivery/package contents rarely change mid-session
  'sales:receipts': 60_000,
  'sales:receipts:active': 60_000,
  'sales:receipts:inactive': 300_000,  // 5 minutes — heaviest endpoint
  'sales:receipt': 600_000,             // 10 minutes — receipt detail is immutable once captured
};

/**
 * Module-level 429 circuit breaker.
 * When Metrc returns a 429 for a facility, ALL calls for that facility are blocked
 * for COOLDOWN_MS. This prevents the death spiral where every page load fires
 * 6 queries × 3 retries = 18 API calls, each deepening the rate limit hole.
 */
const rateLimitCooldowns = new Map<string, number>(); // facilityId -> blockedUntil timestamp
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes — needs to be long enough for Metrc to fully recover

/** Reset circuit breaker for a specific facility or all facilities. */
export function resetCircuitBreaker(facilityId?: string): void {
  if (facilityId) {
    rateLimitCooldowns.delete(facilityId);
  } else {
    rateLimitCooldowns.clear();
  }
  console.log(`[METRC-CIRCUIT-BREAKER] Reset${facilityId ? ` for ${facilityId}` : ' (all)'} — next call will probe Metrc.`);
}

export class MetrcCachedClient implements IMetrcClient {
  private inner: IMetrcClient;
  private cache = new Map<string, CacheEntry<unknown>>();
  private config: CacheConfig;
  private facilityId: string;
  /**
   * In-flight request map for request coalescing.
   * When multiple tRPC queries call the same method concurrently (e.g., 3 queries
   * all calling getActivePackages on page load), the first creates a promise and
   * subsequent callers await the same promise instead of starting new fetches.
   */
  private inflight = new Map<string, Promise<unknown>>();

  constructor(inner: IMetrcClient, config?: Partial<CacheConfig>, facilityId?: string) {
    this.inner = inner;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.facilityId = facilityId ?? 'unknown';
  }

  /** Check if this facility is in a 429 cooldown. Throws immediately if so. */
  private checkCircuitBreaker(): void {
    const blockedUntil = rateLimitCooldowns.get(this.facilityId);
    if (blockedUntil) {
      if (Date.now() < blockedUntil) {
        const remainingMin = Math.ceil((blockedUntil - Date.now()) / 60_000);
        throw new MetrcRateLimitError(
          `Circuit breaker open — cooling down for ~${remainingMin} min. Data will auto-load when Metrc recovers.`
        );
      }
      // Cooldown expired — clear it
      rateLimitCooldowns.delete(this.facilityId);
      console.log(`[METRC-CIRCUIT-BREAKER] Cooldown expired for ${this.facilityId}, retrying Metrc API...`);
    }
  }

  /** Record a 429 and activate the circuit breaker for this facility's license. */
  private onRateLimited(): void {
    const until = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    rateLimitCooldowns.set(this.facilityId, until);
    console.warn(
      `[METRC-CIRCUIT-BREAKER] Facility ${this.facilityId} rate limited. ` +
      `Blocking API calls for this facility for ${RATE_LIMIT_COOLDOWN_MS / 1000}s.`
    );
  }

  // ---- Cache helpers ----

  /** Resolve the TTL for a cache key, using extended TTL for known read-heavy prefixes. */
  private getTtlForKey(key: string): number {
    for (const [prefix, ttl] of Object.entries(EXTENDED_TTL_PREFIXES)) {
      if (key.startsWith(prefix)) return ttl;
    }
    return this.config.ttlMs;
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    if (this.config.debug) {
      console.log(`[METRC-CACHE] HIT: ${key}`);
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    const ttl = this.getTtlForKey(key);
    this.cache.set(key, {
      data,
      expires: Date.now() + ttl,
    });
    if (this.config.debug) {
      console.log(`[METRC-CACHE] SET: ${key} (TTL: ${ttl}ms)`);
    }
  }

  /**
   * Fetch with request coalescing: if a fetch for the same cache key is already
   * in-flight, return the existing promise instead of starting a new fetch.
   * This eliminates duplicate API calls when 3 tRPC queries fire simultaneously.
   */
  private async fetchCoalesced<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Circuit breaker: fail fast if facility is in 429 cooldown
    this.checkCircuitBreaker();

    // Check cache first
    const cached = this.getCached<T>(key);
    if (cached) return cached;

    // Check if a fetch is already in-flight for this key
    const existing = this.inflight.get(key);
    if (existing) {
      if (this.config.debug) {
        console.log(`[METRC-CACHE] COALESCE: ${key}`);
      }
      return existing as Promise<T>;
    }

    // Start new fetch and register it as in-flight
    const promise = fetcher().then((data) => {
      this.setCache(key, data);
      this.inflight.delete(key);
      return data;
    }).catch((err) => {
      this.inflight.delete(key);
      // Activate circuit breaker on 429
      if (err instanceof MetrcApiError && err.statusCode === 429) {
        this.onRateLimited();
      }
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  private invalidatePattern(prefix: string): void {
    Array.from(this.cache.keys()).forEach(key => {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    });
    if (this.config.debug) {
      console.log(`[METRC-CACHE] INVALIDATED: ${prefix}*`);
    }
  }

  /** Invalidate all cached data (e.g., after a write operation). */
  invalidateAll(): void {
    this.cache.clear();
    if (this.config.debug) {
      console.log(`[METRC-CACHE] INVALIDATED ALL`);
    }
  }

  /** Get cache stats for monitoring. */
  getStats(): { size: number; keys: string[] } {
    // Clean expired entries first
    const now = Date.now();
    Array.from(this.cache.entries()).forEach(([key, entry]) => {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    });
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  // ---- Cached read operations ----

  async getActivePlants(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlant[]> {
    // Normalize: strip pagination from cache key — v2 fetchAllPages handles its own pagination
    const key = `plants:active:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getActivePlants(filters, pagination));
  }

  async getPlant(plantId: number): Promise<MetrcPlant> {
    const key = `plants:${plantId}`;
    return this.fetchCoalesced(key, () => this.inner.getPlant(plantId));
  }

  async getActivePackages(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPackage[]> {
    // Normalize: strip pagination from cache key — v2 fetchAllPages handles its own pagination
    const key = `packages:active:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getActivePackages(filters, pagination));
  }

  async getPackage(packageId: number): Promise<MetrcPackage> {
    const key = `packages:${packageId}`;
    return this.fetchCoalesced(key, () => this.inner.getPackage(packageId));
  }

  async getPackageTypes(): Promise<string[]> {
    const key = 'packages:types';
    return this.fetchCoalesced(key, () => this.inner.getPackageTypes());
  }

  async getIncomingTransfers(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    const key = `transfers:incoming:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getIncomingTransfers(filters, pagination));
  }

  async getOutgoingTransfers(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    const key = `transfers:outgoing:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getOutgoingTransfers(filters, pagination));
  }

  async getRejectedTransfers(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    const key = `transfers:rejected:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getRejectedTransfers(filters, pagination));
  }

  async getTransferDeliveries(transferId: number): Promise<MetrcDelivery[]> {
    const key = `transfers:deliveries:${transferId}`;
    return this.fetchCoalesced(key, () => this.inner.getTransferDeliveries(transferId));
  }

  async getDeliveryPackages(deliveryId: number): Promise<MetrcDeliveryPackage[]> {
    const key = `transfers:deliveries:packages:${deliveryId}`;
    return this.fetchCoalesced(key, () => this.inner.getDeliveryPackages(deliveryId));
  }

  /**
   * Fetch wholesale pricing for delivery packages
   * (`/transfers/v2/deliveries/{id}/packages/wholesale`), now provided by the client.
   */
  async getDeliveryPackagesWholesale(deliveryId: number): Promise<MetrcDeliveryPackageWholesale[]> {
    const key = `transfers:deliveries:packages:wholesale:${deliveryId}`;
    return this.fetchCoalesced(key, async () => {
      if (typeof this.inner.getDeliveryPackagesWholesale === 'function') {
        return this.inner.getDeliveryPackagesWholesale(deliveryId);
      }
      return [];
    });
  }

  async getSalesReceipts(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcSaleReceipt[]> {
    const key = `sales:receipts:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getSalesReceipts(filters, pagination));
  }

  async getLabTestResults(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcLabTest[]> {
    const key = `labtests:results:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getLabTestResults(filters, pagination));
  }

  async getActiveStrains(pagination?: MetrcPaginationParams): Promise<MetrcStrain[]> {
    const key = 'strains:active';
    return this.fetchCoalesced(key, () => this.inner.getActiveStrains(pagination));
  }

  async getActiveItems(pagination?: MetrcPaginationParams): Promise<MetrcItem[]> {
    const key = 'items:active';
    return this.fetchCoalesced(key, () => this.inner.getActiveItems(pagination));
  }

  async getActiveLocations(pagination?: MetrcPaginationParams): Promise<MetrcLocation[]> {
    const key = 'locations:active';
    return this.fetchCoalesced(key, () => this.inner.getActiveLocations(pagination));
  }

  // ---- Cached plant batch operations ----

  async getActivePlantBatches(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlantBatch[]> {
    const key = `plantbatches:active:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getActivePlantBatches(filters, pagination));
  }

  async getInactivePlantBatches(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlantBatch[]> {
    const key = `plantbatches:inactive:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getInactivePlantBatches(filters, pagination));
  }

  async getPlantBatch(plantBatchId: number): Promise<MetrcPlantBatch> {
    const key = `plantbatches:${plantBatchId}`;
    return this.fetchCoalesced(key, () => this.inner.getPlantBatch(plantBatchId));
  }

  // ---- Plant batch write operations ----

  async createPlantBatches(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createPlantBatches(data);
    this.invalidatePattern('plantbatches:');
  }

  async destroyPlantBatches(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.destroyPlantBatches(data);
    this.invalidatePattern('plantbatches:');
  }

  async changePlantBatchGrowthPhase(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.changePlantBatchGrowthPhase(data);
    this.invalidatePattern('plantbatches:');
    this.invalidatePattern('plants:');
  }

  // ---- Cached harvest operations ----

  async getActiveHarvests(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    const key = `harvests:active:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getActiveHarvests(filters, pagination));
  }

  async getOnHoldHarvests(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    const key = `harvests:onhold:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getOnHoldHarvests(filters, pagination));
  }

  async getInactiveHarvests(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    const key = `harvests:inactive:${JSON.stringify(filters ?? {})}`;
    return this.fetchCoalesced(key, () => this.inner.getInactiveHarvests(filters, pagination));
  }

  async getHarvest(harvestId: number): Promise<MetrcHarvest> {
    const key = `harvests:${harvestId}`;
    return this.fetchCoalesced(key, () => this.inner.getHarvest(harvestId));
  }

  async getHarvestWaste(harvestId: number): Promise<MetrcHarvestWaste[]> {
    const key = `harvests:waste:${harvestId}`;
    return this.fetchCoalesced(key, () => this.inner.getHarvestWaste(harvestId));
  }

  async getHarvestWasteTypes(): Promise<string[]> {
    const key = 'harvests:waste:types';
    return this.fetchCoalesced(key, () => this.inner.getHarvestWasteTypes());
  }

  // ---- Write operations (pass through + invalidate) ----

  async adjustPackages(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.adjustPackages(data);
    this.invalidatePattern('packages:');
  }

  async createPackages(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createPackages(data);
    this.invalidatePattern('packages:');
  }

  async finishPackages(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.finishPackages(data);
    this.invalidatePattern('packages:');
  }

  async changePackageNote(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.changePackageNote(data);
    this.invalidatePattern('packages:');
  }

  async remediatePackages(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.remediatePackages(data);
    this.invalidatePattern('packages:');
  }

  async submitPackagesForTesting(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.submitPackagesForTesting(data);
    this.invalidatePattern('packages:');
    this.invalidatePattern('labtests:');
    this.invalidatePattern('tags:');
  }

  // ---- Processing write operations ----

  async createProcessingPackages(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createProcessingPackages(data);
    this.invalidatePattern('packages:');
  }

  // ---- Harvest write operations ----

  async finishHarvests(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.finishHarvests(data);
    this.invalidatePattern('harvests:');
  }

  async createPackagesFromHarvest(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createPackagesFromHarvest(data);
    this.invalidatePattern('harvests:');
    this.invalidatePattern('packages:');
  }

  async recordHarvestWaste(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.recordHarvestWaste(data);
    this.invalidatePattern('harvests:');
  }

  // ---- Strain write operations ----

  async createStrains(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createStrains(data);
    this.invalidatePattern('strains:');
  }

  async updateStrains(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.updateStrains(data);
    this.invalidatePattern('strains:');
  }

  // ---- Item write operations ----

  async createItems(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createItems(data);
    this.invalidatePattern('items:');
  }

  async updateItems(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.updateItems(data);
    this.invalidatePattern('items:');
  }

  // ---- Location write operations ----

  async createLocations(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createLocations(data);
    this.invalidatePattern('locations:');
    this.invalidatePattern('packages:');
    this.invalidatePattern('plantbatches:');
  }

  async changePackageLocations(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.changePackageLocations(data);
    this.invalidatePattern('packages:');
  }

  // ---- Transfer write operations ----

  async createExternalIncomingTransfers(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createExternalIncomingTransfers(data);
    this.invalidatePattern('transfers:');
  }

  async createExternalOutgoingTransfers(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createExternalOutgoingTransfers(data);
    this.invalidatePattern('transfers:');
    this.invalidatePattern('packages:');  // packages move into transit
  }

  // ---- Sales write operations ----

  async createSalesReceipts(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.createSalesReceipts(data);
    this.invalidatePattern('sales:');
    this.invalidatePattern('packages:');  // sales deduct package quantities
  }

  // ---- Lab test write operations ----

  async recordLabTests(data: Record<string, unknown>[]): Promise<void> {
    await this.inner.recordLabTests(data);
    this.invalidatePattern('labtests:');
    this.invalidatePattern('packages:');  // LabTestingState lives on packages
  }

  // ---- Cached waste & loss operations ----

  async getPlantBatchWaste(licenseNumber: string): Promise<MetrcPlantBatchWaste[]> {
    const key = `plantbatches:waste:${licenseNumber}`;
    return this.fetchCoalesced(key, () => this.inner.getPlantBatchWaste(licenseNumber));
  }

  async getPlantBatchWasteReasons(licenseNumber: string): Promise<MetrcWasteReason[]> {
    const key = `plantbatches:waste:reasons:${licenseNumber}`;
    return this.fetchCoalesced(key, () => this.inner.getPlantBatchWasteReasons(licenseNumber));
  }

  async recordPlantBatchWaste(licenseNumber: string, data: Record<string, unknown>[]): Promise<void> {
    await this.inner.recordPlantBatchWaste(licenseNumber, data);
    this.invalidatePattern('plantbatches:');
  }

  async getPackageAdjustReasons(licenseNumber: string): Promise<MetrcPackageAdjustReason[]> {
    const key = `packages:adjust:reasons:${licenseNumber}`;
    return this.fetchCoalesced(key, () => this.inner.getPackageAdjustReasons(licenseNumber));
  }

  async getPlantWasteMethods(): Promise<MetrcWasteMethod[]> {
    const key = 'plants:waste:methods';
    return this.fetchCoalesced(key, () => this.inner.getPlantWasteMethods());
  }

  async deleteHarvestWaste(licenseNumber: string, wasteId: number): Promise<void> {
    await this.inner.deleteHarvestWaste(licenseNumber, wasteId);
    this.invalidatePattern('harvests:');
  }

  async destroyPlants(licenseNumber: string, data: Record<string, unknown>[]): Promise<void> {
    await this.inner.destroyPlants(licenseNumber, data);
    this.invalidatePattern('plants:');
  }

  // ---- Cached tag operations ----

  async getAvailableTags(pagination?: MetrcPaginationParams): Promise<MetrcTag[]> {
    const key = 'tags:available';
    return this.fetchCoalesced(key, () => this.inner.getAvailableTags(pagination));
  }
}
