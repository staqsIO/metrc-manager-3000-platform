/**
 * Utility for converting snapshot DB rows to Metrc-compatible shapes.
 *
 * All routers that previously called `getMetrcClient().getActive*()` now
 * read from snapshot tables via Prisma. The engines expect Metrc-shaped
 * objects, so these mappers bridge the two.
 *
 * Phase 1: PackageSnapshot
 * Phase 2: PlantSnapshot, PlantBatchSnapshot, HarvestSnapshot, LabTestSnapshot
 */

import type {
  PackageSnapshot,
  PlantSnapshot,
  PlantBatchSnapshot,
  HarvestSnapshot,
  LabTestSnapshot,
  TransferSnapshot,
  TransferDeliveryRecord,
  TransferPackageRecord,
  ItemSnapshot,
  LocationSnapshot,
  StrainSnapshot,
} from '@prisma/client';
import type {
  MetrcPackage,
  MetrcPlant,
  MetrcPlantBatch,
  MetrcHarvest,
  MetrcLabTest,
  MetrcTransfer,
  MetrcDelivery,
  MetrcDeliveryPackage,
  MetrcItem,
  MetrcLocation,
  MetrcStrain,
} from './types';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

// ─── Select projections: exclude rawPayload to save 60-80% DB transfer ──────

/** Columns needed by snapshotToMetrcPackage — excludes rawPayload (~2-4KB/row) */
export const PACKAGE_SNAPSHOT_SELECT = {
  metrcPackageId: true, packageLabel: true, packageType: true, sourceHarvestNames: true,
  itemId: true, itemName: true, itemCategory: true, itemStrainName: true,
  quantity: true, unitOfMeasure: true, packagedDate: true, locationName: true,
  labTestingState: true, isOnHold: true, isFinished: true, isActive: true,
  productCategory: true, metrcLastModified: true, finishedDate: true, archivedDate: true,
  facilityId: true, id: true,
} satisfies Prisma.PackageSnapshotSelect;

const PLANT_SNAPSHOT_SELECT = {
  metrcPlantId: true, label: true, state: true, growthPhase: true,
  plantBatchName: true, plantBatchTypeName: true, strainName: true,
  locationName: true, roomName: true, isOnHold: true, isActive: true,
  plantedDate: true, vegetativeDate: true, floweringDate: true,
  harvestedDate: true, destroyedDate: true, metrcLastModified: true,
  facilityId: true, id: true,
} satisfies Prisma.PlantSnapshotSelect;

const PLANT_BATCH_SNAPSHOT_SELECT = {
  metrcBatchId: true, name: true, type: true, strainName: true,
  locationName: true, roomName: true, count: true, untrackedCount: true,
  trackedCount: true, packagedCount: true, harvestedCount: true, destroyedCount: true,
  plantedDate: true, metrcLastModified: true, isActive: true, facilityId: true, id: true,
} satisfies Prisma.PlantBatchSnapshotSelect;

const HARVEST_SNAPSHOT_SELECT = {
  metrcHarvestId: true, name: true, harvestType: true, sourceStrainNames: true,
  dryingLocationName: true, currentWeight: true, totalWasteWeight: true,
  totalRestoredWeight: true, packageCount: true, totalPackagedWeight: true,
  unitOfWeightName: true, labTestingState: true, isOnHold: true, isActive: true,
  harvestStartDate: true, finishedDate: true, archivedDate: true,
  metrcLastModified: true, facilityId: true, id: true,
} satisfies Prisma.HarvestSnapshotSelect;

/**
 * Convert a PackageSnapshot DB row to the MetrcPackage shape expected by engines.
 * Operates without rawPayload — only uses typed columns.
 */
export function snapshotToMetrcPackage(s: Pick<PackageSnapshot, keyof typeof PACKAGE_SNAPSHOT_SELECT>): MetrcPackage {
  return {
    Id: s.metrcPackageId,
    Label: s.packageLabel,
    PackageType: s.packageType ?? '',
    SourceHarvestNames: s.sourceHarvestNames ?? '',
    SourcePackageLabels: '', // Not stored as typed column — acceptable loss
    ItemId: s.itemId ?? 0,
    ItemName: s.itemName,
    ItemCategory: s.itemCategory ?? '',
    ItemStrainName: s.itemStrainName ?? '',
    ItemUnitOfMeasureName: s.unitOfMeasure ?? '',
    Quantity: Number(s.quantity),
    UnitOfMeasureName: s.unitOfMeasure ?? '',
    PackagedDate: s.packagedDate?.toISOString().split('T')[0] ?? '',
    LocationName: s.locationName ?? '',
    LabTestingState: s.labTestingState ?? '',
    IsOnHold: s.isOnHold ?? false,
    Note: '', // Not stored as typed column — acceptable loss
    ContainsRemediatedProduct: false, // Not stored as typed column — acceptable loss
    LastModified: s.metrcLastModified?.toISOString() ?? '',
    ProductCategoryName: s.productCategory ?? s.itemCategory ?? '',
    IsFinished: s.isFinished,
    FinishedDate: s.finishedDate?.toISOString().split('T')[0] ?? null,
    ArchivedDate: s.archivedDate?.toISOString().split('T')[0] ?? null,
  } as unknown as MetrcPackage;
}

/**
 * Fetch active PackageSnapshots from DB and convert to MetrcPackage[].
 * Drop-in replacement for `getMetrcClient(facility).getActivePackages()`.
 *
 * Filters out zero-quantity rows: Metrc's "active" status only means
 * "not archived/finished" — depleted packages (Quantity == 0) can sit in the
 * active list indefinitely. Every consumer of this function (aging,
 * recommendations, run rates, room aggregation, copilot tools) treats
 * zero-quantity packages as noise. Until the snapshot stores
 * FinishedDate/ArchivedDate so we can filter on those instead, the quantity
 * gate is the cheapest correct definition of "active inventory."
 */
export async function getActivePackagesFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcPackage[]> {
  const snapshots = await prisma.packageSnapshot.findMany({
    where: { facilityId, isActive: true, quantity: { gt: 0 } },
    select: PACKAGE_SNAPSHOT_SELECT,
  });
  return snapshots.map(snapshotToMetrcPackage);
}

/**
 * Fetch ALL PackageSnapshots (active + inactive) from DB.
 * Useful for routers that need both states (e.g., getByStatus, analytics).
 *
 * The "active" branch mirrors getActivePackagesFromDb's semantics: it
 * additionally requires quantity > 0 so depleted-but-still-flagged-active
 * Metrc packages don't pollute the active list. The "inactive" branch is
 * left intact — depleted is the normal terminal state for inactive packages.
 */
export async function getAllPackagesFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<{ active: MetrcPackage[]; inactive: MetrcPackage[] }> {
  const snapshots = await prisma.packageSnapshot.findMany({
    where: { facilityId },
    select: PACKAGE_SNAPSHOT_SELECT,
  });
  const active: MetrcPackage[] = [];
  const inactive: MetrcPackage[] = [];
  for (const s of snapshots) {
    const pkg = snapshotToMetrcPackage(s);
    if (s.isActive && Number(s.quantity) > 0) active.push(pkg);
    else if (!s.isActive) inactive.push(pkg);
  }
  return { active, inactive };
}

// ─── Phase 2: Plant Snapshots ────────────────────────────────────────────────

/**
 * Convert a PlantSnapshot DB row to the MetrcPlant shape expected by formatPlant().
 */
export function plantSnapshotToMetrc(s: Pick<PlantSnapshot, keyof typeof PLANT_SNAPSHOT_SELECT>): MetrcPlant {
  return {
    Id: s.metrcPlantId,
    Label: s.label,
    State: s.state ?? '',
    GrowthPhase: s.growthPhase ?? '',
    PlantBatchName: s.plantBatchName ?? '',
    PlantBatchTypeName: s.plantBatchTypeName ?? '',
    StrainName: s.strainName ?? '',
    LocationName: s.locationName ?? '',
    RoomName: s.roomName ?? '',
    PatientLicenseNumber: '',
    HarvestCount: 0,
    IsOnHold: s.isOnHold,
    PlantedDate: s.plantedDate?.toISOString().split('T')[0] ?? '',
    VegetativeDate: s.vegetativeDate?.toISOString().split('T')[0] ?? null,
    FloweringDate: s.floweringDate?.toISOString().split('T')[0] ?? null,
    HarvestedDate: s.harvestedDate?.toISOString().split('T')[0] ?? null,
    DestroyedDate: s.destroyedDate?.toISOString().split('T')[0] ?? null,
    LastModified: s.metrcLastModified?.toISOString() ?? '',
  };
}

/**
 * Fetch active PlantSnapshots from DB and convert to MetrcPlant[].
 * Drop-in replacement for `getMetrcClient(facility).getActivePlants()`.
 */
export async function getActivePlantsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcPlant[]> {
  const snapshots = await prisma.plantSnapshot.findMany({
    where: { facilityId, isActive: true },
    select: PLANT_SNAPSHOT_SELECT,
  });
  return snapshots.map(plantSnapshotToMetrc);
}

// ─── Phase 2: Plant Batch Snapshots ──────────────────────────────────────────

/**
 * Convert a PlantBatchSnapshot DB row to the MetrcPlantBatch shape.
 */
export function plantBatchSnapshotToMetrc(s: Pick<PlantBatchSnapshot, keyof typeof PLANT_BATCH_SNAPSHOT_SELECT>): MetrcPlantBatch {
  return {
    Id: s.metrcBatchId,
    Name: s.name,
    Type: s.type ?? '',
    StrainName: s.strainName ?? '',
    LocationName: s.locationName ?? '',
    RoomName: s.roomName ?? '',
    PatientLicenseNumber: null,
    Count: s.count,
    UntrackedCount: s.untrackedCount,
    TrackedCount: s.trackedCount,
    PackagedCount: s.packagedCount,
    HarvestedCount: s.harvestedCount,
    DestroyedCount: s.destroyedCount,
    PlantedDate: s.plantedDate?.toISOString().split('T')[0] ?? '',
    LastModified: s.metrcLastModified?.toISOString() ?? '',
  };
}

/**
 * Fetch active PlantBatchSnapshots from DB and convert to MetrcPlantBatch[].
 */
export async function getActivePlantBatchesFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcPlantBatch[]> {
  const snapshots = await prisma.plantBatchSnapshot.findMany({
    where: { facilityId, isActive: true },
    select: PLANT_BATCH_SNAPSHOT_SELECT,
  });
  return snapshots.map(plantBatchSnapshotToMetrc);
}

/**
 * Fetch ALL PlantBatchSnapshots (active + inactive) from DB.
 */
export async function getAllPlantBatchesFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<{ active: MetrcPlantBatch[]; inactive: MetrcPlantBatch[] }> {
  const snapshots = await prisma.plantBatchSnapshot.findMany({ where: { facilityId }, select: PLANT_BATCH_SNAPSHOT_SELECT });
  const active: MetrcPlantBatch[] = [];
  const inactive: MetrcPlantBatch[] = [];
  for (const s of snapshots) {
    const batch = plantBatchSnapshotToMetrc(s);
    if (s.isActive) active.push(batch);
    else inactive.push(batch);
  }
  return { active, inactive };
}

// ─── Phase 2: Harvest Snapshots ──────────────────────────────────────────────

/**
 * Convert a HarvestSnapshot DB row to the MetrcHarvest shape.
 */
export function harvestSnapshotToMetrc(s: Pick<HarvestSnapshot, keyof typeof HARVEST_SNAPSHOT_SELECT>): MetrcHarvest {
  return {
    Id: s.metrcHarvestId,
    Name: s.name,
    HarvestType: s.harvestType ?? '',
    SourceStrainNames: s.sourceStrainNames ?? '',
    DryingLocationName: s.dryingLocationName ?? '',
    PatientLicenseNumber: null,
    CurrentWeight: Number(s.currentWeight),
    TotalWasteWeight: Number(s.totalWasteWeight),
    TotalRestoredWeight: Number(s.totalRestoredWeight),
    PackageCount: s.packageCount,
    TotalPackagedWeight: Number(s.totalPackagedWeight),
    UnitOfWeightName: s.unitOfWeightName ?? '',
    LabTestingState: s.labTestingState ?? '',
    LabTestingStateDate: null,
    IsOnHold: s.isOnHold,
    HarvestStartDate: s.harvestStartDate?.toISOString().split('T')[0] ?? '',
    FinishedDate: s.finishedDate?.toISOString().split('T')[0] ?? null,
    ArchivedDate: s.archivedDate?.toISOString().split('T')[0] ?? null,
    LastModified: s.metrcLastModified?.toISOString() ?? '',
  };
}

/**
 * Fetch active HarvestSnapshots from DB and convert to MetrcHarvest[].
 */
export async function getActiveHarvestsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcHarvest[]> {
  const snapshots = await prisma.harvestSnapshot.findMany({
    where: { facilityId, isActive: true, isOnHold: false },
    select: HARVEST_SNAPSHOT_SELECT,
  });
  return snapshots.map(harvestSnapshotToMetrc);
}

/**
 * Fetch on-hold HarvestSnapshots from DB.
 */
export async function getOnHoldHarvestsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcHarvest[]> {
  const snapshots = await prisma.harvestSnapshot.findMany({
    where: { facilityId, isActive: true, isOnHold: true },
    select: HARVEST_SNAPSHOT_SELECT,
  });
  return snapshots.map(harvestSnapshotToMetrc);
}

/**
 * Fetch inactive HarvestSnapshots from DB.
 */
export async function getInactiveHarvestsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcHarvest[]> {
  const snapshots = await prisma.harvestSnapshot.findMany({
    where: { facilityId, isActive: false },
    select: HARVEST_SNAPSHOT_SELECT,
  });
  return snapshots.map(harvestSnapshotToMetrc);
}

/**
 * Fetch ALL HarvestSnapshots from DB.
 */
export async function getAllHarvestsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<{ active: MetrcHarvest[]; onHold: MetrcHarvest[]; inactive: MetrcHarvest[] }> {
  const snapshots = await prisma.harvestSnapshot.findMany({ where: { facilityId }, select: HARVEST_SNAPSHOT_SELECT });
  const active: MetrcHarvest[] = [];
  const onHold: MetrcHarvest[] = [];
  const inactive: MetrcHarvest[] = [];
  for (const s of snapshots) {
    const harvest = harvestSnapshotToMetrc(s);
    if (!s.isActive) inactive.push(harvest);
    else if (s.isOnHold) onHold.push(harvest);
    else active.push(harvest);
  }
  return { active, onHold, inactive };
}

// ─── Phase 2: Lab Test Snapshots ─────────────────────────────────────────────

/**
 * Convert a LabTestSnapshot DB row to the MetrcLabTest shape.
 */
export function labTestSnapshotToMetrc(s: LabTestSnapshot): MetrcLabTest {
  return {
    PackageId: s.packageId,
    PackageLabel: s.packageLabel,
    TestPerformedDate: s.testPerformedDate?.toISOString().split('T')[0] ?? '',
    OverallPassed: s.overallPassed,
    TestTypeName: s.testTypeName ?? '',
    TestResultLevel: s.testResultLevel ? Number(s.testResultLevel) : 0,
    TestResultUnit: s.testResultUnit ?? '',
    LabFacilityName: s.labFacilityName ?? '',
  };
}

/**
 * Fetch LabTestSnapshots from DB and convert to MetrcLabTest[].
 */
export async function getLabTestResultsFromDb(
  prisma: PrismaClient,
  facilityId: string,
): Promise<MetrcLabTest[]> {
  const snapshots = await prisma.labTestSnapshot.findMany({
    where: { facilityId },
    select: {
      packageId: true, packageLabel: true, testPerformedDate: true,
      overallPassed: true, testTypeName: true, testResultLevel: true,
      testResultUnit: true, labFacilityName: true,
    },
  });
  return snapshots.map(labTestSnapshotToMetrc as (s: typeof snapshots[number]) => MetrcLabTest);
}

// ─── Phase 3: Transfer Snapshots ─────────────────────────────────────────────

/**
 * Convert a TransferSnapshot DB row to MetrcTransfer shape.
 */
export function transferSnapshotToMetrc(s: TransferSnapshot): MetrcTransfer {
  return {
    Id: s.metrcTransferId,
    ManifestNumber: s.manifestNumber,
    ShipperFacilityLicenseNumber: s.shipperFacilityLicenseNumber,
    ShipperFacilityName: s.shipperFacilityName,
    TransporterFacilityLicenseNumber: s.transporterFacilityLicenseNumber ?? '',
    TransporterFacilityName: s.transporterFacilityName ?? '',
    ReceiverFacilityLicenseNumber: s.receiverFacilityLicenseNumber ?? '',
    ReceiverFacilityName: s.receiverFacilityName ?? '',
    DeliveryCount: s.deliveryCount,
    ReceivedDeliveryCount: s.receivedDeliveryCount,
    PackageCount: s.packageCount,
    ReceivedPackageCount: s.receivedPackageCount,
    ContainsDonation: s.containsDonation,
    ContainsTradeSample: s.containsTradeSample,
    ContainsTestingSample: s.containsTestingSample,
    CreatedDateTime: s.createdDateTime,
    CreatedByUserName: '',
    LastModified: s.lastModified,
    EstimatedDepartureDateTime: s.estimatedDepartureDateTime,
    EstimatedArrivalDateTime: s.estimatedArrivalDateTime,
    ReceivedDateTime: s.receivedDateTime,
  };
}

async function fetchTransfersByDirection(
  prisma: PrismaClient,
  facilityId: string,
  direction: 'incoming' | 'outgoing' | 'rejected',
): Promise<MetrcTransfer[]> {
  const rows = await prisma.transferSnapshot.findMany({
    where: { facilityId, direction, isActive: true },
  });
  return rows.map(transferSnapshotToMetrc);
}

export function getIncomingTransfersFromDb(prisma: PrismaClient, facilityId: string) {
  return fetchTransfersByDirection(prisma, facilityId, 'incoming');
}

export function getOutgoingTransfersFromDb(prisma: PrismaClient, facilityId: string) {
  return fetchTransfersByDirection(prisma, facilityId, 'outgoing');
}

export function getRejectedTransfersFromDb(prisma: PrismaClient, facilityId: string) {
  return fetchTransfersByDirection(prisma, facilityId, 'rejected');
}

/**
 * Fetch all transfers (all directions, active + inactive) from DB.
 * Used for historical/analytics queries.
 */
export async function getAllTransfersFromDb(
  prisma: PrismaClient,
  facilityId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<MetrcTransfer[]> {
  const rows = await prisma.transferSnapshot.findMany({
    where: { facilityId, ...(opts.activeOnly ? { isActive: true } : {}) },
  });
  return rows.map(transferSnapshotToMetrc);
}

/**
 * Convert a TransferDeliveryRecord DB row to MetrcDelivery shape.
 */
export function transferDeliveryToMetrc(d: TransferDeliveryRecord): MetrcDelivery {
  return {
    Id: d.metrcDeliveryId,
    RecipientFacilityLicenseNumber: d.recipientFacilityLicenseNumber,
    RecipientFacilityName: d.recipientFacilityName,
    ShipmentTypeName: d.shipmentTypeName ?? '',
    ShipmentTransactionType: d.shipmentTransactionType ?? '',
    EstimatedDepartureDateTime: d.estimatedDepartureDateTime ?? '',
    EstimatedArrivalDateTime: d.estimatedArrivalDateTime ?? '',
    ActualDepartureDateTime: d.actualDepartureDateTime,
    ActualArrivalDateTime: d.actualArrivalDateTime,
    GrossWeight: d.grossWeight != null ? Number(d.grossWeight) : null,
    GrossUnitOfWeightName: d.grossUnitOfWeightName,
    PlannedRoute: d.plannedRoute ?? '',
    ReceivedDateTime: d.receivedDateTime,
    ReceivedByName: d.receivedByName,
    TotalPackages: d.totalPackages,
    TotalPrice: d.totalPrice != null ? Number(d.totalPrice) : null,
  };
}

/**
 * Convert a TransferPackageRecord DB row to MetrcDeliveryPackage shape.
 */
export function transferPackageToMetrcDeliveryPackage(p: TransferPackageRecord): MetrcDeliveryPackage {
  return {
    PackageId: p.metrcPackageId,
    PackageLabel: p.packageLabel,
    PackageType: p.packageType ?? '',
    ItemName: p.itemName,
    ItemStrainName: p.itemStrainName ?? '',
    ItemCategory: p.itemCategory ?? '',
    Quantity: Number(p.quantity),
    UnitOfMeasureName: p.unitOfMeasureName ?? '',
    GrossWeight: p.grossWeight != null ? Number(p.grossWeight) : null,
    GrossUnitOfWeightName: p.grossUnitOfWeightName,
    WholesalePrice: p.wholesalePrice != null ? Number(p.wholesalePrice) : null,
    ShipmentPackageState: p.shipmentPackageState ?? '',
    LabTestingState: p.labTestingState ?? '',
    RemediationDate: p.remediationDate,
  };
}

/**
 * Fetch deliveries for a transfer by Metrc transfer ID.
 * Walks the TransferSnapshot → TransferDeliveryRecord join.
 */
export async function getTransferDeliveriesFromDb(
  prisma: PrismaClient,
  facilityId: string,
  metrcTransferId: number,
  direction?: 'incoming' | 'outgoing' | 'rejected',
): Promise<MetrcDelivery[]> {
  const header = await prisma.transferSnapshot.findFirst({
    where: { facilityId, metrcTransferId, ...(direction ? { direction } : {}) },
    include: { deliveries: true },
  });
  if (!header) return [];
  return header.deliveries.map(transferDeliveryToMetrc);
}

/**
 * Fetch packages for a delivery by Metrc delivery ID.
 */
export async function getDeliveryPackagesFromDb(
  prisma: PrismaClient,
  metrcDeliveryId: number,
): Promise<MetrcDeliveryPackage[]> {
  const delivery = await prisma.transferDeliveryRecord.findFirst({
    where: { metrcDeliveryId },
    include: { packages: true },
  });
  if (!delivery) return [];
  return delivery.packages.map(transferPackageToMetrcDeliveryPackage);
}

/**
 * Persist deliveries returned by a live Metrc call into TransferDeliveryRecord.
 *
 * Used by the lazy-backfill path in the transfers router: when a user opens an
 * undrilled transfer, the router falls back to live Metrc and ALSO writes the
 * response here so future opens come from DB and pay zero Metrc calls.
 *
 * Column parity matches `transfer-sync.ts` so a row written by either source
 * is interchangeable. `lastSyncedAt` is set on every call (Prisma's
 * `@default(now())` only fires on create, so updates would otherwise stay
 * stale forever).
 *
 * Called best-effort by the router (wrapped in try/catch). Caller is
 * responsible for ensuring `transferSnapshotId` exists — this function does
 * NOT create the parent header.
 *
 * Race-safe: two concurrent first-opens both run upsert; the
 * `transferSnapshotId_metrcDeliveryId` unique constraint makes the second
 * one a no-op update.
 */
export async function upsertTransferDeliveriesFromLive(
  prisma: PrismaClient,
  transferSnapshotId: string,
  liveDeliveries: MetrcDelivery[],
): Promise<void> {
  const now = new Date();
  for (const d of liveDeliveries) {
    const isCompleted = !!d.ReceivedDateTime;
    const shared = {
      recipientFacilityLicenseNumber: d.RecipientFacilityLicenseNumber,
      recipientFacilityName: d.RecipientFacilityName,
      shipmentTypeName: d.ShipmentTypeName || null,
      shipmentTransactionType: d.ShipmentTransactionType || null,
      estimatedDepartureDateTime: d.EstimatedDepartureDateTime || null,
      estimatedArrivalDateTime: d.EstimatedArrivalDateTime || null,
      actualDepartureDateTime: d.ActualDepartureDateTime ?? null,
      actualArrivalDateTime: d.ActualArrivalDateTime ?? null,
      receivedDateTime: d.ReceivedDateTime ?? null,
      receivedByName: d.ReceivedByName ?? null,
      grossWeight: d.GrossWeight != null ? new Prisma.Decimal(d.GrossWeight) : null,
      grossUnitOfWeightName: d.GrossUnitOfWeightName ?? null,
      plannedRoute: d.PlannedRoute || null,
      totalPackages: d.TotalPackages ?? 0,
      totalPrice: d.TotalPrice != null ? new Prisma.Decimal(d.TotalPrice) : null,
      isCompleted,
      rawPayload: d as unknown as Prisma.InputJsonValue,
      lastSyncedAt: now,
    };
    await prisma.transferDeliveryRecord.upsert({
      where: {
        transferSnapshotId_metrcDeliveryId: {
          transferSnapshotId,
          metrcDeliveryId: d.Id,
        },
      },
      update: shared,
      create: {
        transferSnapshotId,
        metrcDeliveryId: d.Id,
        ...shared,
      },
    });
  }
}

/**
 * Persist packages returned by a live Metrc call into TransferPackageRecord.
 *
 * Same lazy-backfill purpose and race-safety as
 * `upsertTransferDeliveriesFromLive`. Column parity matches `transfer-sync.ts`.
 *
 * Note: when called from the wholesale-endpoint path, the caller MUST normalize
 * `ReceiverWholesalePrice` / `ShipperWholesalePrice` onto `WholesalePrice`
 * before invoking this function, otherwise the price column is silently
 * persisted as null and the next DB-served open drops the price.
 */
export async function upsertTransferPackagesFromLive(
  prisma: PrismaClient,
  deliveryRecordId: string,
  livePackages: MetrcDeliveryPackage[],
): Promise<void> {
  const now = new Date();
  for (const p of livePackages) {
    const shared = {
      packageLabel: p.PackageLabel,
      packageType: p.PackageType || null,
      itemName: p.ItemName,
      itemStrainName: p.ItemStrainName || null,
      itemCategory: p.ItemCategory || null,
      quantity: new Prisma.Decimal(p.Quantity ?? 0),
      unitOfMeasureName: p.UnitOfMeasureName || null,
      grossWeight: p.GrossWeight != null ? new Prisma.Decimal(p.GrossWeight) : null,
      grossUnitOfWeightName: p.GrossUnitOfWeightName ?? null,
      wholesalePrice: p.WholesalePrice != null ? new Prisma.Decimal(p.WholesalePrice) : null,
      shipmentPackageState: p.ShipmentPackageState || null,
      labTestingState: p.LabTestingState || null,
      remediationDate: p.RemediationDate ?? null,
      rawPayload: p as unknown as Prisma.InputJsonValue,
      lastSyncedAt: now,
    };
    await prisma.transferPackageRecord.upsert({
      where: {
        deliveryRecordId_metrcPackageId: {
          deliveryRecordId,
          metrcPackageId: p.PackageId,
        },
      },
      update: shared,
      create: {
        deliveryRecordId,
        metrcPackageId: p.PackageId,
        ...shared,
      },
    });
  }
}

// ─── Phase 3: Catalog Snapshots ──────────────────────────────────────────────

export function itemSnapshotToMetrc(s: ItemSnapshot): MetrcItem {
  return {
    Id: s.metrcItemId,
    Name: s.name,
    ProductCategoryName: s.productCategoryName ?? '',
    ProductCategoryType: s.productCategoryType ?? '',
    QuantityType: s.quantityType ?? '',
    DefaultLabTestingState: s.defaultLabTestingState ?? '',
    UnitOfMeasureName: s.unitOfMeasureName ?? '',
    StrainName: s.strainName ?? '',
  };
}

export async function getActiveItemsFromDb(prisma: PrismaClient, facilityId: string): Promise<MetrcItem[]> {
  const rows = await prisma.itemSnapshot.findMany({ where: { facilityId, isActive: true } });
  return rows.map(itemSnapshotToMetrc);
}

export function locationSnapshotToMetrc(s: LocationSnapshot): MetrcLocation {
  return {
    Id: s.metrcLocationId,
    Name: s.name,
    LocationTypeId: s.locationTypeId ?? 0,
    LocationTypeName: s.locationTypeName ?? '',
  };
}

export async function getActiveLocationsFromDb(prisma: PrismaClient, facilityId: string): Promise<MetrcLocation[]> {
  const rows = await prisma.locationSnapshot.findMany({ where: { facilityId, isActive: true } });
  return rows.map(locationSnapshotToMetrc);
}

export function strainSnapshotToMetrc(s: StrainSnapshot): MetrcStrain {
  return {
    Id: s.metrcStrainId,
    Name: s.name,
    TestingStatus: s.testingStatus ?? '',
    ThcLevel: s.thcLevel != null ? Number(s.thcLevel) : 0,
    CbdLevel: s.cbdLevel != null ? Number(s.cbdLevel) : 0,
    IndicaPercentage: s.indicaPercentage != null ? Number(s.indicaPercentage) : 0,
    SativaPercentage: s.sativaPercentage != null ? Number(s.sativaPercentage) : 0,
  };
}

export async function getActiveStrainsFromDb(prisma: PrismaClient, facilityId: string): Promise<MetrcStrain[]> {
  const rows = await prisma.strainSnapshot.findMany({ where: { facilityId, isActive: true } });
  return rows.map(strainSnapshotToMetrc);
}
