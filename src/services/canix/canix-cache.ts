/**
 * Per-facility TTL cache layer for Canix ERP API responses.
 *
 * Wraps any ICanixClient and caches GET responses for a configurable TTL (120s default).
 * ERP data changes on human timescales (hourly/daily), so a longer TTL than Metrc's 30s
 * is appropriate and reduces API load.
 *
 * Write operations (Phase 2+) pass through to the inner client AND invalidate related caches.
 */

import type {
  ICanixClient,
  CanixFilters,
  CanixStandardCost,
  CanixBOM,
  CanixNonCannabisProduct,
  CanixItem,
  CanixSalesOrder,
  CanixLineItem,
  CanixPurchaseOrder,
  CanixPurchaseOrderPayment,
  CanixVendor,
  CanixCustomer,
  CanixAuditedAction,
  CanixWhoAmI,
} from './types';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

export interface CanixCacheConfig {
  /** Cache TTL in milliseconds. Default: 120000 (120 seconds) */
  ttlMs: number;
  /** Enable debug logging. Default: false */
  debug: boolean;
}

const DEFAULT_CONFIG: CanixCacheConfig = {
  ttlMs: 120_000,
  debug: false,
};

export class CanixCachedClient implements ICanixClient {
  private inner: ICanixClient;
  private cache = new Map<string, CacheEntry<unknown>>();
  private config: CanixCacheConfig;

  constructor(inner: ICanixClient, config?: Partial<CanixCacheConfig>) {
    this.inner = inner;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Cache helpers ────────────────────────────────────────────

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    if (this.config.debug) {
      console.log(`[CANIX-CACHE] HIT: ${key}`);
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.config.ttlMs,
    });
  }

  private invalidatePattern(prefix: string): void {
    Array.from(this.cache.keys())
      .filter(key => key.startsWith(prefix))
      .forEach(key => this.cache.delete(key));
  }

  /** Clear all cached entries. Useful when credentials change. */
  clearAll(): void {
    this.cache.clear();
  }

  /** Get cache stats for observability. */
  getStats(): { size: number; ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.config.ttlMs };
  }

  // ── Phase 0: Costs + BOMs ──────────────────────────────────

  async getStandardCosts(itemId?: string): Promise<CanixStandardCost[]> {
    const key = `costs:${itemId ?? 'all'}`;
    const cached = this.getCached<CanixStandardCost[]>(key);
    if (cached) return cached;
    const data = await this.inner.getStandardCosts(itemId);
    this.setCache(key, data);
    return data;
  }

  async getBillsOfMaterials(filters?: CanixFilters): Promise<CanixBOM[]> {
    const key = `boms:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixBOM[]>(key);
    if (cached) return cached;
    const data = await this.inner.getBillsOfMaterials(filters);
    this.setCache(key, data);
    return data;
  }

  async getBillOfMaterials(id: string): Promise<CanixBOM | null> {
    const key = `bom:${id}`;
    const cached = this.getCached<CanixBOM | null>(key);
    if (cached !== undefined) return cached;
    const data = await this.inner.getBillOfMaterials(id);
    this.setCache(key, data);
    return data;
  }

  async getNonCannabisProducts(filters?: CanixFilters): Promise<CanixNonCannabisProduct[]> {
    const key = `noncannabis:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixNonCannabisProduct[]>(key);
    if (cached) return cached;
    const data = await this.inner.getNonCannabisProducts(filters);
    this.setCache(key, data);
    return data;
  }

  async getItems(filters?: CanixFilters): Promise<CanixItem[]> {
    const key = `items:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixItem[]>(key);
    if (cached) return cached;
    const data = await this.inner.getItems(filters);
    this.setCache(key, data);
    return data;
  }

  // ── Phase 1: Orders ────────────────────────────────────────

  async getSalesOrders(filters?: CanixFilters): Promise<CanixSalesOrder[]> {
    const key = `sales_orders:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixSalesOrder[]>(key);
    if (cached) return cached;
    const data = await this.inner.getSalesOrders(filters);
    this.setCache(key, data);
    return data;
  }

  async getSalesOrder(id: string): Promise<CanixSalesOrder | null> {
    const key = `sales_order:${id}`;
    const cached = this.getCached<CanixSalesOrder | null>(key);
    if (cached !== undefined) return cached;
    const data = await this.inner.getSalesOrder(id);
    this.setCache(key, data);
    return data;
  }

  async getSalesOrderContents(id: string): Promise<CanixLineItem[]> {
    const key = `sales_order_contents:${id}`;
    const cached = this.getCached<CanixLineItem[]>(key);
    if (cached) return cached;
    const data = await this.inner.getSalesOrderContents(id);
    this.setCache(key, data);
    return data;
  }

  async getPurchaseOrders(filters?: CanixFilters): Promise<CanixPurchaseOrder[]> {
    const key = `purchase_orders:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixPurchaseOrder[]>(key);
    if (cached) return cached;
    const data = await this.inner.getPurchaseOrders(filters);
    this.setCache(key, data);
    return data;
  }

  async getPurchaseOrder(id: string): Promise<CanixPurchaseOrder | null> {
    const key = `purchase_order:${id}`;
    const cached = this.getCached<CanixPurchaseOrder | null>(key);
    if (cached !== undefined) return cached;
    const data = await this.inner.getPurchaseOrder(id);
    this.setCache(key, data);
    return data;
  }

  async getPurchaseOrderContents(id: string): Promise<CanixLineItem[]> {
    const key = `purchase_order_contents:${id}`;
    const cached = this.getCached<CanixLineItem[]>(key);
    if (cached) return cached;
    const data = await this.inner.getPurchaseOrderContents(id);
    this.setCache(key, data);
    return data;
  }

  async getPurchaseOrderPayments(id: string): Promise<CanixPurchaseOrderPayment[]> {
    const key = `purchase_order_payments:${id}`;
    const cached = this.getCached<CanixPurchaseOrderPayment[]>(key);
    if (cached) return cached;
    const data = await this.inner.getPurchaseOrderPayments(id);
    this.setCache(key, data);
    return data;
  }

  async getVendors(filters?: CanixFilters): Promise<CanixVendor[]> {
    const key = `vendors:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixVendor[]>(key);
    if (cached) return cached;
    const data = await this.inner.getVendors(filters);
    this.setCache(key, data);
    return data;
  }

  async getCustomers(filters?: CanixFilters): Promise<CanixCustomer[]> {
    const key = `customers:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixCustomer[]>(key);
    if (cached) return cached;
    const data = await this.inner.getCustomers(filters);
    this.setCache(key, data);
    return data;
  }

  // ── Phase 2: Audit ─────────────────────────────────────────

  async getAuditedActions(filters?: CanixFilters): Promise<CanixAuditedAction[]> {
    const key = `audited_actions:${JSON.stringify(filters ?? {})}`;
    const cached = this.getCached<CanixAuditedAction[]>(key);
    if (cached) return cached;
    const data = await this.inner.getAuditedActions(filters);
    this.setCache(key, data);
    return data;
  }

  // ── Auth ───────────────────────────────────────────────────

  async whoami(): Promise<CanixWhoAmI> {
    const key = 'whoami';
    const cached = this.getCached<CanixWhoAmI>(key);
    if (cached) return cached;
    const data = await this.inner.whoami();
    this.setCache(key, data);
    return data;
  }
}
