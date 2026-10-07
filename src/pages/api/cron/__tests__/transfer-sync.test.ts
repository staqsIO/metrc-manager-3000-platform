// User actions mirrored:
//   1. The weekly reconciliation pass: an operator's "active transfers" count
//      should reflect reality. Transfers Metrc no longer returns must be
//      flipped to isActive=false; transfers Metrc still returns stay active.
//      This is what fixes the prod data drift (5,380 "active" at Eastport
//      where most are actually completed).
//   2. Auto-promotion: the cron runs every 4 hours in incremental mode. Once
//      a week, it auto-promotes to full mode so deactivation runs without
//      requiring an ops change to the Railway schedule.
//
// Call-count / DB-call-shape assertions are the cheapest way to express these
// contracts in a unit test — running a real Postgres for a sync test would be
// significantly more expensive and the user-visible outcomes (stale flag
// cleanup, scheduled reconciliation) are exactly the DB writes we assert on.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    transferSnapshot: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    transferDeliveryRecord: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    transferPackageRecord: {
      upsert: vi.fn(),
    },
    syncWatermark: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    metrcFacility: {
      findMany: vi.fn(),
    },
  };
  return { prisma: mockPrisma, dashboardPrisma: {} };
});

vi.mock('@/services/tenant', () => ({
  getProductionOrgIds: vi.fn().mockResolvedValue(['org-1']),
}));

vi.mock('@/services/metrc/budget-guard', () => ({
  canSync: vi.fn().mockResolvedValue({ allowed: true, budget: { status: 'ok', percentUsed: 0 } }),
  incrementBudget: vi.fn(),
  checkBudget: vi.fn().mockResolvedValue({ status: 'ok', percentUsed: 0 }),
}));

const { metrcSpies } = vi.hoisted(() => ({
  metrcSpies: {
    getIncomingTransfers: vi.fn(),
    getOutgoingTransfers: vi.fn(),
    getRejectedTransfers: vi.fn(),
    getTransferDeliveries: vi.fn(),
    getDeliveryPackages: vi.fn(),
  },
}));

vi.mock('@/services/metrc/metrc-factory', () => ({
  getMetrcClient: vi.fn(() => metrcSpies),
}));

import { prisma } from '@/lib/prisma';
import { syncFacilityTransfers } from '../transfer-sync';
import type { MetrcFacility } from '@prisma/client';

const FAKE_FACILITY = {
  id: 'fac-1',
  name: 'Test Facility',
  organizationId: 'org-1',
  licenseNumber: 'LIC-1',
  metrcEnvironment: 'sandbox',
} as unknown as MetrcFacility;

function makeHeader(id: number) {
  return {
    Id: id,
    ManifestNumber: `M-${id}`,
    ShipperFacilityLicenseNumber: 'LIC-S',
    ShipperFacilityName: 'Shipper',
    ReceiverFacilityLicenseNumber: 'LIC-R',
    ReceiverFacilityName: 'Receiver',
    TransporterFacilityLicenseNumber: '',
    TransporterFacilityName: '',
    DeliveryCount: 1,
    ReceivedDeliveryCount: 0,
    PackageCount: 1,
    ReceivedPackageCount: 0,
    ContainsDonation: false,
    ContainsTradeSample: false,
    ContainsTestingSample: false,
    EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
    EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
    ReceivedDateTime: null,
    CreatedDateTime: '2026-04-30T08:00:00Z',
    LastModified: '2026-05-01T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default benign returns so the function can run end-to-end.
  // @ts-expect-error mock methods on mocked prisma
  prisma.transferSnapshot.upsert.mockImplementation((args: unknown) => Promise.resolve({
    id: 'ts-x',
    metrcLastModified: new Date(),
    ...((args as { create?: Record<string, unknown> }).create ?? {}),
  }));
  // @ts-expect-error mock methods on mocked prisma
  prisma.transferSnapshot.updateMany.mockResolvedValue({ count: 0 });
  // @ts-expect-error mock methods on mocked prisma
  prisma.transferDeliveryRecord.findMany.mockResolvedValue([]);
  // @ts-expect-error mock methods on mocked prisma
  prisma.transferDeliveryRecord.upsert.mockResolvedValue({ id: 'tdr-x' });
  // @ts-expect-error mock methods on mocked prisma
  prisma.transferPackageRecord.upsert.mockResolvedValue({ id: 'tpr-x' });
  // @ts-expect-error mock methods on mocked prisma
  prisma.syncWatermark.upsert.mockResolvedValue({});
  metrcSpies.getIncomingTransfers.mockResolvedValue([]);
  metrcSpies.getOutgoingTransfers.mockResolvedValue([]);
  metrcSpies.getRejectedTransfers.mockResolvedValue([]);
  metrcSpies.getTransferDeliveries.mockResolvedValue([]);
  metrcSpies.getDeliveryPackages.mockResolvedValue([]);
});

describe('syncFacilityTransfers: full-mode deactivation pass', () => {
  it('marks transfers no longer returned by the API as isActive=false', async () => {
    // Live API returns ID 11001 only — the rest are stale.
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);
    // No watermark → first run auto-promotes to full mode.
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockResolvedValue(null);

    await syncFacilityTransfers(FAKE_FACILITY);

    // updateMany must be called with notIn containing only the IDs we saw,
    // marking everything else inactive for this facility.
    expect(prisma.transferSnapshot.updateMany).toHaveBeenCalledTimes(1);
    // @ts-expect-error mock methods on mocked prisma
    const updateArgs = prisma.transferSnapshot.updateMany.mock.calls[0][0];
    expect(updateArgs.data.isActive).toBe(false);
    expect(updateArgs.where.facilityId).toBe('fac-1');
    expect(updateArgs.where.isActive).toBe(true);
    expect(updateArgs.where.metrcTransferId.notIn).toContain(11001);
  });

  it('skips deactivation when Metrc returns an empty response (transient API failure, not "all transfers vanished")', async () => {
    // Auto-promote to full mode (no watermark) — but Metrc returns nothing.
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockResolvedValue(null);
    metrcSpies.getIncomingTransfers.mockResolvedValue([]);
    metrcSpies.getOutgoingTransfers.mockResolvedValue([]);
    metrcSpies.getRejectedTransfers.mockResolvedValue([]);

    await syncFacilityTransfers(FAKE_FACILITY);

    // Without a guard, updateMany would mark EVERY active transfer inactive
    // because the empty `seenIds` set produces `notIn: undefined` which
    // Prisma drops, leaving `where: { facilityId, isActive: true }` — a
    // catastrophic deactivation. Skip the pass instead.
    expect(prisma.transferSnapshot.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT run deactivation in incremental mode (would over-deactivate based on recent-changes window)', async () => {
    // Incremental watermark exists → stays incremental.
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockImplementation((args: { where: { facilityId_endpoint: { endpoint: string } } }) => {
      // Header watermark: recent → incremental mode used
      if (args.where.facilityId_endpoint.endpoint === 'transfers.headers') {
        return Promise.resolve({ watermark: new Date().toISOString(), lastRunAt: new Date() });
      }
      // Full-mode watermark: also recent → no auto-promotion
      return Promise.resolve({ watermark: new Date().toISOString(), lastRunAt: new Date() });
    });
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);

    await syncFacilityTransfers(FAKE_FACILITY, { mode: 'incremental' });

    expect(prisma.transferSnapshot.updateMany).not.toHaveBeenCalled();
  });
});

describe('syncFacilityTransfers: weekly auto-promotion to full mode', () => {
  it('promotes incremental → full when no full-mode watermark exists yet', async () => {
    // Incremental header watermark exists, but full-mode watermark missing.
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockImplementation((args: { where: { facilityId_endpoint: { endpoint: string } } }) => {
      if (args.where.facilityId_endpoint.endpoint === 'transfers.headers') {
        return Promise.resolve({ watermark: new Date().toISOString(), lastRunAt: new Date() });
      }
      // 'transfers.headers.full' missing
      return Promise.resolve(null);
    });
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);

    await syncFacilityTransfers(FAKE_FACILITY, { mode: 'incremental' });

    // Promoted to full mode → deactivation must run.
    expect(prisma.transferSnapshot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('promotes incremental → full when full-mode watermark is older than 7 days', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockImplementation((args: { where: { facilityId_endpoint: { endpoint: string } } }) => {
      if (args.where.facilityId_endpoint.endpoint === 'transfers.headers') {
        return Promise.resolve({ watermark: new Date().toISOString(), lastRunAt: new Date() });
      }
      return Promise.resolve({ watermark: eightDaysAgo.toISOString(), lastRunAt: eightDaysAgo });
    });
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);

    await syncFacilityTransfers(FAKE_FACILITY, { mode: 'incremental' });

    expect(prisma.transferSnapshot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('stays incremental when full-mode watermark is recent', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockImplementation((args: { where: { facilityId_endpoint: { endpoint: string } } }) => {
      if (args.where.facilityId_endpoint.endpoint === 'transfers.headers') {
        return Promise.resolve({ watermark: new Date().toISOString(), lastRunAt: new Date() });
      }
      return Promise.resolve({ watermark: yesterday.toISOString(), lastRunAt: yesterday });
    });
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);

    await syncFacilityTransfers(FAKE_FACILITY, { mode: 'incremental' });

    expect(prisma.transferSnapshot.updateMany).not.toHaveBeenCalled();

    // The full-mode watermark must NOT be touched by an incremental run —
    // otherwise a future bug doing so would silently disable auto-promotion
    // for 7 days at a time.
    // @ts-expect-error mock methods on mocked prisma
    const upsertCalls = prisma.syncWatermark.upsert.mock.calls.map((c: [{ where: { facilityId_endpoint: { endpoint: string } } }]) => c[0].where.facilityId_endpoint.endpoint);
    expect(upsertCalls).not.toContain('transfers.headers.full');
  });

  it('writes the full-mode watermark and runs deactivation after a full-mode run', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.syncWatermark.findUnique.mockResolvedValue(null);
    metrcSpies.getIncomingTransfers.mockResolvedValue([makeHeader(11001)]);

    await syncFacilityTransfers(FAKE_FACILITY, { mode: 'full' });

    // @ts-expect-error mock methods on mocked prisma
    const upsertCalls = prisma.syncWatermark.upsert.mock.calls.map((c: [{ where: { facilityId_endpoint: { endpoint: string } } }]) => c[0].where.facilityId_endpoint.endpoint);
    expect(upsertCalls).toContain('transfers.headers.full');
    // Force-full must also trigger ALL full-mode-only side effects, not just
    // the watermark write — most importantly the deactivation pass.
    expect(prisma.transferSnapshot.updateMany).toHaveBeenCalledTimes(1);
  });
});
