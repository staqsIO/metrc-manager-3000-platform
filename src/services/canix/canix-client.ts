import type {
  ICanixClient,
  CanixFilters,
  CanixPaginatedResponse,
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

const CANIX_BASE_URL = 'https://api.canix.com/api/v1';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const DEFAULT_PAGE_SIZE = 100;

interface CanixClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export class CanixClient implements ICanixClient {
  private config: CanixClientConfig;

  constructor(config: CanixClientConfig) {
    this.config = config;
    console.log(
      `[Canix] Client initialized — apiKey length: ${config.apiKey.length}` +
      (config.baseUrl ? `, baseUrl: ${config.baseUrl}` : ''),
    );
  }

  // ── HTTP layer ───────────────────────────────────────────────

  private async request<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const baseUrl = this.config.baseUrl ?? CANIX_BASE_URL;
    const url = new URL(path, baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Canix] ${attempt > 0 ? `Retry ${attempt} — ` : ''}GET ${url.pathname}${url.search}`);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'X-API-KEY': this.config.apiKey,
            'Accept': 'application/json',
          },
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
          const waitMs = !isNaN(parsed) ? parsed * 1000 : RETRY_DELAY_MS * (attempt + 1);
          console.log(`[Canix] Rate limited (429) — retrying in ${waitMs}ms`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        if (!response.ok) {
          let body = '';
          try {
            body = await response.text();
          } catch { /* ignore body read failure */ }

          console.error(
            `[Canix] API error — ${response.status} ${response.statusText}\n` +
            `  URL: ${url.pathname}${url.search}\n` +
            `  Response body: ${body.slice(0, 500)}`
          );
          throw new Error(`Canix API error: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
        }

        const data = await response.json() as T;
        const logMsg = Array.isArray(data)
          ? `${data.length} items`
          : typeof data === 'object' && data !== null && 'data' in (data as Record<string, unknown>)
            ? `${((data as unknown as CanixPaginatedResponse<unknown>).data).length} items (${(data as unknown as CanixPaginatedResponse<unknown>).total} total)`
            : 'object';
        console.log(`[Canix] OK ${url.pathname} — ${logMsg}`);
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Fail fast on 4xx client errors — only retry on 5xx and network errors
        if (/\b(401|403|404|422)\b/.test(lastError.message)) {
          throw lastError;
        }
        if (attempt < MAX_RETRIES) {
          console.log(`[Canix] Request failed, retrying in ${RETRY_DELAY_MS * (attempt + 1)}ms: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('Canix API request failed after retries');
  }

  /**
   * Auto-paginate through all results using limit/offset.
   * Canix returns { data, total, limit, offset }.
   */
  private async fetchAll<T>(
    path: string,
    filters?: CanixFilters,
  ): Promise<T[]> {
    const limit = filters?.limit ?? DEFAULT_PAGE_SIZE;
    let offset = filters?.offset ?? 0;
    const allResults: T[] = [];

    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      offset,
    };
    if (filters?.orderBy) params.orderBy = filters.orderBy;
    if (filters?.where) params.where = JSON.stringify(filters.where);

    // First request
    const first = await this.request<CanixPaginatedResponse<T>>(path, params);
    allResults.push(...first.data);

    // If caller specified a limit, respect it (no auto-pagination)
    if (filters?.limit) return allResults;

    // Auto-paginate remaining pages
    const total = first.total;
    offset += limit;
    while (offset < total) {
      const page = await this.request<CanixPaginatedResponse<T>>(path, {
        ...params,
        offset,
      });
      allResults.push(...page.data);
      offset += limit;
    }

    return allResults;
  }

  // ── Phase 0: Costs + BOMs ──────────────────────────────────

  async getStandardCosts(itemId?: string): Promise<CanixStandardCost[]> {
    if (itemId) {
      return this.fetchAll<CanixStandardCost>('/standard_costs', {
        where: { itemId },
      });
    }
    return this.fetchAll<CanixStandardCost>('/standard_costs');
  }

  async getBillsOfMaterials(filters?: CanixFilters): Promise<CanixBOM[]> {
    return this.fetchAll<CanixBOM>('/bills_of_materials', filters);
  }

  async getBillOfMaterials(id: string): Promise<CanixBOM | null> {
    try {
      return await this.request<CanixBOM>(`/bills_of_materials/${id}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async getNonCannabisProducts(filters?: CanixFilters): Promise<CanixNonCannabisProduct[]> {
    return this.fetchAll<CanixNonCannabisProduct>('/non_cannabis_products', filters);
  }

  async getItems(filters?: CanixFilters): Promise<CanixItem[]> {
    return this.fetchAll<CanixItem>('/items', filters);
  }

  // ── Phase 1: Orders ────────────────────────────────────────

  async getSalesOrders(filters?: CanixFilters): Promise<CanixSalesOrder[]> {
    return this.fetchAll<CanixSalesOrder>('/sales_orders', filters);
  }

  async getSalesOrder(id: string): Promise<CanixSalesOrder | null> {
    try {
      return await this.request<CanixSalesOrder>(`/sales_orders/${id}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async getSalesOrderContents(id: string): Promise<CanixLineItem[]> {
    return this.fetchAll<CanixLineItem>(`/sales_orders/${id}/contents`);
  }

  async getPurchaseOrders(filters?: CanixFilters): Promise<CanixPurchaseOrder[]> {
    return this.fetchAll<CanixPurchaseOrder>('/purchase_orders', filters);
  }

  async getPurchaseOrder(id: string): Promise<CanixPurchaseOrder | null> {
    try {
      return await this.request<CanixPurchaseOrder>(`/purchase_orders/${id}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async getPurchaseOrderContents(id: string): Promise<CanixLineItem[]> {
    return this.fetchAll<CanixLineItem>(`/purchase_orders/${id}/contents`);
  }

  async getPurchaseOrderPayments(id: string): Promise<CanixPurchaseOrderPayment[]> {
    return this.fetchAll<CanixPurchaseOrderPayment>(`/purchase_orders/${id}/payments`);
  }

  async getVendors(filters?: CanixFilters): Promise<CanixVendor[]> {
    return this.fetchAll<CanixVendor>('/vendors', filters);
  }

  async getCustomers(filters?: CanixFilters): Promise<CanixCustomer[]> {
    return this.fetchAll<CanixCustomer>('/customers', filters);
  }

  // ── Phase 2: Audit ─────────────────────────────────────────

  async getAuditedActions(filters?: CanixFilters): Promise<CanixAuditedAction[]> {
    return this.fetchAll<CanixAuditedAction>('/audited_actions', filters);
  }

  // ── Auth ───────────────────────────────────────────────────

  async whoami(): Promise<CanixWhoAmI> {
    return this.request<CanixWhoAmI>('/whoami');
  }
}
