// Entity types and IMetrcClient re-exported from shared package.
// All ~50 consumer files keep their existing `from '@/services/metrc/types'` imports unchanged.
export type {
  MetrcPaginationParams,
  MetrcTag,
  MetrcPackage,
  MetrcPlant,
  MetrcTransfer,
  MetrcDelivery,
  MetrcDeliveryPackage,
  MetrcDeliveryPackageWholesale,
  MetrcSaleReceipt,
  MetrcLabTest,
  MetrcStrain,
  MetrcItem,
  MetrcLocation,
  MetrcHarvest,
  MetrcHarvestWaste,
  MetrcPlantBatch,
  MetrcPlantBatchWaste,
  MetrcWasteReason,
  MetrcPackageAdjustReason,
  MetrcWasteMethod,
  IMetrcClient,
} from '@metrc-formul8-os/client';

// Re-import types needed by formatter functions below
import type {
  MetrcPackage,
  MetrcPlant,
  MetrcTransfer,
  MetrcDelivery,
  MetrcDeliveryPackage,
  MetrcHarvest,
  MetrcPlantBatch,
  MetrcPlantBatchWaste as _MetrcPlantBatchWaste,
} from '@metrc-formul8-os/client';

// Formatted types (camelCase, for frontend)
export interface FormattedPackage {
  id: number;
  label: string;
  item: string;
  itemCategory: string;
  strainName: string;
  quantity: number;
  unitOfMeasure: string;
  packageType: string;
  productionBatchNumber: string;
  sourceHarvestNames: string;
  location: string;
  room: string;
  packagedDate: string;
  labTestingState: string;
  isOnHold: boolean;
  lastModified: string;
  // Computed fields
  ageDays: number;
  ageCategory: 'fresh' | 'normal' | 'aging' | 'critical';
}

export interface FormattedPlant {
  id: number;
  label: string;
  strain: string;
  state: string;
  growthPhase: string;
  plantedDate: string;
  location: string;
  room: string;
  isOnHold: boolean;
}

export interface FormattedTransfer {
  id: number;
  manifestNumber: string;
  shipperFacilityName: string;
  shipperFacilityLicense: string;
  receiverFacilityName: string;
  receiverFacilityLicense: string;
  deliveryCount: number;
  packageCount: number;
  estimatedDepartureDateTime: string;
  receivedDateTime: string | null;
  createdDateTime: string;
}

export interface FormattedHarvest {
  id: number;
  name: string;
  harvestType: string;
  sourceStrainNames: string;
  dryingLocation: string;
  currentWeight: number;
  totalWasteWeight: number;
  packageCount: number;
  totalPackagedWeight: number;
  unitOfWeight: string;
  labTestingState: string;
  isOnHold: boolean;
  harvestStartDate: string;
  finishedDate: string | null;
  // Computed
  ageDays: number;
  status: 'active' | 'finished' | 'on_hold';
}

export interface FormattedPlantBatch {
  id: number;
  name: string;
  type: string;
  strainName: string;
  location: string;
  count: number;
  trackedCount: number;
  untrackedCount: number;
  packagedCount: number;
  harvestedCount: number;
  destroyedCount: number;
  plantedDate: string;
  ageDays: number;
}

// Date helpers
export function formatMetrcDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLastNDays(days: number = 30) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: formatMetrcDate(start), endDate: formatMetrcDate(end) };
}

export function calculateAgeDays(packagedDate: string): number {
  const date = new Date(packagedDate);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** Default aging thresholds (days). Override with OperatorBenchmark values per facility. */
export const DEFAULT_AGING_THRESHOLDS = { fresh: 30, normal: 60, aging: 90 } as const;

export interface AgingThresholds {
  /** Max days to be considered "fresh" (default: 30) */
  fresh: number;
  /** Max days to be considered "normal" (default: 60) */
  normal: number;
  /** Max days to be considered "aging" — beyond this is "critical" (default: 90) */
  aging: number;
}

export function getAgeCategory(
  ageDays: number,
  thresholds?: Partial<AgingThresholds>,
): 'fresh' | 'normal' | 'aging' | 'critical' {
  const t = { ...DEFAULT_AGING_THRESHOLDS, ...thresholds };
  if (ageDays <= t.fresh) return 'fresh';
  if (ageDays <= t.normal) return 'normal';
  if (ageDays <= t.aging) return 'aging';
  return 'critical';
}

// Formatter helpers
export function formatPackage(pkg: MetrcPackage): FormattedPackage {
  const ageDays = calculateAgeDays(pkg.PackagedDate);
  return {
    id: pkg.Id,
    label: pkg.Label,
    item: pkg.ItemName,
    itemCategory: pkg.ItemCategory,
    strainName: pkg.ItemStrainName,
    quantity: pkg.Quantity,
    unitOfMeasure: pkg.UnitOfMeasureName,
    packageType: pkg.PackageType,
    productionBatchNumber: pkg.ProductionBatchNumber,
    sourceHarvestNames: pkg.SourceHarvestNames,
    location: pkg.LocationName,
    room: pkg.RoomName,
    packagedDate: pkg.PackagedDate,
    labTestingState: pkg.LabTestingState,
    isOnHold: pkg.IsOnHold,
    lastModified: pkg.LastModified,
    ageDays,
    ageCategory: getAgeCategory(ageDays),
  };
}

export function formatPlant(plant: MetrcPlant): FormattedPlant {
  return {
    id: plant.Id,
    label: plant.Label,
    strain: plant.StrainName,
    state: plant.State,
    growthPhase: plant.GrowthPhase,
    plantedDate: plant.PlantedDate,
    location: plant.LocationName,
    room: plant.RoomName,
    isOnHold: plant.IsOnHold,
  };
}

export function formatPlantBatch(batch: MetrcPlantBatch): FormattedPlantBatch {
  const planted = new Date(batch.PlantedDate);
  const ageDays = Math.floor((Date.now() - planted.getTime()) / (1000 * 60 * 60 * 24));
  return {
    id: batch.Id,
    name: batch.Name,
    type: batch.Type,
    strainName: batch.StrainName ?? '',
    location: batch.LocationName ?? '',
    count: batch.Count ?? 0,
    trackedCount: batch.TrackedCount ?? 0,
    untrackedCount: batch.UntrackedCount ?? 0,
    packagedCount: batch.PackagedCount ?? 0,
    harvestedCount: batch.HarvestedCount ?? 0,
    destroyedCount: batch.DestroyedCount ?? 0,
    plantedDate: batch.PlantedDate,
    ageDays: Number.isFinite(ageDays) ? ageDays : 0,
  };
}

export function formatHarvest(harvest: MetrcHarvest): FormattedHarvest {
  const startDate = new Date(harvest.HarvestStartDate);
  const ageDays = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  let status: 'active' | 'finished' | 'on_hold' = 'active';
  if (harvest.IsOnHold) status = 'on_hold';
  else if (harvest.FinishedDate) status = 'finished';
  return {
    id: harvest.Id,
    name: harvest.Name,
    harvestType: harvest.HarvestType,
    sourceStrainNames: harvest.SourceStrainNames,
    dryingLocation: harvest.DryingLocationName,
    currentWeight: harvest.CurrentWeight,
    totalWasteWeight: harvest.TotalWasteWeight,
    packageCount: harvest.PackageCount,
    totalPackagedWeight: harvest.TotalPackagedWeight,
    unitOfWeight: harvest.UnitOfWeightName,
    labTestingState: harvest.LabTestingState,
    isOnHold: harvest.IsOnHold,
    harvestStartDate: harvest.HarvestStartDate,
    finishedDate: harvest.FinishedDate,
    ageDays,
    status,
  };
}

export function formatTransfer(transfer: MetrcTransfer): FormattedTransfer {
  return {
    id: transfer.Id,
    manifestNumber: transfer.ManifestNumber,
    shipperFacilityName: transfer.ShipperFacilityName,
    shipperFacilityLicense: transfer.ShipperFacilityLicenseNumber,
    receiverFacilityName: transfer.ReceiverFacilityName,
    receiverFacilityLicense: transfer.ReceiverFacilityLicenseNumber,
    deliveryCount: transfer.DeliveryCount,
    packageCount: transfer.PackageCount,
    estimatedDepartureDateTime: transfer.EstimatedDepartureDateTime,
    receivedDateTime: transfer.ReceivedDateTime,
    createdDateTime: transfer.CreatedDateTime,
  };
}

export interface FormattedDelivery {
  id: number;
  recipientFacilityName: string;
  recipientFacilityLicense: string;
  shipmentTypeName: string;
  estimatedDepartureDateTime: string;
  estimatedArrivalDateTime: string;
  receivedDateTime: string | null;
  totalPackages: number;
  totalPrice: number | null;
  plannedRoute: string;
  grossWeight: number | null;
  grossUnitOfWeight: string | null;
}

export interface FormattedDeliveryPackage {
  packageId: number;
  packageLabel: string;
  itemName: string;
  itemCategory: string;
  strainName: string;
  quantity: number;
  unitOfMeasure: string;
  wholesalePrice: number | null;
  shipmentPackageState: string;
  labTestingState: string;
}

export function formatDelivery(d: MetrcDelivery): FormattedDelivery {
  return {
    id: d.Id,
    recipientFacilityName: d.RecipientFacilityName,
    recipientFacilityLicense: d.RecipientFacilityLicenseNumber,
    shipmentTypeName: d.ShipmentTypeName,
    estimatedDepartureDateTime: d.EstimatedDepartureDateTime,
    estimatedArrivalDateTime: d.EstimatedArrivalDateTime,
    receivedDateTime: d.ReceivedDateTime,
    totalPackages: d.TotalPackages,
    totalPrice: d.TotalPrice,
    plannedRoute: d.PlannedRoute,
    grossWeight: d.GrossWeight,
    grossUnitOfWeight: d.GrossUnitOfWeightName,
  };
}

export interface FormattedPlantBatchWaste {
  id: number;
  plantBatchId: number;
  plantBatchName: string;
  wasteReasonName: string;
  wasteWeight: number;
  unitOfWeight: string;
  actualDate: string;
  lastModified: string;
}

export function formatPlantBatchWaste(w: _MetrcPlantBatchWaste): FormattedPlantBatchWaste {
  return {
    id: w.Id,
    plantBatchId: w.PlantBatchId,
    plantBatchName: w.PlantBatchName,
    wasteReasonName: w.WasteReasonName,
    wasteWeight: w.WasteWeight,
    unitOfWeight: w.UnitOfWeightName,
    actualDate: w.ActualDate,
    lastModified: w.LastModified,
  };
}

export function formatDeliveryPackage(p: MetrcDeliveryPackage): FormattedDeliveryPackage {
  // Metrc v2 renamed Quantity → ShippedQuantity, UnitOfMeasureName → ShippedUnitOfMeasureName,
  // and ItemCategory → ItemCategoryName. Handle both v1 and v2 field names.
  const raw = p as unknown as Record<string, unknown>;
  return {
    packageId: p.PackageId,
    packageLabel: p.PackageLabel,
    itemName: p.ItemName,
    itemCategory: (raw.ItemCategoryName as string) ?? p.ItemCategory ?? '',
    strainName: p.ItemStrainName,
    quantity: (raw.ShippedQuantity as number) ?? p.Quantity ?? 0,
    unitOfMeasure: (raw.ShippedUnitOfMeasureName as string) ?? p.UnitOfMeasureName ?? '',
    wholesalePrice: p.WholesalePrice,
    shipmentPackageState: p.ShipmentPackageState,
    labTestingState: p.LabTestingState,
  };
}
