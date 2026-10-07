// User actions mirrored:
//   1. An operator opens the Transfers page and switches between the
//      Incoming / Outgoing / Rejected tabs. Each tab MUST be served from
//      `TransferSnapshot` and MUST NOT touch the live Metrc API.
//   2. An operator clicks a single transfer to view its manifest detail
//      (`getDeliveries`). That detail call IS allowed to issue at most 1
//      live Metrc call (the snapshot does not store delivery-level rows
//      with the line items the detail view needs); on a 401 it falls back
//      to the snapshot, in which case it issues 0.
//
// The "0 / ≤1 Metrc calls" outcomes can't be observed from return shape
// alone — we mock the metrc-factory so any unexpected method on the live
// client throws, and we spy `getTransferDeliveries` to count invocations.
// That call-count assertion is justified because the only alternative
// (counting real network requests) is prohibitively expensive in a unit
// test. Same pattern as `inventory.get-locations.test.ts` and
// `packages.adjust-reasons.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @/lib/prisma BEFORE importing the router so the router picks up the mock.
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    metrcFacility: {
      findFirst: vi.fn(),
    },
    transferSnapshot: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    transferDeliveryRecord: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    transferPackageRecord: {
      upsert: vi.fn(),
    },
    transferLineItem: {
      findMany: vi.fn(),
    },
  };
  const mockDashboardPrisma = {};
  return { prisma: mockPrisma, dashboardPrisma: mockDashboardPrisma };
});

vi.mock('@/lib/auth-helpers', () => ({
  getUserOrgIds: vi.fn().mockResolvedValue(['org-1']),
}));

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

// metrc-factory: any unexpected method call from a list-view procedure is
// a regression. We spy `getTransferDeliveries` so the detail-path test can
// assert exact call counts; everything else throws by default.
// vi.hoisted ensures spies and the default fake client are initialized
// before vi.mock factories run, so describe blocks that need to override
// the client (e.g. swap throw-stubs for spies) can restore the default.
const { getTransferDeliveriesSpy, defaultFakeClient } = vi.hoisted(() => {
  const throwOnList = (name: string) => () => {
    throw new Error(`REGRESSION: list-view called live Metrc client (${name})`);
  };
  const getTransferDeliveriesSpy = vi.fn();
  return {
    getTransferDeliveriesSpy,
    defaultFakeClient: {
      getTransferDeliveries: getTransferDeliveriesSpy,
      getIncomingTransfers: throwOnList('getIncomingTransfers'),
      getOutgoingTransfers: throwOnList('getOutgoingTransfers'),
      getRejectedTransfers: throwOnList('getRejectedTransfers'),
      getDeliveryPackages: throwOnList('getDeliveryPackages'),
      getDeliveryPackagesWholesale: throwOnList('getDeliveryPackagesWholesale'),
      getActivePackages: throwOnList('getActivePackages'),
    },
  };
});

vi.mock('@/services/metrc/metrc-factory', () => ({
  getMetrcClient: vi.fn(() => defaultFakeClient),
  getMetrcClientForWrite: vi.fn(() => defaultFakeClient),
}));

import { prisma } from '@/lib/prisma';
import { transfersRouter } from '@/server/api/routers/transfers';
import { createCallerFactory } from '@/lib/trpc';

const FACILITY_ID = 'fac-tx-1';
const ORG_ID = 'org-1';

const FAKE_FACILITY = {
  id: FACILITY_ID,
  organizationId: ORG_ID,
  licenseNumber: 'LIC-TX-1',
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

const baseSnapshot = {
  id: 'ts-1',
  facilityId: FACILITY_ID,
  metrcTransferId: 11001,
  manifestNumber: 'M-11001',
  shipperFacilityName: 'Origin Co',
  shipperFacilityLicenseNumber: 'LIC-ORIGIN',
  receiverFacilityName: 'Receiver Co',
  receiverFacilityLicenseNumber: 'LIC-RECEIVER',
  deliveryCount: 1,
  packageCount: 4,
  estimatedDepartureDateTime: '2026-05-01T10:00:00Z',
  receivedDateTime: null,
  createdDateTime: '2026-04-30T08:00:00Z',
  direction: 'incoming',
  isActive: true,
  firstSeenAt: new Date('2026-05-01T10:00:00Z'),
  lastSeenAt: new Date('2026-05-01T10:00:00Z'),
};

const incomingSnapshots = [{ ...baseSnapshot, direction: 'incoming' }];
const outgoingSnapshots = [
  { ...baseSnapshot, id: 'ts-2', metrcTransferId: 11002, manifestNumber: 'M-11002', direction: 'outgoing' },
];
const rejectedSnapshots = [
  { ...baseSnapshot, id: 'ts-3', metrcTransferId: 11003, manifestNumber: 'M-11003', direction: 'rejected' },
];

function makeCaller() {
  const createCaller = createCallerFactory(transfersRouter);
  return createCaller({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    session: FAKE_SESSION,
    activeOrgId: null,
  });
}

describe('transfers list-view procedures: 0 live Metrc calls when snapshot is fresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransferDeliveriesSpy.mockReset();
    // @ts-expect-error — mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);
  });

  it('getIncoming serves from TransferSnapshot without calling Metrc', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findMany.mockResolvedValue(incomingSnapshots);
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.count.mockResolvedValue(incomingSnapshots.length);

    const result = await makeCaller().getIncoming({ facilityId: FACILITY_ID, page: 1, pageSize: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].manifestNumber).toBe('M-11001');
    expect(result.items[0].source).toBe('snapshot');
    expect(result.total).toBe(1);
    // No live Metrc call — the spy is the only allowed live method, and it
    // belongs to the detail path.
    expect(getTransferDeliveriesSpy).not.toHaveBeenCalled();
  });

  it('getOutgoing serves from TransferSnapshot without calling Metrc', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findMany.mockResolvedValue(outgoingSnapshots);
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.count.mockResolvedValue(outgoingSnapshots.length);

    const result = await makeCaller().getOutgoing({ facilityId: FACILITY_ID, page: 1, pageSize: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].manifestNumber).toBe('M-11002');
    expect(result.items[0].source).toBe('snapshot');
    expect(getTransferDeliveriesSpy).not.toHaveBeenCalled();
  });

  it('getRejected serves from TransferSnapshot without calling Metrc', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findMany.mockResolvedValue(rejectedSnapshots);
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.count.mockResolvedValue(rejectedSnapshots.length);

    const result = await makeCaller().getRejected({ facilityId: FACILITY_ID, page: 1, pageSize: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].manifestNumber).toBe('M-11003');
    expect(result.items[0].source).toBe('snapshot');
    expect(getTransferDeliveriesSpy).not.toHaveBeenCalled();
  });

  it('list views return empty page when no snapshot rows exist', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findMany.mockResolvedValue([]);
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.count.mockResolvedValue(0);

    const result = await makeCaller().getIncoming({ facilityId: FACILITY_ID, page: 1, pageSize: 25 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(getTransferDeliveriesSpy).not.toHaveBeenCalled();
  });
});

describe('transfers.getDeliveries: detail path issues exactly 1 live Metrc call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransferDeliveriesSpy.mockReset();
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);
    // No DB-side delivery rows exist for this transfer — forces live fallback.
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue(null);
  });

  it('calls getTransferDeliveries exactly once on a successful live response', async () => {
    getTransferDeliveriesSpy.mockResolvedValue([
      {
        Id: 9001,
        RecipientFacilityName: 'Receiver Co',
        RecipientFacilityLicenseNumber: 'LIC-RECEIVER',
        ShipmentTypeName: 'Transfer',
        EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
        EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
        ReceivedDateTime: null,
        TotalPackages: 4,
        TotalPrice: null,
        PlannedRoute: '',
        GrossWeight: null,
        GrossUnitOfWeightName: null,
      },
    ]);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toHaveLength(1);
    expect(getTransferDeliveriesSpy).toHaveBeenCalledTimes(1);
    expect(getTransferDeliveriesSpy).toHaveBeenCalledWith(11001);
  });
});

// User actions mirrored:
//   3. Transfer drilled by the cron — when an operator opens the manifest
//      detail for a transfer whose deliveries already live in
//      TransferDeliveryRecord, the response MUST come from Postgres and MUST
//      NOT call live Metrc. Same for the package list inside each delivery.
//      This is the budget-saving path: most transfers are pre-drilled, so the
//      common case should be 0 Metrc calls per expand.
//
//   4. Transfer NOT yet drilled — operators must still see something. When
//      no DB rows exist for the transfer (or no package rows for the
//      delivery), the router falls back to one live Metrc call. This is the
//      lazy-backfill safety valve and we assert it still works.
describe('transfers.getDeliveries: serves from TransferDeliveryRecord when present', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransferDeliveriesSpy.mockReset();
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);
  });

  it('returns deliveries from DB without calling live Metrc when rows exist', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [
        {
          id: 'tdr-1',
          transferSnapshotId: 'ts-1',
          metrcDeliveryId: 9001,
          recipientFacilityLicenseNumber: 'LIC-RECEIVER',
          recipientFacilityName: 'Receiver Co',
          shipmentTypeName: 'Transfer',
          shipmentTransactionType: null,
          estimatedDepartureDateTime: '2026-05-01T10:00:00Z',
          estimatedArrivalDateTime: '2026-05-01T16:00:00Z',
          actualDepartureDateTime: null,
          actualArrivalDateTime: null,
          deliveryPackageCount: 4,
          deliveryPackageWeight: null,
          deliveryPackageUnitOfWeightName: null,
          plannedRoute: '',
          receivedDateTime: null,
          receivedByName: null,
          totalPackages: 4,
          totalPrice: null,
          isCompleted: false,
        },
      ],
    });

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(9001);
    expect(result[0].recipientFacilityName).toBe('Receiver Co');
    expect(getTransferDeliveriesSpy).not.toHaveBeenCalled();
  });

  it('falls back to live Metrc when transfer has no DB delivery rows', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [],
    });
    getTransferDeliveriesSpy.mockResolvedValue([
      {
        Id: 9001,
        RecipientFacilityName: 'Receiver Co',
        RecipientFacilityLicenseNumber: 'LIC-RECEIVER',
        ShipmentTypeName: 'Transfer',
        EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
        EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
        ReceivedDateTime: null,
        TotalPackages: 4,
        TotalPrice: null,
        PlannedRoute: '',
        GrossWeight: null,
        GrossUnitOfWeightName: null,
      },
    ]);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toHaveLength(1);
    expect(getTransferDeliveriesSpy).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for the legacy 401-on-incoming fallback.
  // Metrc rejects /transfers/v2/{id}/deliveries for the receiver's license;
  // the router catches the 401 and synthesizes a delivery from the embedded
  // header fields. Operators MUST still see the manifest detail open without
  // a thrown error.
  it('does not throw when live call returns 401 (incoming receiver path)', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findMany.mockResolvedValue([
      {
        ...baseSnapshot,
        // The 401 fallback synthesizes a single delivery from header fields.
        // transferSnapshotToMetrc maps these onto the legacy MetrcTransfer
        // shape — fields the router reads from `raw`.
      },
    ]);
    const authError = Object.assign(new Error('unauthorized'), { statusCode: 401 });
    getTransferDeliveriesSpy.mockRejectedValue(authError);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    // The synthesized fallback returns either a one-item array (when DeliveryId
    // is present in the header) or [] (when not). Both are valid — the contract
    // is "no throw, return an array."
    expect(Array.isArray(result)).toBe(true);
    expect(getTransferDeliveriesSpy).toHaveBeenCalledTimes(1);
  });
});

// We need a second metrc spy for getDeliveryPackages / wholesale. We reuse
// the existing factory mock by accessing the same mocked module — vitest's
// vi.mocked() lets us swap the throw-stubs for spies inside the test.
import { getMetrcClient } from '@/services/metrc/metrc-factory';

describe('transfers.getDeliveryPackages: serves from TransferPackageRecord when present', () => {
  const getDeliveryPackagesSpy = vi.fn();
  const getDeliveryPackagesWholesaleSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getDeliveryPackagesSpy.mockReset();
    getDeliveryPackagesWholesaleSpy.mockReset();
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);

    // Replace the throw-stubs with spies for THIS describe block. Other
    // procedures still throw on call, so a regression elsewhere still trips.
    (getMetrcClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      getTransferDeliveries: () => {
        throw new Error('REGRESSION: package detail path called getTransferDeliveries');
      },
      getDeliveryPackages: getDeliveryPackagesSpy,
      getDeliveryPackagesWholesale: getDeliveryPackagesWholesaleSpy,
    });
  });

  // Restore the default fake client so this describe's override doesn't leak
  // into other test files that share the same mocked module.
  afterEach(() => {
    (getMetrcClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => defaultFakeClient);
  });

  it('returns packages from DB without calling live Metrc when rows exist', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [
        {
          id: 'tpr-1',
          deliveryRecordId: 'tdr-1',
          metrcPackageId: 7001,
          packageLabel: '1A40A0000000001000000001',
          packageType: 'Product',
          itemName: 'Blue Dream 1g',
          itemStrainName: 'Blue Dream',
          itemCategory: 'Buds',
          quantity: { toNumber: () => 1 } as unknown as number, // Decimal in real Prisma
          unitOfMeasureName: 'Each',
          grossWeight: null,
          grossUnitOfWeightName: null,
          wholesalePrice: null,
          shipmentPackageState: 'Accepted',
          labTestingState: 'TestPassed',
          remediationDate: null,
        },
      ],
    });

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(result[0].packageLabel).toBe('1A40A0000000001000000001');
    expect(result[0].itemName).toBe('Blue Dream 1g');
    expect(getDeliveryPackagesSpy).not.toHaveBeenCalled();
    expect(getDeliveryPackagesWholesaleSpy).not.toHaveBeenCalled();
  });

  it('falls back to live wholesale endpoint when delivery has no DB package rows', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
    });
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
        ReceiverWholesalePrice: 5.5,
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(getDeliveryPackagesWholesaleSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to live wholesale when DB returns no row at all (delivery never drilled)', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue(null);
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(getDeliveryPackagesWholesaleSpy).toHaveBeenCalledTimes(1);
  });
});

// User actions mirrored:
//   5. An operator opens a transfer that hasn't been drilled yet. The router
//      falls back to live Metrc and returns the data — but it ALSO writes
//      the deliveries/packages to TransferDeliveryRecord/TransferPackageRecord
//      so that the next user (or the same user revisiting) reads from the DB
//      and pays zero Metrc calls. Lazy backfill / self-healing.
//
// We assert the write-through by checking that the upsert was called with the
// shape we expect — that's the budget-relevant contract. Combined with the
// "DB-hit ⇒ no live call" tests above, this proves the round-trip. We do not
// run a second tRPC call in the same test because in-test mock state would
// have to be hand-rolled to mimic Postgres returning the just-written row.

describe('transfers.getDeliveries: writes through to TransferDeliveryRecord on live fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTransferDeliveriesSpy.mockReset();
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);
  });

  it('upserts each delivery returned from live Metrc when parent TransferSnapshot exists', async () => {
    // Parent TransferSnapshot exists (header sync ran) but no deliveries drilled yet.
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.upsert.mockResolvedValue({ id: 'tdr-new' });
    getTransferDeliveriesSpy.mockResolvedValue([
      {
        Id: 9001,
        RecipientFacilityName: 'Receiver Co',
        RecipientFacilityLicenseNumber: 'LIC-RECEIVER',
        ShipmentTypeName: 'Transfer',
        EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
        EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
        ReceivedDateTime: null,
        TotalPackages: 4,
        TotalPrice: null,
        PlannedRoute: '',
        GrossWeight: null,
        GrossUnitOfWeightName: null,
      },
    ]);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toHaveLength(1);
    expect(prisma.transferDeliveryRecord.upsert).toHaveBeenCalledTimes(1);
    // @ts-expect-error mock methods on mocked prisma
    const upsertArgs = prisma.transferDeliveryRecord.upsert.mock.calls[0][0];
    expect(upsertArgs.where.transferSnapshotId_metrcDeliveryId).toEqual({
      transferSnapshotId: 'ts-1',
      metrcDeliveryId: 9001,
    });
    expect(upsertArgs.create.transferSnapshotId).toBe('ts-1');
    expect(upsertArgs.create.metrcDeliveryId).toBe(9001);
    expect(upsertArgs.create.recipientFacilityName).toBe('Receiver Co');
  });

  it('does not call upsert when live response is empty (no rows to backfill)', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [],
    });
    getTransferDeliveriesSpy.mockResolvedValue([]);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toEqual([]);
    expect(prisma.transferDeliveryRecord.upsert).not.toHaveBeenCalled();
  });

  it('does NOT upsert when parent TransferSnapshot is missing (header sync hasn\'t seen this transfer)', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue(null);
    getTransferDeliveriesSpy.mockResolvedValue([
      {
        Id: 9001,
        RecipientFacilityName: 'Receiver Co',
        RecipientFacilityLicenseNumber: 'LIC-RECEIVER',
        ShipmentTypeName: 'Transfer',
        EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
        EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
        ReceivedDateTime: null,
        TotalPackages: 4,
        TotalPrice: null,
        PlannedRoute: '',
        GrossWeight: null,
        GrossUnitOfWeightName: null,
      },
    ]);

    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    // User still sees the data even though we couldn't persist it.
    expect(result).toHaveLength(1);
    expect(prisma.transferDeliveryRecord.upsert).not.toHaveBeenCalled();
  });

  it('returns the live response even if the write-through upsert throws', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferSnapshot.findFirst.mockResolvedValue({
      id: 'ts-1',
      facilityId: FACILITY_ID,
      metrcTransferId: 11001,
      direction: 'incoming',
      deliveries: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.upsert.mockRejectedValue(new Error('DB write failed'));
    getTransferDeliveriesSpy.mockResolvedValue([
      {
        Id: 9001,
        RecipientFacilityName: 'Receiver Co',
        RecipientFacilityLicenseNumber: 'LIC-RECEIVER',
        ShipmentTypeName: 'Transfer',
        EstimatedDepartureDateTime: '2026-05-01T10:00:00Z',
        EstimatedArrivalDateTime: '2026-05-01T16:00:00Z',
        ReceivedDateTime: null,
        TotalPackages: 4,
        TotalPrice: null,
        PlannedRoute: '',
        GrossWeight: null,
        GrossUnitOfWeightName: null,
      },
    ]);

    // Best-effort write — failure must not break the user-facing response.
    const result = await makeCaller().getDeliveries({ facilityId: FACILITY_ID, transferId: 11001 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(9001);
  });
});

describe('transfers.getDeliveryPackages: writes through to TransferPackageRecord on live fallback', () => {
  const getDeliveryPackagesSpy = vi.fn();
  const getDeliveryPackagesWholesaleSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getDeliveryPackagesSpy.mockReset();
    getDeliveryPackagesWholesaleSpy.mockReset();
    // @ts-expect-error mock methods on mocked prisma
    prisma.metrcFacility.findFirst.mockResolvedValue(FAKE_FACILITY);

    (getMetrcClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      getTransferDeliveries: () => {
        throw new Error('REGRESSION: package detail path called getTransferDeliveries');
      },
      getDeliveryPackages: getDeliveryPackagesSpy,
      getDeliveryPackagesWholesale: getDeliveryPackagesWholesaleSpy,
    });
  });

  afterEach(() => {
    (getMetrcClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => defaultFakeClient);
  });

  it('persists ReceiverWholesalePrice into the wholesalePrice column on backfill', async () => {
    // Bug guard: the wholesale endpoint returns prices under
    // ShipperWholesalePrice / ReceiverWholesalePrice. The standard
    // MetrcDeliveryPackage shape only has WholesalePrice. Without
    // normalization, the lazy backfill writes null and the second
    // (DB-served) open silently drops the price the first open showed.
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferPackageRecord.upsert.mockResolvedValue({ id: 'tpr-new' });
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
        ReceiverWholesalePrice: 5.5,
      },
    ]);

    await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    // @ts-expect-error mock methods on mocked prisma
    const upsertArgs = prisma.transferPackageRecord.upsert.mock.calls[0][0];
    // Decimal serializes via toString(); 5.5 OR a Prisma.Decimal instance both acceptable.
    const persisted = upsertArgs.create.wholesalePrice;
    expect(persisted).not.toBeNull();
    expect(Number(persisted?.toString?.() ?? persisted)).toBe(5.5);
  });

  it('falls through to regular getDeliveryPackages and writes through when wholesale throws', async () => {
    // Coverage for the non-wholesale fallback path. Should still backfill.
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferPackageRecord.upsert.mockResolvedValue({ id: 'tpr-new' });
    getDeliveryPackagesWholesaleSpy.mockRejectedValue(new Error('wholesale unavailable'));
    getDeliveryPackagesSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(getDeliveryPackagesSpy).toHaveBeenCalledTimes(1);
    expect(prisma.transferPackageRecord.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not call upsert when live response is empty', async () => {
    // When both live endpoints are empty the router falls through to the CSV
    // transfer_line_items DB fallback, which reads transfer.manifestNumber
    // from the delivery record and then queries transferLineItem.
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
      transfer: { manifestNumber: '0000000001' },
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferLineItem.findMany.mockResolvedValue([]);
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([]);
    getDeliveryPackagesSpy.mockResolvedValue([]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toEqual([]);
    expect(prisma.transferPackageRecord.upsert).not.toHaveBeenCalled();
  });

  it('upserts each package when parent TransferDeliveryRecord exists and live wholesale returns rows', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferPackageRecord.upsert.mockResolvedValue({ id: 'tpr-new' });
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
        ReceiverWholesalePrice: 5.5,
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(prisma.transferPackageRecord.upsert).toHaveBeenCalledTimes(1);
    // @ts-expect-error mock methods on mocked prisma
    const upsertArgs = prisma.transferPackageRecord.upsert.mock.calls[0][0];
    expect(upsertArgs.where.deliveryRecordId_metrcPackageId).toEqual({
      deliveryRecordId: 'tdr-1',
      metrcPackageId: 7001,
    });
    expect(upsertArgs.create.deliveryRecordId).toBe('tdr-1');
    expect(upsertArgs.create.metrcPackageId).toBe(7001);
    expect(upsertArgs.create.packageLabel).toBe('1A40A0000000001000000001');
  });

  it('does NOT upsert when parent TransferDeliveryRecord is missing (delivery never drilled)', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue(null);
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(prisma.transferPackageRecord.upsert).not.toHaveBeenCalled();
  });

  it('returns the live response even if the write-through upsert throws', async () => {
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferDeliveryRecord.findFirst.mockResolvedValue({
      id: 'tdr-1',
      metrcDeliveryId: 9001,
      packages: [],
    });
    // @ts-expect-error mock methods on mocked prisma
    prisma.transferPackageRecord.upsert.mockRejectedValue(new Error('DB write failed'));
    getDeliveryPackagesWholesaleSpy.mockResolvedValue([
      {
        PackageId: 7001,
        PackageLabel: '1A40A0000000001000000001',
        PackageType: 'Product',
        ItemName: 'Blue Dream 1g',
        ItemStrainName: 'Blue Dream',
        ItemCategory: 'Buds',
        Quantity: 1,
        UnitOfMeasureName: 'Each',
        ShipmentPackageState: 'Accepted',
        LabTestingState: 'TestPassed',
      },
    ]);

    const result = await makeCaller().getDeliveryPackages({ facilityId: FACILITY_ID, deliveryId: 9001 });

    expect(result).toHaveLength(1);
    expect(result[0].packageLabel).toBe('1A40A0000000001000000001');
  });
});
