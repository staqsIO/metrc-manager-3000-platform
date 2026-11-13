import type { IMetrcClient } from '@metrc-manager-3000/client';
import type { PrismaClient } from '@prisma/client';

/**
 * Wraps an `IMetrcClient` in a JS Proxy that records one `MetrcApiCall` row per
 * method invocation. The wrapper sits BELOW `MetrcCachedClient` in the factory,
 * so cache hits never reach this proxy and produce no rows.
 *
 * Row writes are fire-and-forget — the wrapped method resolves (or rejects) on
 * the inner client's timing, regardless of whether the row insert has completed.
 * This is intentional: observability must never block the response path.
 *
 * Header capture limitation: `@metrc-manager-3000/client` throws `MetrcApiError` instances
 * that carry a `statusCode` field, but does NOT surface response headers on
 * successful calls. Therefore `remainingQuota` and `requestId` are always null
 * today. If the SDK gains a header-callback API in the future, capture them here.
 *
 * Mock-environment clients are not wrapped (mock data is purely in-memory test
 * data; rows would pollute analytics with non-network calls). The factory
 * decides; this file makes no assumption.
 */
export function createInstrumentedClient(
  inner: IMetrcClient,
  facilityId: string,
  prisma: PrismaClient,
): IMetrcClient {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function' || typeof prop !== 'string') {
        return orig;
      }
      // Skip plumbing: 'constructor' and any underscore-prefixed private helper.
      if (prop === 'constructor' || prop.startsWith('_')) {
        return (orig as (...a: unknown[]) => unknown).bind(target);
      }
      const endpoint = prop;
      return async function instrumentedMethod(this: unknown, ...args: unknown[]) {
        const start = Date.now();
        let statusCode: number | null = null;
        let errorMsg: string | null = null;
        try {
          const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          statusCode = 200;
          return result;
        } catch (err) {
          if (
            err &&
            typeof err === 'object' &&
            'statusCode' in err &&
            typeof (err as { statusCode: unknown }).statusCode === 'number'
          ) {
            statusCode = (err as { statusCode: number }).statusCode;
          }
          errorMsg = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          const durationMs = Date.now() - start;
          // Fire-and-forget: never await this. If the row write fails, log and
          // swallow — observability must not break production paths.
          void prisma.metrcApiCall
            .create({
              data: {
                facilityId,
                endpoint,
                statusCode,
                durationMs,
                error: errorMsg,
              },
            })
            .catch((e: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[observability] failed to write MetrcApiCall row', e);
            });
        }
      };
    },
  });
}
