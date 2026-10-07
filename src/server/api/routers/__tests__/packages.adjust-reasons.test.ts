// User action mirrored: an operator opens the "Adjust package" dialog on the
// inventory page twice within the same session. The dropdown must populate
// from the live Metrc API the first time but be served from the 24h cache the
// second time. The "exactly 1 Metrc call for two consecutive opens" outcome is
// observed by spying on the mocked Metrc client. The call-count assertion is
// justified here because the only alternative (counting network requests in a
// real Metrc client) is prohibitively expensive in a unit test.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/lib/prisma BEFORE importing the router so the router picks up the mock.
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    metrcFacility: {
      findFirst: vi.fn(),
    },
  };
  const mockDashboardPrisma = {};
  return { prisma: mockPrisma, dashboardPrisma: mockDashboardPrisma };
});

vi.mock('@/lib/auth-helpers', () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(['org-1']),
}));

// @/lib/auth pulls in resend / NextAuth providers / domain-verification — all
// irrelevant to a tRPC procedure unit test. Stub it.
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

// metrc-factory: spy getPackageAdjustReasons so we can count calls.
const FAKE_REASONS = [
  { Name: 'Spoilage', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
  { Name: 'Theft', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
];
const getPackageAdjustReasonsSpy = vi.fn().mockResolvedValue(FAKE_REASONS);

vi.mock('@/services/metrc/metrc-factory', () => ({
  getMetrcClient: vi.fn(() => ({
    getPackageAdjustReasons: getPackageAdjustReasonsSpy,
  })),
  getMetrcClientForWrite: vi.fn(() => ({
    getPackageAdjustReasons: getPackageAdjustReasonsSpy,
  })),
}));

import { prisma } from '@/lib/prisma';
import { packagesRouter } from '@/server/api/routers/packages';
import { createCallerFactory } from '@/lib/trpc';
import { __resetAdjustReasonsCacheForTest } from '@/services/metrc/adjust-reasons-cache';

const FACILITY_A = 'fac-adj-1';
const FACILITY_B = 'fac-adj-2';
const ORG_ID = 'org-1';

const FAKE_FACILITY_A = {
  id: FACILITY_A,
  organizationId: ORG_ID,
  licenseNumber: 'LIC-A',
  metrcEnvironment: 'sandbox',
  metrcKeyAccess: null,
  sandboxMetrcKeyAccess: null,
};

const FAKE_FACILITY_B = {
  id: FACILITY_B,
  organizationId: ORG_ID,
  licenseNumber: 'LIC-B',
  metrcEnvironment: 'sandbox',
  metrcKeyAccess: null,
  sandboxMetrcKeyAccess: null,
};

const FAKE_SESSION = {
  user: {
    id: 'user-1',
    email: 'op@example.com',
    facilityAccess: {},
  },
};

describe('packages.getAdjustReasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAdjustReasonsCacheForTest();
    getPackageAdjustReasonsSpy.mockResolvedValue(FAKE_REASONS);
  });

  it('caches results per facility — two consecutive calls issue exactly 1 Metrc call', async () => {
    // @ts-expect-error — mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY_A);

    const createCaller = createCallerFactory(packagesRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: FAKE_SESSION,
      activeOrgId: null,
    });

    const first = await caller.getAdjustReasons({ facilityId: FACILITY_A });
    const second = await caller.getAdjustReasons({ facilityId: FACILITY_A });

    expect(first).toEqual(FAKE_REASONS);
    expect(second).toEqual(FAKE_REASONS);
    expect(getPackageAdjustReasonsSpy).toHaveBeenCalledTimes(1);
  });

  it('different facilities do not share cache entries', async () => {
    const createCaller = createCallerFactory(packagesRouter);

    // First facility
    // @ts-expect-error — mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValueOnce(FAKE_FACILITY_A);
    const callerA = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: FAKE_SESSION,
      activeOrgId: null,
    });
    await callerA.getAdjustReasons({ facilityId: FACILITY_A });

    // Second facility
    // @ts-expect-error — mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValueOnce(FAKE_FACILITY_B);
    const callerB = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: FAKE_SESSION,
      activeOrgId: null,
    });
    await callerB.getAdjustReasons({ facilityId: FACILITY_B });

    // Each facility triggers its own live fetch — 2 total.
    expect(getPackageAdjustReasonsSpy).toHaveBeenCalledTimes(2);
  });
});
