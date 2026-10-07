// User action mirrored: an operator opens the "Move to location" dropdown on the
// inventory page; the procedure must populate it from LocationSnapshot without
// hitting Metrc. The "0 Metrc calls" verifiable outcome cannot be observed from
// the procedure's return value alone — we assert it by mocking the metrc-factory
// so any live `getActiveLocations()` call would throw, and asserting the spy was
// never called. That call-count assertion is justified here because the only
// alternative (counting network requests in a real Metrc client) is prohibitively
// expensive in a unit test.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/lib/prisma BEFORE importing the router so the router picks up the mock.
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    metrcFacility: {
      findFirst: vi.fn(),
    },
    locationSnapshot: {
      findMany: vi.fn(),
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

// resend is the transitive culprit pulled through @/lib/email; stub the package
// itself in case other code reaches it.
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

// metrc-factory: any call to getMetrcClient is a regression. Spy + throw.
const getActiveLocationsSpy = vi.fn(() => {
  throw new Error('REGRESSION: inventory.getLocations called live Metrc client');
});
vi.mock('@/services/metrc/metrc-factory', () => ({
  getMetrcClient: vi.fn(() => ({
    getActiveLocations: getActiveLocationsSpy,
  })),
  getMetrcClientForWrite: vi.fn(() => ({
    getActiveLocations: getActiveLocationsSpy,
  })),
}));

import { prisma } from '@/lib/prisma';
import { inventoryRouter } from '@/server/api/routers/inventory';
import { createCallerFactory } from '@/lib/trpc';

const FACILITY_ID = 'fac-loc-test-1';
const ORG_ID = 'org-1';

const FAKE_FACILITY = {
  id: FACILITY_ID,
  organizationId: ORG_ID,
  metrcEnvironment: 'sandbox',
  metrcKeyAccess: null,
  sandboxMetrcKeyAccess: null,
};

const SEEDED_SNAPSHOTS = [
  {
    id: 'ls-1',
    facilityId: FACILITY_ID,
    metrcLocationId: 101,
    name: 'Vault Room A',
    locationTypeId: 1,
    locationTypeName: 'Default',
    isActive: true,
    rawPayload: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00Z'),
    capturedAt: new Date('2026-05-01T00:00:00Z'),
  },
  {
    id: 'ls-2',
    facilityId: FACILITY_ID,
    metrcLocationId: 102,
    name: 'Drying Room B',
    locationTypeId: 2,
    locationTypeName: 'Drying',
    isActive: true,
    rawPayload: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00Z'),
    capturedAt: new Date('2026-05-01T00:00:00Z'),
  },
  {
    id: 'ls-3',
    facilityId: FACILITY_ID,
    metrcLocationId: 103,
    name: 'Cure Room C',
    locationTypeId: 1,
    locationTypeName: 'Default',
    isActive: true,
    rawPayload: null,
    lastSyncedAt: new Date('2026-05-01T00:00:00Z'),
    capturedAt: new Date('2026-05-01T00:00:00Z'),
  },
];

const FAKE_SESSION = {
  user: {
    id: 'user-1',
    email: 'op@example.com',
    facilityAccess: {},
  },
};

describe('inventory.getLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-prime the spy because clearAllMocks clears its impl.
    getActiveLocationsSpy.mockImplementation(() => {
      throw new Error('REGRESSION: inventory.getLocations called live Metrc client');
    });
    // Re-prime prisma mocks
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);
    // @ts-expect-error mock methods on mocked prisma
    prisma.locationSnapshot.findMany.mockResolvedValue(SEEDED_SNAPSHOTS);
  });

  it('returns LocationSnapshot rows in MetrcLocation shape and never calls the live Metrc client', async () => {
    const createCaller = createCallerFactory(inventoryRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: FAKE_SESSION,
      activeOrgId: null,
    });

    const result = await caller.getLocations({ facilityId: FACILITY_ID });

    expect(result).toHaveLength(3);
    // MetrcLocation shape: Id, Name, LocationTypeId, LocationTypeName
    expect(result[0]).toEqual({
      Id: 101,
      Name: 'Vault Room A',
      LocationTypeId: 1,
      LocationTypeName: 'Default',
    });
    expect(result[1]).toEqual({
      Id: 102,
      Name: 'Drying Room B',
      LocationTypeId: 2,
      LocationTypeName: 'Drying',
    });
    expect(result[2]).toEqual({
      Id: 103,
      Name: 'Cure Room C',
      LocationTypeId: 1,
      LocationTypeName: 'Default',
    });

    // The live Metrc client must not have been touched.
    expect(getActiveLocationsSpy).not.toHaveBeenCalled();
  });

  it('returns an empty array when no LocationSnapshot rows exist (new-facility cold start)', async () => {
    // @ts-expect-error — mock methods on mocked prisma
    prisma.locationSnapshot.findMany.mockResolvedValueOnce([]);

    const createCaller = createCallerFactory(inventoryRouter);
    const caller = createCaller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      session: FAKE_SESSION,
      activeOrgId: null,
    });

    const result = await caller.getLocations({ facilityId: FACILITY_ID });

    expect(result).toEqual([]);
    expect(getActiveLocationsSpy).not.toHaveBeenCalled();
  });
});
