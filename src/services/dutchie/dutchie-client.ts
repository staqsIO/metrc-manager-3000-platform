import type {
  IDutchieClient,
  DutchieDelivery,
  DutchieLineItem,
  DutchieCustomer,
  DutchieCustomerType,
  DutchieDiscount,
  DutchieBrand,
  DutchieHarvest,
  DutchieEmployee,
  DutchieWhoAmI,
  DutchieRawTransaction,
  DutchieRawTransactionItem,
  DutchieRawProduct,
  DutchieProductDetail,
  DutchieLocationOverride,
  DutchieBulkUpdateResult,
  DutchieFacilityScope,
  DutchieInventoryItem,
} from './types';

const DUTCHIE_BASE_URL = 'https://api.pos.dutchie.com';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const DEFAULT_AUTH_TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_WINDOW_HOURS = 1440; // Dutchie API limit: max 1440 hours per request
const CHUNK_DAYS = 58; // Stay safely under the 60-day (1440 hour) limit

interface DutchieClientConfig {
  apiKey: string;
  stateCode?: string;
  facilityScopes?: DutchieFacilityScope[];
  authTokenTTLMs?: number;
}

interface ProductInfo {
  name: string;
  category: string;
  brand: string | null;
}

// Product catalog cache shared across clients with the same API key in a state.
// Keyed by "stateCode:apiKeyPrefix" so facilities with different Dutchie keys
// (i.e. different locations) never share catalogs.
// Bounded: max 50 entries with LRU eviction (covers 50 unique state:key combos).
const productCatalogCache = new Map<string, {
  products: Map<number, ProductInfo>;
  loadedAt: number;
}>();
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CATALOG_CACHE_SIZE = 50;

function catalogCacheKey(stateCode: string, apiKey: string): string {
  // Use first 12 chars of API key as fingerprint — enough to distinguish keys
  return `${stateCode}:${apiKey.slice(0, 12)}`;
}

/** Clear product catalog cache. Pass stateCode to clear entries for that state, omit to clear all. */
export function clearStateProductCache(stateCode?: string): void {
  if (stateCode) {
    const prefix = `${stateCode}:`;
    Array.from(productCatalogCache.keys())
      .filter(key => key.startsWith(prefix))
      .forEach(key => productCatalogCache.delete(key));
  } else {
    productCatalogCache.clear();
  }
}

export class DutchieClient implements IDutchieClient {
  private authHeader: string | null = null;
  private tokenFetchedAt: number | null = null;
  private authInitPromise: Promise<void> | null = null;

  // Enrichment caches
  private productMap: Map<number, ProductInfo> | null = null;
  private productMapLoadedAt: number | null = null;
  private employeeMap: Map<number, string> | null = null;
  private employeeMapLoadedAt: number | null = null;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private config: DutchieClientConfig) {
    console.log(
      `[Dutchie] Client initialized — apiKey length: ${config.apiKey.length}` +
      (config.stateCode ? `, state: ${config.stateCode}` : '') +
      (config.facilityScopes ? `, scopes: ${config.facilityScopes.join(',')}` : ''),
    );
  }

  /** Check if this client's facility has a given Dutchie scope. No scopes configured = assume all. */
  private hasScope(scope: DutchieFacilityScope): boolean {
    if (!this.config.facilityScopes || this.config.facilityScopes.length === 0) return true;
    return this.config.facilityScopes.includes(scope);
  }

  /**
   * Initialize auth header using Dutchie's /util/AuthorizationHeader endpoint.
   * Falls back to locally-computed Basic auth if endpoint is unreachable.
   */
  private async initializeAuth(): Promise<void> {
    // Fallback: locally-computed Basic auth (no trailing colon — matches server format)
    const localAuth = `Basic ${Buffer.from(this.config.apiKey).toString('base64')}`;

    try {
      const url = `${DUTCHIE_BASE_URL}/util/AuthorizationHeader/${this.config.apiKey}`;
      console.log(`[Dutchie] Fetching auth token from /util/AuthorizationHeader...`);

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        const raw = await response.text();
        let serverToken = raw.trim();
        if (serverToken.startsWith('"') && serverToken.endsWith('"')) {
          serverToken = JSON.parse(serverToken) as string;
        }
        this.authHeader = serverToken;
        console.log(`[Dutchie] Auth token from server — type: ${serverToken.split(' ')[0]}`);
      } else {
        console.warn(`[Dutchie] Auth endpoint returned ${response.status} — using local Basic auth`);
        this.authHeader = localAuth;
      }
    } catch (err) {
      console.warn(`[Dutchie] Auth endpoint unreachable — using local Basic auth: ${err instanceof Error ? err.message : String(err)}`);
      this.authHeader = localAuth;
    }

    this.tokenFetchedAt = Date.now();
    console.log(`[Dutchie] Auth initialized — type: ${this.authHeader.split(' ')[0]}`);
  }

  private async ensureAuth(): Promise<void> {
    const ttl = this.config.authTokenTTLMs ?? DEFAULT_AUTH_TOKEN_TTL_MS;
    const isExpired = this.tokenFetchedAt !== null && (Date.now() - this.tokenFetchedAt) > ttl;

    if (this.authHeader && !isExpired) return;

    if (isExpired) {
      console.log(`[Dutchie] Auth token expired (age: ${Math.round((Date.now() - this.tokenFetchedAt!) / 60000)}min) — refreshing`);
      this.authHeader = null;
    }

    if (!this.authInitPromise) {
      this.authInitPromise = this.initializeAuth().finally(() => {
        this.authInitPromise = null;
      });
    }
    await this.authInitPromise;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> },
  ): Promise<T> {
    await this.ensureAuth();

    const method = options?.method ?? 'GET';
    const url = new URL(path, DUTCHIE_BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    if (!this.authHeader) {
      throw new Error('Dutchie auth header not set after ensureAuth()');
    }

    let hasRetried401 = false;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Dutchie] ${attempt > 0 ? `Retry ${attempt} — ` : ''}${method} ${url.pathname}${url.search}`);

        const fetchOptions: RequestInit = {
          method,
          headers: {
            'Authorization': this.authHeader!,
            'Accept': 'application/json',
            ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
        };

        const response = await fetch(url.toString(), fetchOptions);

        if (response.status === 401 && !hasRetried401) {
          console.log(`[Dutchie] 401 Unauthorized — refreshing auth token and retrying`);
          hasRetried401 = true;
          this.authHeader = null;
          this.tokenFetchedAt = null;
          await this.ensureAuth();
          continue;
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
          const waitMs = !isNaN(parsed) ? parsed * 1000 : RETRY_DELAY_MS * (attempt + 1);
          console.log(`[Dutchie] Rate limited (429) — retrying in ${waitMs}ms`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          let body = '';
          try {
            body = await response.text();
          } catch { /* ignore body read failure */ }

          console.error(
            `[Dutchie] API error — ${response.status} ${response.statusText}\n` +
            `  URL: ${url.pathname}${url.search}\n` +
            `  Auth: ${this.authHeader?.split(' ')[0] ?? 'none'} (apiKey: ${this.config.apiKey.length} chars)\n` +
            `  Response body: ${body.slice(0, 500)}`
          );
          throw new Error(`Dutchie API error: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
        }

        const data = await response.json() as T;
        console.log(`[Dutchie] OK ${url.pathname} — ${Array.isArray(data) ? `${data.length} items` : 'object'}`);
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          console.log(`[Dutchie] Request failed, retrying in ${RETRY_DELAY_MS * (attempt + 1)}ms: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('Dutchie API request failed after retries');
  }

  // ── Enrichment caches ──────────────────────────────────────────────

  private async loadProductMap(): Promise<Map<number, ProductInfo>> {
    const now = Date.now();

    // Check instance-level cache first
    if (this.productMap && this.productMapLoadedAt && (now - this.productMapLoadedAt) < this.CACHE_TTL_MS) {
      return this.productMap;
    }

    // Check shared catalog cache (avoids redundant API calls for same key+state)
    const sc = this.config.stateCode;
    if (sc) {
      const cacheKey = catalogCacheKey(sc, this.config.apiKey);
      const cached = productCatalogCache.get(cacheKey);
      if (cached && (now - cached.loadedAt) < CATALOG_CACHE_TTL_MS) {
        console.log(`[Dutchie] Using cached product catalog for state ${sc} (${cached.products.size} products)`);
        this.productMap = cached.products;
        this.productMapLoadedAt = cached.loadedAt;
        return cached.products;
      }
    }

    console.log(`[Dutchie] Loading product catalog for enrichment${sc ? ` (state: ${sc})` : ''}...`);
    const products = await this.request<DutchieRawProduct[]>('/reporting/products');
    const map = new Map<number, ProductInfo>();

    for (const p of products) {
      // Extract brand from internalName pattern: "BrandName | ProductName"
      let brand: string | null = null;
      if (p.internalName && p.internalName.includes(' | ')) {
        brand = p.internalName.split(' | ')[0]!.trim();
      }
      map.set(p.productId, {
        name: p.productName,
        category: p.category || p.masterCategory || 'Other',
        brand,
      });
    }

    // Store in instance cache
    this.productMap = map;
    this.productMapLoadedAt = now;

    // Store in shared catalog cache (LRU eviction at MAX_CATALOG_CACHE_SIZE)
    if (sc) {
      const cacheKey = catalogCacheKey(sc, this.config.apiKey);
      if (!productCatalogCache.has(cacheKey) && productCatalogCache.size >= MAX_CATALOG_CACHE_SIZE) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        Array.from(productCatalogCache.entries()).forEach(function ([k, v]) {
          if (v.loadedAt < oldestTime) { oldestTime = v.loadedAt; oldestKey = k; }
        });
        if (oldestKey) productCatalogCache.delete(oldestKey);
      }
      productCatalogCache.set(cacheKey, { products: map, loadedAt: now });
      console.log(`[Dutchie] Product catalog cached for state ${sc} — ${map.size} products`);
    } else {
      console.log(`[Dutchie] Product catalog loaded — ${map.size} products (no stateCode, per-client only)`);
    }

    return map;
  }

  private async loadEmployeeMap(): Promise<Map<number, string>> {
    const now = Date.now();
    if (this.employeeMap && this.employeeMapLoadedAt && (now - this.employeeMapLoadedAt) < this.CACHE_TTL_MS) {
      return this.employeeMap;
    }

    console.log('[Dutchie] Loading employee list for enrichment...');
    const employees = await this.request<Array<{ userId: number; fullName: string }>>('/employees');
    const map = new Map<number, string>();
    for (const e of employees) {
      map.set(e.userId, e.fullName);
    }

    this.employeeMap = map;
    this.employeeMapLoadedAt = now;
    console.log(`[Dutchie] Employee list loaded — ${map.size} employees`);
    return map;
  }

  // ── Mapping: raw transactions → DutchieDelivery ────────────────────

  private mapTransactionToDelivery(
    tx: DutchieRawTransaction,
    productMap: Map<number, ProductInfo>,
    employeeMap: Map<number, string>,
    includeLineItems: boolean,
  ): DutchieDelivery {
    let lineItems: DutchieLineItem[] | undefined;

    if (includeLineItems && tx.items) {
      lineItems = tx.items.map((item: DutchieRawTransactionItem) => {
        const product = productMap.get(item.productId);
        return {
          ProductName: product?.name ?? `Product #${item.productId}`,
          Quantity: item.quantity,
          Price: item.unitPrice,
          TotalPrice: item.totalPrice,
          MetrcPackageLabel: item.packageId ?? item.sourcePackageId ?? null,
          Category: product?.category ?? 'Other',
          Brand: product?.brand ?? null,
          StrainName: null, // Not available in transaction data
          Weight: item.unitWeight ?? null,
          WeightUnit: item.unitWeightUnit ?? null,
          DiscountAmount: item.totalDiscount,
        };
      });
    }

    return {
      TransactionId: String(tx.transactionId),
      PreOrderId: null,
      Status: tx.isVoid ? 'Voided' : 'Completed',
      CustomerName: null, // Customer name requires separate lookup
      CustomerType: tx.transactionType,
      OrderTotal: tx.total,
      TaxAmount: tx.tax,
      DiscountAmount: tx.totalDiscount,
      SubTotal: tx.subtotal,
      PaymentMethod: null, // Not in /reporting/transactions response
      EmployeeName: employeeMap.get(tx.employeeId) ?? null,
      CompletedDate: tx.isVoid ? null : tx.transactionDate,
      CreatedDate: tx.transactionDate,
      LineItems: lineItems,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Fetch a single chunk of transactions within the API's 1440-hour window limit.
   */
  private async fetchTransactionChunk(
    from: string,
    to: string,
    includeDetail: boolean,
    includeTaxes: boolean,
  ): Promise<DutchieRawTransaction[]> {
    return this.request<DutchieRawTransaction[]>('/reporting/transactions', {
      FromDateUTC: from,
      ToDateUTC: to,
      IncludeDetail: includeDetail || undefined,
      IncludeTaxes: includeTaxes || undefined,
    });
  }

  async getTransactions(params?: {
    fromDateUTC?: string;
    toDateUTC?: string;
    fromLastModifiedDateUTC?: string;
    toLastModifiedDateUTC?: string;
    transactionId?: number;
    includeDetail?: boolean;
    includeTaxes?: boolean;
  }): Promise<DutchieRawTransaction[]> {
    // Single transaction lookup — no chunking needed
    if (params?.transactionId) {
      return this.request<DutchieRawTransaction[]>('/reporting/transactions', {
        TransactionId: params.transactionId,
        IncludeDetail: params.includeDetail !== false || undefined,
        IncludeTaxes: params.includeTaxes || undefined,
      });
    }

    // Modified-date queries — pass through directly (caller manages window)
    if (params?.fromLastModifiedDateUTC) {
      return this.request<DutchieRawTransaction[]>('/reporting/transactions', {
        FromLastModifiedDateUTC: params.fromLastModifiedDateUTC,
        ToLastModifiedDateUTC: params.toLastModifiedDateUTC,
        IncludeDetail: params.includeDetail !== false || undefined,
        IncludeTaxes: params.includeTaxes || undefined,
      });
    }

    // Date range — auto-chunk if range exceeds 1440 hours (60 days)
    const from = params?.fromDateUTC
      ? new Date(params.fromDateUTC)
      : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000);
    const to = params?.toDateUTC ? new Date(params.toDateUTC) : new Date();
    const includeDetail = params?.includeDetail !== false;
    const includeTaxes = params?.includeTaxes ?? false;

    const rangeHours = (to.getTime() - from.getTime()) / (1000 * 60 * 60);

    // Small enough for a single request
    if (rangeHours <= MAX_WINDOW_HOURS) {
      return this.fetchTransactionChunk(from.toISOString(), to.toISOString(), includeDetail, includeTaxes);
    }

    // Split into CHUNK_DAYS-sized windows
    console.log(`[Dutchie] Date range is ${Math.round(rangeHours)}h (>${MAX_WINDOW_HOURS}h limit) — chunking into ${CHUNK_DAYS}-day windows`);
    const allTransactions: DutchieRawTransaction[] = [];
    let chunkStart = from;

    while (chunkStart < to) {
      const chunkEnd = new Date(Math.min(
        chunkStart.getTime() + CHUNK_DAYS * 86400000,
        to.getTime(),
      ));

      const chunk = await this.fetchTransactionChunk(
        chunkStart.toISOString(),
        chunkEnd.toISOString(),
        includeDetail,
        includeTaxes,
      );
      allTransactions.push(...chunk);
      chunkStart = chunkEnd;
    }

    console.log(`[Dutchie] Chunked fetch complete — ${allTransactions.length} total transactions`);
    return allTransactions;
  }

  async getDeliveries(params?: {
    includeLineItems?: boolean;
    deliveryStatus?: string;
    pageNumber?: number;
    pageSize?: number;
    fromDateUTC?: string;
    toDateUTC?: string;
  }): Promise<DutchieDelivery[]> {
    const includeLineItems = params?.includeLineItems !== false;

    // Fetch raw transactions + enrichment data in parallel
    const [rawTransactions, productMap, employeeMap] = await Promise.all([
      this.getTransactions({
        fromDateUTC: params?.fromDateUTC,
        toDateUTC: params?.toDateUTC,
        includeDetail: includeLineItems,
      }),
      includeLineItems ? this.loadProductMap() : Promise.resolve(new Map<number, ProductInfo>()),
      this.loadEmployeeMap(),
    ]);

    // Map to DutchieDelivery shape
    let deliveries = rawTransactions.map(tx =>
      this.mapTransactionToDelivery(tx, productMap, employeeMap, includeLineItems)
    );

    // Apply status filter (maps to isVoid on the raw transaction)
    if (params?.deliveryStatus) {
      deliveries = deliveries.filter(d => d.Status === params.deliveryStatus);
    }

    // Client-side pagination (reporting API returns all results in date range)
    if (params?.pageNumber !== undefined || params?.pageSize !== undefined) {
      const size = params?.pageSize ?? 50;
      const page = params?.pageNumber ?? 0;
      const start = page * size;
      deliveries = deliveries.slice(start, start + size);
    }

    return deliveries;
  }

  async getDeliveryByTransaction(transactionId: string): Promise<DutchieDelivery | null> {
    try {
      const txId = parseInt(transactionId, 10);
      if (isNaN(txId)) return null;

      const [rawTransactions, productMap, employeeMap] = await Promise.all([
        this.getTransactions({ transactionId: txId, includeDetail: true }),
        this.loadProductMap(),
        this.loadEmployeeMap(),
      ]);

      const tx = rawTransactions[0];
      if (!tx) return null;

      return this.mapTransactionToDelivery(tx, productMap, employeeMap, true);
    } catch {
      return null;
    }
  }

  async getReportingProducts(params?: {
    fromLastModifiedDateUTC?: string;
  }): Promise<DutchieRawProduct[]> {
    return this.request<DutchieRawProduct[]>('/reporting/products', {
      fromLastModifiedDateUTC: params?.fromLastModifiedDateUTC,
    });
  }

  async getReportingInventory(params?: {
    includeLabResults?: boolean;
    includeRoomQuantities?: boolean;
    includeLineage?: boolean;
  }): Promise<DutchieInventoryItem[]> {
    return this.request<DutchieInventoryItem[]>('/reporting/inventory', {
      includeLabResults: params?.includeLabResults,
      includeRoomQuantities: params?.includeRoomQuantities,
      includeLineage: params?.includeLineage,
    });
  }

  async getCustomers(params?: {
    fromLastModifiedDateUTC?: string;
    pageNumber?: number;
    pageSize?: number;
  }): Promise<DutchieCustomer[]> {
    return this.request<DutchieCustomer[]>('/customer/customers-paginated', {
      fromLastModifiedDateUTC: params?.fromLastModifiedDateUTC,
      PageNumber: params?.pageNumber,
      PageSize: params?.pageSize,
    });
  }

  async getCustomerTypes(): Promise<DutchieCustomerType[]> {
    return this.request<DutchieCustomerType[]>('/customer/customer-types');
  }

  async searchCustomers(query: string): Promise<DutchieCustomer[]> {
    return this.request<DutchieCustomer[]>(
      '/customer/search',
      undefined,
      { method: 'POST', body: { SearchTerm: query } },
    );
  }

  async getDiscounts(): Promise<DutchieDiscount[]> {
    return this.request<DutchieDiscount[]>('/discounts/v2/list');
  }

  async getBrands(): Promise<DutchieBrand[]> {
    return this.request<DutchieBrand[]>('/brand');
  }

  async getHarvests(params?: {
    fromLastModifiedDateUTC?: string;
    activeHarvests?: boolean;
  }): Promise<DutchieHarvest[]> {
    if (!this.hasScope('cultivation')) return [];
    return this.request<DutchieHarvest[]>('/harvest', {
      fromLastModifiedDateUTC: params?.fromLastModifiedDateUTC,
      activeHarvests: params?.activeHarvests,
    });
  }

  async getEmployees(): Promise<DutchieEmployee[]> {
    return this.request<DutchieEmployee[]>('/employees');
  }

  async whoami(): Promise<DutchieWhoAmI> {
    return this.request<DutchieWhoAmI>('/whoami');
  }

  // ── Product Management (write operations) ──────────────────

  async getProducts(params?: {
    categoryId?: number;
    brandId?: number;
    isActive?: boolean;
  }): Promise<DutchieProductDetail[]> {
    return this.request<DutchieProductDetail[]>('/products/products', {
      categoryId: params?.categoryId,
      brandId: params?.brandId,
      isActive: params?.isActive,
    });
  }

  async updateProducts(products: Partial<DutchieProductDetail>[]): Promise<DutchieBulkUpdateResult> {
    const succeeded: string[] = [];
    const failed: { productId: string; error: string }[] = [];

    for (const product of products) {
      if (!product.productId) {
        failed.push({ productId: 'unknown', error: 'Missing productId' });
        continue;
      }
      try {
        await this.request<unknown>('/products/products', undefined, {
          method: 'POST',
          body: product as Record<string, unknown>,
        });
        succeeded.push(String(product.productId));
      } catch (err) {
        failed.push({
          productId: String(product.productId),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  async updateLocationOverrides(overrides: DutchieLocationOverride[]): Promise<DutchieBulkUpdateResult> {
    const succeeded: string[] = [];
    const failed: { productId: string; error: string }[] = [];

    for (const override of overrides) {
      try {
        await this.request<unknown>('/products/location-overrides', undefined, {
          method: 'POST',
          body: override as unknown as Record<string, unknown>,
        });
        succeeded.push(String(override.productId));
      } catch (err) {
        failed.push({
          productId: String(override.productId),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }
}
