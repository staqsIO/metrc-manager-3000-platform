/**
 * Patches a MetrcClient instance to rewrite /v1/ → /v2/ endpoints at runtime.
 *
 * Massachusetts (and other states migrating off v1) returns 401 on /v1/ endpoints.
 * This patches the private `get`, `post`, and `put` methods to rewrite paths and
 * unwrap the v2 paginated response format ({ Data: [...] }) back to a flat array.
 *
 * v2 pagination behavior (confirmed by Metrc support, April 2026):
 * - BOTH lastModifiedStart AND lastModifiedEnd are REQUIRED to get full results.
 *   Without them, the API returns only a default subset (~150 of 339 packages).
 *   Sending only lastModifiedStart returns 0 results (silent failure).
 * - pageSize max is 20 per Metrc docs; exceeding this causes a 400 error.
 * - Use credential date as start, future date as end (per Metrc guidance).
 * - Format: YYYY-MM-DD (date only, no time component needed).
 *
 * Performance: after fetching page 1 (which reveals Total/TotalPages), remaining
 * pages are fetched in parallel batches of V2_CONCURRENCY. For 339 packages (17
 * pages), this reduces fetch time from ~25s (sequential) to ~5s (3 parallel batches).
 *
 * TypeScript `private` is compile-time only — runtime JS has no access restriction.
 */
import type { IMetrcClient } from '@metrc-formul8-os/client';

function rewriteV1(endpoint: string): string {
  return endpoint.replace('/v1/', '/v2/');
}

/** Metrc v2 max page size per docs: "does not exceed 20" */
const V2_PAGE_SIZE = 20;

/** Safety limit to prevent infinite pagination loops. */
const MAX_PAGES = 500;

/** Max concurrent page requests. Matches API_CONCURRENCY used elsewhere. */
const V2_CONCURRENCY = 5;

/**
 * Far-past start date for lastModifiedStart. Per Metrc support, use the
 * credential date as the start. 2020-01-01 is safely before any MA credential.
 */
const DEFAULT_LAST_MODIFIED_START = '2020-01-01';

type AnyClient = IMetrcClient & Record<string, unknown>;
type GetFn = (endpoint: string, params?: Record<string, string>) => Promise<unknown>;

/**
 * Inject lastModifiedStart and lastModifiedEnd into params if not already present.
 * Both are REQUIRED for v2 GET endpoints to return complete data.
 *
 * IMPORTANT: lastModifiedEnd is computed fresh per call (new Date() inside function body).
 * Do NOT hoist this to module scope — it would become stale after midnight.
 */
function ensureLastModifiedParams(params: Record<string, string>): Record<string, string> {
  const result = { ...params };

  if (!result.lastModifiedStart) {
    result.lastModifiedStart = DEFAULT_LAST_MODIFIED_START;
  }

  if (!result.lastModifiedEnd) {
    // Tomorrow's date to ensure we capture everything through today
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    result.lastModifiedEnd = tomorrow.toISOString().split('T')[0]!;
  }

  return result;
}

/**
 * Unwrap a single v2 response object to its Data array.
 * Returns null if the response is not a v2 paginated object.
 */
function unwrapV2Page(result: unknown): { data: unknown[]; total: number; totalPages: number } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const obj = result as Record<string, unknown>;
  if (!('Data' in obj)) return null;
  const data = Array.isArray(obj.Data) ? obj.Data : [];
  const total = typeof obj.Total === 'number' ? obj.Total : data.length;
  const totalPages = typeof obj.TotalPages === 'number' ? obj.TotalPages : 0;
  return { data, total, totalPages };
}

/**
 * Fetch a batch of pages in parallel, returning results in page order.
 */
async function fetchPageBatch(
  getFn: GetFn,
  endpoint: string,
  baseParams: Record<string, string>,
  pageNumbers: number[],
): Promise<unknown[][]> {
  const results = await Promise.all(
    pageNumbers.map(async (page) => {
      const params = { ...baseParams, pageSize: String(V2_PAGE_SIZE), pageNumber: String(page) };
      const result = await getFn(endpoint, params);
      const parsed = unwrapV2Page(result);
      return parsed ? parsed.data : [];
    }),
  );
  return results;
}

/**
 * Fetch all data from a v2 endpoint using parallel page fetching
 * with required lastModifiedStart/lastModifiedEnd params.
 *
 * Strategy:
 * 1. Fetch page 1 to detect v2 format and get Total/TotalPages
 * 2. If TotalPages > 1, fetch remaining pages in parallel batches of V2_CONCURRENCY
 * 3. Fall back to short-page sequential fetch if Total/TotalPages is unreliable
 * 4. Concatenate all results in page order
 */
async function fetchAllPages(
  getFn: GetFn,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  // Inject lastModifiedStart/End if not already present
  const enrichedParams = ensureLastModifiedParams(params);

  // Page 1: detect v2 format and get metadata
  const firstPageParams = { ...enrichedParams, pageSize: String(V2_PAGE_SIZE), pageNumber: '1' };
  const firstResult = await getFn(endpoint, firstPageParams);

  // Not a v2 paginated response — return as-is (handles plain arrays, single objects)
  const firstPage = unwrapV2Page(firstResult);
  if (!firstPage) {
    return firstResult;
  }

  const allData: unknown[] = [...firstPage.data];

  // Short first page means we already have everything
  if (firstPage.data.length < V2_PAGE_SIZE) {
    return allData;
  }

  // Determine how many more pages to fetch
  const knownTotalPages = firstPage.totalPages;

  if (knownTotalPages > 1) {
    // Fast path: we know the total page count — fetch all remaining in parallel batches
    const remainingPages: number[] = [];
    for (let p = 2; p <= Math.min(knownTotalPages, MAX_PAGES); p++) {
      remainingPages.push(p);
    }

    // Fetch in batches of V2_CONCURRENCY
    for (let i = 0; i < remainingPages.length; i += V2_CONCURRENCY) {
      const batch = remainingPages.slice(i, i + V2_CONCURRENCY);
      const batchResults = await fetchPageBatch(getFn, endpoint, enrichedParams, batch);
      for (const pageData of batchResults) {
        allData.push(...pageData);
      }
    }
  } else {
    // Fallback: TotalPages not available — sequential short-page detection
    for (let page = 2; page <= MAX_PAGES; page++) {
      const pageParams = { ...enrichedParams, pageSize: String(V2_PAGE_SIZE), pageNumber: String(page) };
      const pageResult = await getFn(endpoint, pageParams);

      const parsed = unwrapV2Page(pageResult);
      if (!parsed) break;

      allData.push(...parsed.data);

      if (parsed.data.length < V2_PAGE_SIZE) break;
    }
  }

  return allData;
}

/**
 * Patch a MetrcClient to use v2 endpoints. Mutates the client in-place.
 * GET responses are auto-paginated and unwrapped from v2 format.
 * POST/PUT pass through unchanged.
 */
export function patchClientForV2(client: IMetrcClient): IMetrcClient {
  const c = client as AnyClient;
  type Fn = (...args: unknown[]) => Promise<unknown>;
  const originalGet = (c.get as Fn).bind(c);
  const originalPost = (c.post as Fn).bind(c);
  const originalPut = (c.put as Fn).bind(c);

  c.get = async (endpoint: string, params?: Record<string, string>) => {
    const rewritten = rewriteV1(endpoint);

    // /sales/v2/receipts doesn't exist — v2 splits into /active and /inactive.
    // Active: fetch all pages (recent, typically small).
    // Inactive: fetch ONLY page 1 (20 items) — full pagination can be 500+ API
    // calls for facilities with years of history, which burned the MA rate limit.
    if (rewritten === '/sales/v2/receipts') {
      const inactiveParams = ensureLastModifiedParams({ ...(params ?? {}), pageSize: String(V2_PAGE_SIZE), pageNumber: '1' });
      const [active, inactiveRaw] = await Promise.all([
        fetchAllPages(originalGet, '/sales/v2/receipts/active', params),
        originalGet('/sales/v2/receipts/inactive', inactiveParams),
      ]);
      const a = Array.isArray(active) ? active : [];
      const inactiveParsed = unwrapV2Page(inactiveRaw);
      const b = inactiveParsed ? inactiveParsed.data : [];
      // Tag each receipt with its source so the sales router can filter by status
      for (const r of a) (r as Record<string, unknown>)._saleStatus = 'active';
      for (const r of b) (r as Record<string, unknown>)._saleStatus = 'inactive';
      return [...a, ...b];
    }

    // Sub-resource endpoints (e.g., /transfers/v2/123/deliveries,
    // /transfers/v2/deliveries/456/packages) don't support lastModifiedStart/End
    // or pagination. Detect by numeric ID in path, call originalGet directly
    // (no fetchAllPages wrapping), and unwrap v2 response if needed.
    if (/\/v2\/\d+\//.test(rewritten) || /\/v2\/deliveries\/\d+\//.test(rewritten)) {
      const result = await originalGet(rewritten, params);
      const parsed = unwrapV2Page(result);
      return parsed ? parsed.data : result;
    }

    return fetchAllPages(originalGet, rewritten, params);
  };

  c.post = async (endpoint: string, data?: unknown, params?: Record<string, string>) => {
    return originalPost(rewriteV1(endpoint), data, params);
  };

  c.put = async (endpoint: string, data?: unknown, params?: Record<string, string>) => {
    return originalPut(rewriteV1(endpoint), data, params);
  };

  // Patch delete if it exists on the client (added in @metrc-formul8-os/client v0.5.0)
  if (typeof c.delete === 'function') {
    const originalDelete = (c.delete as Fn).bind(c);
    c.delete = async (endpoint: string, params?: Record<string, string>) => {
      return originalDelete(rewriteV1(endpoint), params);
    };
  }

  return client;
}
