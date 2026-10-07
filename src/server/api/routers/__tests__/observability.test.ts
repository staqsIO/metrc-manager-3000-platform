// User action mirrored: a platform admin opens the API observability panel.
// They expect per-endpoint aggregate stats (count, latency, error rate) for
// the facility they are viewing, scoped to a recent time window. Non-admins
// must NOT see these stats.
//
// Tests exercise the tRPC procedure end-to-end with a mock Prisma backing
// `metrcApiCall.findMany`. We assert (a) admin-gating, (b) per-facility
// isolation (rows from another facility do not bleed in), (c) aggregate
// shape (count, avgDurationMs, p95DurationMs, errorRate per endpoint).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/lib/prisma BEFORE importing the router.
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    metrcApiCall: {
      findMany: vi.fn(),
    },
  };
  const mockDashboardPrisma = {};
  return { prisma: mockPrisma, dashboardPrisma: mockDashboardPrisma };
});

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

import { prisma } from '@/lib/prisma';
import { observabilityRouter } from '@/server/api/routers/observability';
import { createCallerFactory } from '@/lib/trpc';

const FACILITY_A = 'fac-obs-1';
const FACILITY_B = 'fac-obs-2';

const ADMIN_SESSION = {
  user: {
    id: 'admin-1',
    email: 'admin@example.com',
    isPlatformAdmin: true,
    facilityAccess: {},
  },
};

const NON_ADMIN_SESSION = {
  user: {
    id: 'user-1',
    email: 'op@example.com',
    isPlatformAdmin: false,
    facilityAccess: {},
  },
};

function makeRow(overrides: Partial<{
  facilityId: string;
  endpoint: string;
  statusCode: number | null;
  durationMs: number;
  ts: Date;
  error: string | null;
  remainingQuota: number | null;
}> = {}) {
  return {
    id: 'row-' + Math.random().toString(36).slice(2),
    facilityId: overrides.facilityId ?? FACILITY_A,
    endpoint: overrides.endpoint ?? 'getActivePackages',
    statusCode: overrides.statusCode ?? 200,
    durationMs: overrides.durationMs ?? 100,
    ts: overrides.ts ?? new Date('2026-05-01T12:00:00Z'),
    remainingQuota: overrides.remainingQuota ?? null,
    requestId: null,
    error: overrides.error ?? null,
  };
}

describe('observability.getApiCallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-admin callers with FORBIDDEN', async () => {
    const createCaller = createCallerFactory(observabilityRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: NON_ADMIN_SESSION,
      activeOrgId: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((caller as any).getApiCallStats({ facilityId: FACILITY_A, days: 7 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns per-endpoint aggregated stats for admin caller', async () => {
    // Seed 4 rows for facility A. Sorted durations for getActivePackages: [100, 200, 300].
    // Aggregation contract: avg = mean = 200; errorRate = 1/3 (one 500 status);
    // p95 nearest-rank = sorted[ceil(0.95*3)-1] = sorted[2] = 300.
    // The most recent successful row carries remainingQuota=4500 — that should
    // surface as lastRemainingQuota for the endpoint.
    const rows = [
      makeRow({
        endpoint: 'getActivePackages',
        durationMs: 100,
        statusCode: 200,
        ts: new Date('2026-05-01T10:00:00Z'),
        remainingQuota: 4800,
      }),
      makeRow({
        endpoint: 'getActivePackages',
        durationMs: 300,
        statusCode: 200,
        ts: new Date('2026-05-01T11:00:00Z'),
        remainingQuota: 4500,
      }),
      makeRow({
        endpoint: 'getActivePackages',
        durationMs: 200,
        statusCode: 500,
        error: 'boom',
        ts: new Date('2026-05-01T09:00:00Z'),
      }),
      makeRow({
        endpoint: 'getPackage',
        durationMs: 50,
        statusCode: 200,
      }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).metrcApiCall.findMany.mockResolvedValue(rows);

    const createCaller = createCallerFactory(observabilityRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: ADMIN_SESSION,
      activeOrgId: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (caller as any).getApiCallStats({ facilityId: FACILITY_A, days: 7 });
    expect(Array.isArray(result)).toBe(true);

    const byEndpoint = new Map(result.map((r: { endpoint: string }) => [r.endpoint, r]));
    const pkg = byEndpoint.get('getActivePackages') as {
      count: number;
      avgDurationMs: number;
      p95DurationMs: number;
      errorRate: number;
      lastRemainingQuota: number | null;
    };
    expect(pkg).toBeDefined();
    expect(pkg.count).toBe(3);
    // avg(100,200,300) = 200
    expect(pkg.avgDurationMs).toBe(200);
    // 1 of 3 failed
    expect(pkg.errorRate).toBeCloseTo(1 / 3, 5);
    // p95 nearest-rank for [100, 200, 300] = sorted[ceil(0.95*3)-1] = sorted[2] = 300
    expect(pkg.p95DurationMs).toBe(300);
    // Most recent (by ts) row with non-null remainingQuota wins: 11:00 row = 4500.
    expect(pkg.lastRemainingQuota).toBe(4500);

    const single = byEndpoint.get('getPackage') as {
      count: number;
      avgDurationMs: number;
      p95DurationMs: number;
      errorRate: number;
      lastRemainingQuota: number | null;
    };
    expect(single).toBeDefined();
    expect(single.count).toBe(1);
    expect(single.avgDurationMs).toBe(50);
    expect(single.p95DurationMs).toBe(50);
    expect(single.errorRate).toBe(0);
    // No row carries a remainingQuota for getPackage.
    expect(single.lastRemainingQuota).toBeNull();
  });

  it('does not bleed rows from a different facility into the result', async () => {
    // Capture the prisma query argument so we can verify scoping.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).metrcApiCall.findMany.mockImplementation(async (args: { where: { facilityId: string } }) => {
      // The procedure must scope by facilityId — we only return rows that match.
      if (args.where.facilityId === FACILITY_A) {
        return [makeRow({ facilityId: FACILITY_A, endpoint: 'getActivePackages', durationMs: 100 })];
      }
      return [];
    });

    const createCaller = createCallerFactory(observabilityRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: ADMIN_SESSION,
      activeOrgId: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aResult = await (caller as any).getApiCallStats({ facilityId: FACILITY_A, days: 7 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bResult = await (caller as any).getApiCallStats({ facilityId: FACILITY_B, days: 7 });

    expect(aResult).toHaveLength(1);
    expect(aResult[0].endpoint).toBe('getActivePackages');
    expect(bResult).toHaveLength(0);

    // The query must filter by facilityId in the WHERE clause.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (prisma as any).metrcApiCall.findMany.mock.calls as Array<[{ where: { facilityId: string } }]>;
    expect(calls.some((c) => c[0].where.facilityId === FACILITY_A)).toBe(true);
    expect(calls.some((c) => c[0].where.facilityId === FACILITY_B)).toBe(true);
  });
});
