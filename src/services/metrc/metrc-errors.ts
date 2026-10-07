/**
 * Shared Metrc API error handling utilities.
 * Used by tRPC routers to gracefully degrade when individual API calls fail
 * (e.g., read-only keys that lack permission for certain endpoints).
 */

/**
 * Returns a .catch() handler that logs the error and returns an empty array.
 * Use with typed promises: `client.getActivePackages().catch(logMetrcErr('ctx', 'endpoint'))`
 * The return type matches the original promise's array element type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function logMetrcErr(context: string, endpoint: string): (err: unknown) => any[] {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[${context}] ${endpoint} failed: ${msg}`);
    return [];
  };
}

export class MetrcPermissionError extends Error {
  constructor(endpoint: string) {
    super(`Metrc API key lacks permission for: ${endpoint}`);
    this.name = 'MetrcPermissionError';
  }
}
