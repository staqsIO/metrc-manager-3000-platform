/**
 * Unit tests for `createInstrumentedClient`.
 *
 * The "user" of this wrapper is the metrc factory — its contract is "any IMetrcClient
 * method call writes one MetrcApiCall row capturing endpoint name, durationMs, and
 * (on error) statusCode + error message, while propagating the original return value
 * or thrown error unchanged." All tests describe that observable contract.
 *
 * Tests intentionally use a fake `prisma.metrcApiCall.create` (vi.fn) rather than a
 * real DB. Counting prisma.create calls is the cheapest way to assert the per-call
 * write semantics — there is no slower, more user-realistic alternative.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInstrumentedClient } from '../instrumented-client';

type CreateFn = (args: { data: Record<string, unknown> }) => Promise<unknown>;

interface FakePrisma {
  metrcApiCall: {
    create: ReturnType<typeof vi.fn> & CreateFn;
  };
}

function makePrisma(createImpl?: CreateFn): FakePrisma {
  const create = vi.fn(createImpl ?? (async () => ({ id: 'row-1' })));
  return { metrcApiCall: { create } } as unknown as FakePrisma;
}

const FACILITY_ID = 'fac-instrumented-1';

describe('createInstrumentedClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes one row with statusCode=200, non-null durationMs, error=null on success', async () => {
    const inner = {
      getActivePackages: vi.fn().mockResolvedValue([{ Id: 1 }, { Id: 2 }]),
    };
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (wrapped as any).getActivePackages();

    expect(result).toEqual([{ Id: 1 }, { Id: 2 }]);
    expect(inner.getActivePackages).toHaveBeenCalledTimes(1);

    // Row write is fire-and-forget — let the microtask queue drain.
    await Promise.resolve();
    await Promise.resolve();

    expect(prisma.metrcApiCall.create).toHaveBeenCalledTimes(1);
    const writtenRow = prisma.metrcApiCall.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(writtenRow.data.facilityId).toBe(FACILITY_ID);
    expect(writtenRow.data.endpoint).toBe('getActivePackages');
    expect(writtenRow.data.statusCode).toBe(200);
    expect(writtenRow.data.error).toBe(null);
    expect(typeof writtenRow.data.durationMs).toBe('number');
    expect((writtenRow.data.durationMs as number) >= 0).toBe(true);
  });

  it('writes one row with statusCode + error message on a thrown error and re-throws unchanged', async () => {
    class MetrcApiError extends Error {
      readonly statusCode: number;
      constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
      }
    }
    const thrown = new MetrcApiError(401, 'unauthorized');
    const inner = {
      getActivePackages: vi.fn().mockRejectedValue(thrown),
    };
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (wrapped as any).getActivePackages();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(thrown); // identity-preserved re-throw

    await Promise.resolve();
    await Promise.resolve();

    expect(prisma.metrcApiCall.create).toHaveBeenCalledTimes(1);
    const writtenRow = prisma.metrcApiCall.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(writtenRow.data.endpoint).toBe('getActivePackages');
    expect(writtenRow.data.statusCode).toBe(401);
    expect(writtenRow.data.error).toBe('unauthorized');
  });

  it('non-function properties on the inner client pass through unchanged', () => {
    const inner = {
      licenseNumber: 'LIC-XYZ',
      stateCode: 'MA',
      getActivePackages: () => Promise.resolve([]),
    };
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wrapped as any).licenseNumber).toBe('LIC-XYZ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wrapped as any).stateCode).toBe('MA');
  });

  it('does not instrument methods whose name starts with underscore', async () => {
    const inner = {
      _internalHelper: vi.fn().mockResolvedValue('private'),
      getActivePackages: vi.fn().mockResolvedValue([]),
    };
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (wrapped as any)._internalHelper();
    expect(result).toBe('private');

    await Promise.resolve();
    await Promise.resolve();

    // Only the public method would have been instrumented if we had called it.
    // _internalHelper must not produce an observability row.
    expect(prisma.metrcApiCall.create).not.toHaveBeenCalled();
  });

  it('does not block the caller on the row write — wrapped method resolves before the create promise', async () => {
    const inner = {
      getActivePackages: vi.fn().mockResolvedValue('ok'),
    };
    // create returns a promise that NEVER resolves. If the wrapper blocked on it,
    // the wrapped call would also never resolve.
    const neverResolves = new Promise(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma = makePrisma((async () => neverResolves) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    // Race the call against a tight timeout. If the wrapper awaited the create,
    // this would hit the timeout instead of resolving.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callPromise = (wrapped as any).getActivePackages();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('blocked')), 100));
    const result = await Promise.race([callPromise, timeout]);
    expect(result).toBe('ok');
  });

  it('does not surface row-write failures to the caller', async () => {
    const inner = {
      getActivePackages: vi.fn().mockResolvedValue('ok'),
    };
    const prisma = makePrisma(async () => {
      throw new Error('db down');
    });
    // Silence the wrapper's console.error during the test.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (wrapped as any).getActivePackages();
    expect(result).toBe('ok');

    // Let the rejection's catch handler run.
    await new Promise((r) => setTimeout(r, 10));
    // The wrapper logs the failure but never throws it.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // Composition documentation — the wrapper sits BELOW MetrcCachedClient in the
  // factory, so cache hits never call into it. This test asserts the property at
  // its source: the wrapper only fires on inner-method invocations. If a caller
  // never invokes the inner method (a cache hit), no row is written.
  it('writes zero rows when the wrapped method is never invoked (cache-hit equivalent)', async () => {
    const inner = {
      getActivePackages: vi.fn().mockResolvedValue([]),
    };
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createInstrumentedClient(inner as any, FACILITY_ID, prisma as any);

    await Promise.resolve();
    expect(prisma.metrcApiCall.create).not.toHaveBeenCalled();
  });
});
