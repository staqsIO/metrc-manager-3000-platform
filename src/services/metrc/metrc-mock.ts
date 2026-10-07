import type {
  IMetrcClient,
  MetrcPackage,
  MetrcPlant,
  MetrcTransfer,
  MetrcDelivery,
  MetrcDeliveryPackage,
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
  MetrcTag,
  MetrcPaginationParams,
} from './types';

/** Apply pagination to an array if params are provided, otherwise return full array. */
function applyPagination<T>(items: T[], pagination?: MetrcPaginationParams): T[] {
  if (pagination?.pageNumber != null && pagination?.pageSize != null) {
    const start = (pagination.pageNumber - 1) * pagination.pageSize;
    return items.slice(start, start + pagination.pageSize);
  }
  return items;
}

// Realistic strain names
const STRAINS = [
  'Blue Dream', 'OG Kush', 'Girl Scout Cookies', 'Sour Diesel', 'Granddaddy Purple',
  'Jack Herer', 'White Widow', 'Northern Lights', 'Green Crack', 'Gorilla Glue #4',
  'Gelato', 'Wedding Cake', 'Zkittlez', 'Runtz', 'Purple Punch',
  'Pineapple Express', 'Durban Poison', 'Trainwreck', 'Bubba Kush', 'AK-47',
];

const ITEM_CATEGORIES = [
  'Flower', 'Trim', 'Shake', 'Pre-Roll', 'Concentrate',
  'Edible', 'Tincture', 'Topical', 'Capsule', 'Vape Cartridge',
];

const LOCATIONS = [
  'Room A', 'Room B', 'Room C', 'Vault 1', 'Vault 2',
  'Processing Area', 'Packaging Room', 'Lab', 'Storage', 'Retail Floor',
];

const LAB_STATES = ['NotSubmitted', 'SubmittedForTesting', 'TestPassed', 'TestFailed'];

function randomDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  return d.toISOString().split('T')[0];
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min: number, max: number, decimals: number = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

// Category pools by generation tier
const LEAF_CATEGORIES = ['Flower', 'Trim', 'Shake'];
const FIRSTGEN_CATEGORIES = ['Concentrate', 'Tincture', 'Topical'];
const SECONDGEN_CATEGORIES = ['Pre-Roll', 'Vape Cartridge', 'Edible', 'Capsule'];

function makeLabel(i: number): string {
  return `1A4000000000000${String(i).padStart(6, '0')}`;
}

function generateMockPackages(count: number = 500): MetrcPackage[] {
  const packages: MetrcPackage[] = [];

  for (let i = 1; i <= count; i++) {
    const strain = randomChoice(STRAINS);
    const location = randomChoice(LOCATIONS);

    // Determine generation tier for DAG relationships
    // ~30% leaf (1-150), ~40% first-gen (151-350), ~20% second-gen (351-450), ~10% third-gen (451-500)
    let category: string;
    let sourcePackageLabels = '';
    let sourceHarvestNames = '';

    if (i <= 150) {
      // Leaf packages — directly from harvests
      category = randomChoice(LEAF_CATEGORIES);
      sourceHarvestNames = `Harvest-${Math.floor(Math.random() * 100)}`;
    } else if (i <= 350) {
      // First-gen processing — 1-3 sources from leaf set
      category = randomChoice(FIRSTGEN_CATEGORIES);
      const sourceCount = 1 + Math.floor(Math.random() * 3);
      const sources: string[] = [];
      for (let s = 0; s < sourceCount; s++) {
        sources.push(makeLabel(1 + Math.floor(Math.random() * 150)));
      }
      sourcePackageLabels = Array.from(new Set(sources)).join(', ');
    } else if (i <= 450) {
      // Second-gen — 1-2 sources from first-gen set
      category = randomChoice(SECONDGEN_CATEGORIES);
      const sourceCount = 1 + Math.floor(Math.random() * 2);
      const sources: string[] = [];
      for (let s = 0; s < sourceCount; s++) {
        sources.push(makeLabel(151 + Math.floor(Math.random() * 200)));
      }
      sourcePackageLabels = Array.from(new Set(sources)).join(', ');
    } else {
      // Third-gen retail — 1 source from second-gen
      category = randomChoice(ITEM_CATEGORIES);
      sourcePackageLabels = makeLabel(351 + Math.floor(Math.random() * 100));
    }

    // Create aging distribution: 40% fresh, 25% normal, 20% aging, 15% critical
    let daysBack: number;
    const rand = Math.random();
    if (rand < 0.40) daysBack = Math.floor(Math.random() * 30);
    else if (rand < 0.65) daysBack = 30 + Math.floor(Math.random() * 30);
    else if (rand < 0.85) daysBack = 60 + Math.floor(Math.random() * 30);
    else daysBack = 90 + Math.floor(Math.random() * 60);

    const packagedDate = new Date();
    packagedDate.setDate(packagedDate.getDate() - daysBack);

    const isWeightBased = category === 'Flower' || category === 'Trim' || category === 'Shake';

    packages.push({
      Id: 100000 + i,
      Label: makeLabel(i),
      PackageType: randomChoice(['Product', 'ImmaturePlant', 'VegetativePlant', 'PlantWaste', 'HarvestWaste']),
      SourceHarvestNames: sourceHarvestNames,
      SourcePackageLabels: sourcePackageLabels,
      ItemId: 1000 + i,
      ItemName: `${strain} ${category}`,
      ItemCategory: category,
      ItemStrainName: strain,
      ItemUnitOfMeasureName: isWeightBased ? 'Grams' : 'Each',
      Quantity: isWeightBased ? randomFloat(10, 5000) : Math.floor(randomFloat(1, 500)),
      UnitOfMeasureName: isWeightBased ? 'Grams' : 'Each',
      PatientLicenseNumber: '',
      ItemServeCount: '',
      Note: '',
      PackagedDate: packagedDate.toISOString().split('T')[0],
      InitialLabTestingState: 'NotSubmitted',
      LabTestingState: randomChoice(LAB_STATES),
      LabTestingStateDate: randomDate(30),
      ProductionBatchNumber: `PB-${2024}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`,
      IsDonation: false,
      IsTradesSample: Math.random() < 0.05,
      IsTestingSample: Math.random() < 0.05,
      ProductRequiresRemediation: Math.random() < 0.03,
      ContainsRemediatedProduct: false,
      RemediationDate: null,
      ReceivedDateTime: Math.random() < 0.3 ? randomDate(60) : null,
      ReceivedFromManifestNumber: null,
      ReceivedFromFacilityLicenseNumber: null,
      ReceivedFromFacilityName: null,
      IsOnHold: Math.random() < 0.05,
      ArchivedDate: null,
      FinishedDate: null,
      LastModified: new Date().toISOString(),
      LocationName: location,
      RoomName: location,
    });
  }

  return packages;
}

function generateMockPlants(count: number = 200): MetrcPlant[] {
  return Array.from({ length: count }, (_, i) => {
    const phases = ['Vegetative', 'Flowering', 'Clone'];
    const phase = randomChoice(phases);
    return {
      Id: 200000 + i,
      Label: `1A4000000000001${String(i).padStart(6, '0')}`,
      State: 'Tracked',
      GrowthPhase: phase,
      PlantBatchName: `Batch-${Math.floor(Math.random() * 50)}`,
      PlantBatchTypeName: phase === 'Clone' ? 'Clone' : 'Seed',
      StrainName: randomChoice(STRAINS),
      LocationName: randomChoice(LOCATIONS.slice(0, 5)),
      RoomName: randomChoice(LOCATIONS.slice(0, 5)),
      PatientLicenseNumber: '',
      HarvestCount: phase === 'Flowering' ? Math.floor(Math.random() * 3) : 0,
      IsOnHold: Math.random() < 0.02,
      PlantedDate: randomDate(120),
      VegetativeDate: phase !== 'Clone' ? randomDate(90) : null,
      FloweringDate: phase === 'Flowering' ? randomDate(60) : null,
      HarvestedDate: null,
      DestroyedDate: null,
      LastModified: new Date().toISOString(),
    };
  });
}

function generateMockTransfers(count: number = 50): MetrcTransfer[] {
  const facilityNames = [
    'Green Valley Farms', 'Pacific Coast Cannabis', 'Sierra Extracts',
    'Bay Area Dispensary', 'Sacramento Distribution', 'Golden State Testing',
  ];

  return Array.from({ length: count }, (_, i) => {
    const manifest = `M${String(100000 + i).padStart(6, '0')}`;
    const shipperLicense = `C10-0000${Math.floor(Math.random() * 100)}-LIC`;
    const shipperName = randomChoice(facilityNames);
    return {
      Id: 300000 + i,
      ManifestNumber: manifest,
      ShipperFacilityLicenseNumber: shipperLicense,
      ShipperFacilityName: shipperName,
      TransporterFacilityLicenseNumber: `C12-0000${Math.floor(Math.random() * 50)}-LIC`,
      TransporterFacilityName: 'Express Cannabis Transport',
      ReceiverFacilityLicenseNumber: `C10-0000${Math.floor(Math.random() * 100)}-LIC`,
      ReceiverFacilityName: randomChoice(facilityNames),
      DeliveryCount: Math.floor(Math.random() * 5) + 1,
      ReceivedDeliveryCount: Math.floor(Math.random() * 5),
      PackageCount: Math.floor(Math.random() * 20) + 1,
      ReceivedPackageCount: Math.floor(Math.random() * 20),
      ContainsDonation: false,
      ContainsTradeSample: Math.random() < 0.1,
      ContainsTestingSample: Math.random() < 0.1,
      CreatedDateTime: randomDate(60),
      CreatedByUserName: 'admin@facility.com',
      LastModified: new Date().toISOString(),
      EstimatedDepartureDateTime: randomDate(30),
      EstimatedArrivalDateTime: randomDate(28),
      ReceivedDateTime: Math.random() < 0.7 ? randomDate(25) : null,
    };
  });
}

function generateMockHarvests(count: number = 30): MetrcHarvest[] {
  const harvestTypes = ['WholePlant', 'Manicure'];
  const dryingLocations = ['Room A', 'Room B', 'Room C', 'Processing Area'];

  return Array.from({ length: count }, (_, i) => {
    const daysBack = Math.floor(Math.random() * 90) + 5;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const isFinished = Math.random() < 0.4;
    const isOnHold = !isFinished && Math.random() < 0.1;
    const currentWeight = randomFloat(500, 15000);
    const wasteWeight = randomFloat(50, currentWeight * 0.15);
    const packagedWeight = isFinished ? randomFloat(currentWeight * 0.5, currentWeight * 0.85) : randomFloat(0, currentWeight * 0.4);
    const packageCount = isFinished ? Math.floor(Math.random() * 15) + 1 : Math.floor(Math.random() * 5);

    return {
      Id: 600000 + i,
      Name: `Harvest-${String(i + 1).padStart(3, '0')}-${randomChoice(STRAINS).replace(/\s+/g, '')}`,
      HarvestType: randomChoice(harvestTypes),
      SourceStrainNames: randomChoice(STRAINS),
      DryingLocationName: randomChoice(dryingLocations),
      PatientLicenseNumber: null,
      CurrentWeight: Math.round(currentWeight * 100) / 100,
      TotalWasteWeight: Math.round(wasteWeight * 100) / 100,
      TotalRestoredWeight: 0,
      PackageCount: packageCount,
      TotalPackagedWeight: Math.round(packagedWeight * 100) / 100,
      UnitOfWeightName: 'Grams',
      LabTestingState: randomChoice(LAB_STATES),
      LabTestingStateDate: randomDate(30),
      IsOnHold: isOnHold,
      HarvestStartDate: startDate.toISOString().split('T')[0],
      FinishedDate: isFinished ? randomDate(daysBack - 3) : null,
      ArchivedDate: null,
      LastModified: new Date().toISOString(),
    };
  });
}

function generateMockHarvestWaste(harvestId: number): MetrcHarvestWaste[] {
  const wasteTypes = ['Plant Material', 'Roots', 'Stalks', 'Trim Waste', 'Other'];
  const count = Math.floor(Math.random() * 3) + 1;
  return Array.from({ length: count }, (_, i) => ({
    Id: 700000 + harvestId * 10 + i,
    HarvestId: harvestId,
    WasteTypeName: randomChoice(wasteTypes),
    WasteWeight: randomFloat(10, 500),
    UnitOfWeightName: 'Grams',
    ActualDate: randomDate(30),
  }));
}

function generateMockPlantBatches(count: number = 40): MetrcPlantBatch[] {
  const batchTypes = ['Seed', 'Clone'];

  return Array.from({ length: count }, (_, i) => {
    const type = randomChoice(batchTypes);
    const totalCount = Math.floor(Math.random() * 200) + 10;
    const trackedCount = Math.floor(totalCount * (0.3 + Math.random() * 0.5));
    const untrackedCount = totalCount - trackedCount;
    const harvestedCount = Math.floor(Math.random() * trackedCount * 0.3);
    const packagedCount = Math.floor(Math.random() * 10);
    const destroyedCount = Math.floor(Math.random() * 5);

    return {
      Id: 800000 + i,
      Name: `Batch-${String(i + 1).padStart(3, '0')}-${randomChoice(STRAINS).replace(/\s+/g, '')}`,
      Type: type,
      StrainName: randomChoice(STRAINS),
      LocationName: randomChoice(LOCATIONS.slice(0, 5)),
      RoomName: randomChoice(LOCATIONS.slice(0, 5)),
      PatientLicenseNumber: null,
      Count: totalCount,
      UntrackedCount: untrackedCount,
      TrackedCount: trackedCount,
      PackagedCount: packagedCount,
      HarvestedCount: harvestedCount,
      DestroyedCount: destroyedCount,
      PlantedDate: randomDate(120),
      LastModified: new Date().toISOString(),
    };
  });
}

/** Exported labels for cross-mock reconciliation (Dutchie needs to reference real package labels) */
export const MOCK_PACKAGE_LABELS: string[] = Array.from({ length: 500 }, (_, i) => makeLabel(i + 1));

export class MetrcMockClient implements IMetrcClient {
  private packages: MetrcPackage[];
  private plants: MetrcPlant[];
  private transfers: MetrcTransfer[];
  private salesReceipts: MetrcSaleReceipt[];
  private harvests: MetrcHarvest[];
  private plantBatches: MetrcPlantBatch[];
  private strains: MetrcStrain[];
  private nextStrainId = 600000;
  private nextTransferId = 350000;
  private nextReceiptId = 430000;

  constructor() {
    this.transfers = generateMockTransfers(50);
    this.packages = generateMockPackages(500);
    this.plants = generateMockPlants(200);
    this.harvests = generateMockHarvests(30);
    this.plantBatches = generateMockPlantBatches(40);
    this.salesReceipts = Array.from({ length: 30 }, (_, i) => ({
      Id: 400000 + i,
      ReceiptNumber: `R${String(i + 1).padStart(6, '0')}`,
      SalesDateTime: randomDate(30),
      SalesCustomerType: randomChoice(['Consumer', 'Patient', 'Caregiver']),
      PatientLicenseNumber: null,
      TotalPackages: Math.floor(Math.random() * 5) + 1,
      TotalPrice: randomFloat(20, 500),
      LastModified: new Date().toISOString(),
    }));
    this.strains = STRAINS.map((name, i) => ({
      Id: 500000 + i,
      Name: name,
      TestingStatus: 'InHouse',
      ThcLevel: randomFloat(15, 30),
      CbdLevel: randomFloat(0.1, 5),
      IndicaPercentage: Math.floor(Math.random() * 100),
      SativaPercentage: 0,
    })).map((s) => ({ ...s, SativaPercentage: 100 - s.IndicaPercentage }));
    this.nextStrainId = 500000 + STRAINS.length;

    // Link ~20% of packages to actual incoming transfer manifest numbers
    // so that correlateTransfers() returns real results in dev mode.
    const incomingTransfers = this.transfers.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < this.packages.length; i++) {
      if (Math.random() < 0.2 && incomingTransfers.length > 0) {
        const transfer = incomingTransfers[Math.floor(Math.random() * incomingTransfers.length)]!;
        this.packages[i]!.ReceivedFromManifestNumber = transfer.ManifestNumber;
        this.packages[i]!.ReceivedFromFacilityName = transfer.ShipperFacilityName;
        this.packages[i]!.ReceivedFromFacilityLicenseNumber = transfer.ShipperFacilityLicenseNumber;
        this.packages[i]!.ReceivedDateTime = transfer.ReceivedDateTime ?? transfer.CreatedDateTime;
      }
    }
  }

  async getActivePlants(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlant[]> {
    return applyPagination(this.plants, pagination);
  }

  async getPlant(plantId: number): Promise<MetrcPlant> {
    const plant = this.plants.find((p) => p.Id === plantId);
    if (!plant) throw new Error(`Plant ${plantId} not found`);
    return plant;
  }

  async getActivePackages(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPackage[]> {
    return applyPagination(this.packages, pagination);
  }

  async getPackage(packageId: number): Promise<MetrcPackage> {
    const pkg = this.packages.find((p) => p.Id === packageId);
    if (!pkg) throw new Error(`Package ${packageId} not found`);
    return pkg;
  }

  async getPackageTypes(): Promise<string[]> {
    return ['Product', 'ImmaturePlant', 'VegetativePlant', 'PlantWaste', 'HarvestWaste'];
  }

  async getIncomingTransfers(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    return applyPagination(this.transfers.filter((_, i) => i % 2 === 0), pagination);
  }

  async getOutgoingTransfers(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    return applyPagination(this.transfers.filter((_, i) => i % 2 !== 0), pagination);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRejectedTransfers(filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcTransfer[]> {
    return [];
  }

  async getTransferDeliveries(transferId: number): Promise<MetrcDelivery[]> {
    const transfer = this.transfers.find(t => t.Id === transferId);
    if (!transfer) return [];
    const count = transfer.DeliveryCount || Math.floor(Math.random() * 3) + 1;
    const facilityNames = [
      'Green Valley Farms', 'Pacific Coast Cannabis', 'Sierra Extracts',
      'Bay Area Dispensary', 'Sacramento Distribution', 'Golden State Testing',
    ];
    const shipmentTypes = ['Wholesale', 'Transfer', 'Testing'];
    const routes = [
      'Sacramento → SF', 'Oakland → San Jose', 'LA → San Diego',
      'Denver → Boulder', 'Portland → Eugene',
    ];
    return Array.from({ length: count }, (_, i) => {
      const pkgCount = Math.max(1, Math.floor(transfer.PackageCount / count) + (i === 0 ? transfer.PackageCount % count : 0));
      return {
        Id: transferId * 100 + i + 1,
        RecipientFacilityLicenseNumber: transfer.ReceiverFacilityLicenseNumber,
        RecipientFacilityName: i === 0 ? transfer.ReceiverFacilityName : randomChoice(facilityNames),
        ShipmentTypeName: randomChoice(shipmentTypes),
        ShipmentTransactionType: 'Standard',
        EstimatedDepartureDateTime: transfer.EstimatedDepartureDateTime,
        EstimatedArrivalDateTime: transfer.EstimatedArrivalDateTime,
        ActualDepartureDateTime: transfer.ReceivedDateTime ? transfer.EstimatedDepartureDateTime : null,
        ActualArrivalDateTime: transfer.ReceivedDateTime,
        GrossWeight: randomFloat(500, 10000),
        GrossUnitOfWeightName: 'Grams',
        PlannedRoute: randomChoice(routes),
        ReceivedDateTime: transfer.ReceivedDateTime,
        ReceivedByName: transfer.ReceivedDateTime ? 'Manager' : null,
        TotalPackages: pkgCount,
        TotalPrice: randomFloat(1000, 50000),
      };
    });
  }

  async getDeliveryPackages(deliveryId: number): Promise<MetrcDeliveryPackage[]> {
    const count = Math.floor(Math.random() * 8) + 2;
    const shipmentStates = ['Shipped', 'Accepted', 'Rejected', 'Returned'];
    return Array.from({ length: count }, (_, i) => {
      const strain = randomChoice(STRAINS);
      const category = randomChoice(ITEM_CATEGORIES);
      const isWeight = ['Flower', 'Trim', 'Shake'].includes(category);
      return {
        PackageId: deliveryId * 1000 + i + 1,
        PackageLabel: makeLabel(deliveryId * 10 + i + 1),
        PackageType: 'Product',
        ItemName: `${strain} ${category}`,
        ItemStrainName: strain,
        ItemCategory: category,
        Quantity: isWeight ? randomFloat(50, 2000) : Math.floor(randomFloat(1, 200)),
        UnitOfMeasureName: isWeight ? 'Grams' : 'Each',
        GrossWeight: isWeight ? randomFloat(50, 2000) : null,
        GrossUnitOfWeightName: isWeight ? 'Grams' : null,
        WholesalePrice: randomFloat(100, 5000),
        ShipmentPackageState: randomChoice(shipmentStates),
        LabTestingState: randomChoice(LAB_STATES),
        RemediationDate: null,
      };
    });
  }

  async getSalesReceipts(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcSaleReceipt[]> {
    return applyPagination(this.salesReceipts, pagination);
  }

  async getLabTestResults(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcLabTest[]> {
    const results = this.packages.slice(0, 50).map((pkg) => ({
      PackageId: pkg.Id,
      PackageLabel: pkg.Label,
      TestPerformedDate: randomDate(30),
      OverallPassed: Math.random() > 0.1,
      TestTypeName: randomChoice(['Potency', 'Pesticides', 'Heavy Metals', 'Microbials', 'Residual Solvents', 'Terpenes']),
      TestResultLevel: randomFloat(0, 30),
      TestResultUnit: '%',
      LabFacilityName: randomChoice(['CannTest Labs', 'SC Labs', 'Encore Labs', 'Anresco']),
    }));
    return applyPagination(results, pagination);
  }

  async getActiveStrains(pagination?: MetrcPaginationParams): Promise<MetrcStrain[]> {
    return applyPagination(this.strains, pagination);
  }

  async getActiveItems(pagination?: MetrcPaginationParams): Promise<MetrcItem[]> {
    const items = this.packages.slice(0, 100).map((pkg) => ({
      Id: pkg.ItemId,
      Name: pkg.ItemName,
      ProductCategoryName: pkg.ItemCategory,
      ProductCategoryType: 'Marijuana',
      QuantityType: 'WeightBased',
      DefaultLabTestingState: 'NotRequired',
      UnitOfMeasureName: pkg.UnitOfMeasureName,
      StrainName: pkg.ItemStrainName,
    }));
    return applyPagination(items, pagination);
  }

  async getActiveLocations(pagination?: MetrcPaginationParams): Promise<MetrcLocation[]> {
    const locations: MetrcLocation[] = LOCATIONS.map((name, i) => ({
      Id: 750000 + i,
      Name: name,
      LocationTypeId: 1,
      LocationTypeName: 'Default Location Type',
    }));
    return applyPagination(locations, pagination);
  }

  // Plant Batches
  async getActivePlantBatches(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlantBatch[]> {
    return applyPagination(this.plantBatches.filter(b => b.Count > b.DestroyedCount), pagination);
  }

  async getInactivePlantBatches(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcPlantBatch[]> {
    return applyPagination(this.plantBatches.filter(b => b.Count <= b.DestroyedCount), pagination);
  }

  async getPlantBatch(plantBatchId: number): Promise<MetrcPlantBatch> {
    const batch = this.plantBatches.find(b => b.Id === plantBatchId);
    if (!batch) throw new Error(`Plant batch ${plantBatchId} not found`);
    return batch;
  }

  // Harvests
  async getActiveHarvests(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    return applyPagination(this.harvests.filter(h => !h.FinishedDate && !h.ArchivedDate), pagination);
  }

  async getOnHoldHarvests(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    return applyPagination(this.harvests.filter(h => h.IsOnHold), pagination);
  }

  async getInactiveHarvests(_filters?: Record<string, string>, pagination?: MetrcPaginationParams): Promise<MetrcHarvest[]> {
    return applyPagination(this.harvests.filter(h => !!h.FinishedDate || !!h.ArchivedDate), pagination);
  }

  async getHarvest(harvestId: number): Promise<MetrcHarvest> {
    const harvest = this.harvests.find(h => h.Id === harvestId);
    if (!harvest) throw new Error(`Harvest ${harvestId} not found`);
    return harvest;
  }

  async getHarvestWaste(harvestId: number): Promise<MetrcHarvestWaste[]> {
    const harvest = this.harvests.find(h => h.Id === harvestId);
    if (!harvest) throw new Error(`Harvest ${harvestId} not found`);
    return generateMockHarvestWaste(harvestId);
  }

  async getHarvestWasteTypes(): Promise<string[]> {
    return ['Plant Material', 'Roots', 'Stalks', 'Trim Waste', 'Other'];
  }

  // Write operations — Plant Batches (mock)
  async createPlantBatches(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} plant batches`);
  }

  async destroyPlantBatches(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Destroying ${data.length} plant batches`);
    for (const entry of data) {
      const batch = this.plantBatches.find(b => b.Id === entry.Id || b.Name === entry.PlantBatch);
      if (batch) {
        const count = (entry.Count as number) ?? 1;
        batch.DestroyedCount += count;
        batch.Count = Math.max(0, batch.Count - count);
        batch.LastModified = new Date().toISOString();
      }
    }
  }

  async changePlantBatchGrowthPhase(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Changing growth phase for ${data.length} plant batches`);
  }

  // Write operations — Packages (mock - just log)
  async adjustPackages(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Adjusting ${data.length} packages`);
    for (const adjustment of data) {
      const pkg = this.packages.find((p) => p.Label === adjustment.Label);
      if (pkg) {
        // Metrc adjustPackages treats Quantity as a delta (e.g., -5 means reduce by 5)
        const delta = (adjustment.Quantity as number) ?? 0;
        pkg.Quantity = Math.round((pkg.Quantity + delta) * 100) / 100;
        pkg.Note = (adjustment.AdjustmentReason as string) ?? pkg.Note;
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  async createPackages(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} packages`);
  }

  async finishPackages(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Finishing ${data.length} packages`);
    for (const finish of data) {
      const pkg = this.packages.find((p) => p.Label === finish.Label);
      if (pkg) {
        pkg.FinishedDate = new Date().toISOString().split('T')[0];
      }
    }
  }

  async changePackageNote(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Changing note on ${data.length} packages`);
    for (const entry of data) {
      const pkg = this.packages.find((p) => p.Label === entry.Label);
      if (pkg) {
        pkg.Note = (entry.Note as string) ?? pkg.Note;
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  async remediatePackages(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Remediating ${data.length} packages`);
    for (const entry of data) {
      const pkg = this.packages.find((p) => p.Label === entry.Label);
      if (pkg) {
        pkg.ContainsRemediatedProduct = true;
        pkg.RemediationDate = new Date().toISOString().split('T')[0];
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  // Write operations — Processing (mock)
  async createProcessingPackages(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} processing packages (package-to-package)`);
  }

  // Write operations — Harvests (mock)
  async finishHarvests(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Finishing ${data.length} harvests`);
    for (const entry of data) {
      const harvest = this.harvests.find(h => h.Id === entry.Id);
      if (harvest) {
        harvest.FinishedDate = new Date().toISOString().split('T')[0];
        harvest.LastModified = new Date().toISOString();
      }
    }
  }

  async createPackagesFromHarvest(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} packages from harvest`);
    for (const entry of data) {
      const harvest = this.harvests.find(h => h.Id === entry.HarvestId);
      if (harvest) {
        harvest.PackageCount += 1;
        harvest.LastModified = new Date().toISOString();
      }
    }
  }

  async recordHarvestWaste(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Recording waste for ${data.length} harvest waste entries`);
    for (const entry of data) {
      // v2 API uses `Id` (not `HarvestId`)
      const harvestId = entry.Id ?? entry.HarvestId;
      const harvest = this.harvests.find(h => h.Id === harvestId);
      if (harvest) {
        harvest.TotalWasteWeight += (entry.WasteWeight as number) ?? 0;
        harvest.LastModified = new Date().toISOString();
      }
    }
  }

  // Write operations — Strains (mock)
  async createStrains(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} strains`);
    for (const entry of data) {
      const indica = (entry.IndicaPercentage as number) ?? 0;
      this.strains.push({
        Id: this.nextStrainId++,
        Name: (entry.Name as string) ?? 'Unknown',
        TestingStatus: (entry.TestingStatus as string) ?? 'None',
        ThcLevel: (entry.ThcLevel as number) ?? 0,
        CbdLevel: (entry.CbdLevel as number) ?? 0,
        IndicaPercentage: indica,
        SativaPercentage: (entry.SativaPercentage as number) ?? (100 - indica),
      });
    }
  }

  async updateStrains(data: Record<string, unknown>[]): Promise<void> {
    for (const entry of data) {
      const strain = this.strains.find(s => s.Id === (entry.Id as number));
      if (strain) {
        if (entry.Name != null) strain.Name = entry.Name as string;
        if (entry.IndicaPercentage != null) strain.IndicaPercentage = entry.IndicaPercentage as number;
        if (entry.SativaPercentage != null) strain.SativaPercentage = entry.SativaPercentage as number;
        if (entry.ThcLevel != null) strain.ThcLevel = entry.ThcLevel as number;
        if (entry.CbdLevel != null) strain.CbdLevel = entry.CbdLevel as number;
      }
    }
  }

  // Write operations — Items (mock)
  async createItems(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} items`);
  }

  async updateItems(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Updating ${data.length} items`);
  }

  // Write operations — Locations (mock)
  async createLocations(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} locations`);
  }

  async changePackageLocations(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Changing location for ${data.length} packages`);
    const locations = await this.getActiveLocations();
    for (const entry of data) {
      const pkg = this.packages.find(p => p.Label === entry.Label);
      if (pkg) {
        const loc = locations.find(l => l.Id === (entry.LocationId as number));
        pkg.LocationName = loc?.Name ?? `Location-${entry.LocationId}`;
        pkg.RoomName = pkg.LocationName;
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  // Write operations — Transfers (mock)
  async createExternalIncomingTransfers(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} external incoming transfers`);
  }

  async createExternalOutgoingTransfers(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} external outgoing transfers`);
    for (const entry of data) {
      const pkgs = (entry.Packages as Array<Record<string, unknown>>) ?? [];
      const id = this.nextTransferId++;
      this.transfers.push({
        Id: id,
        ManifestNumber: `M${String(id).padStart(6, '0')}`,
        ShipperFacilityLicenseNumber: 'MOCK-SHIPPER-LIC',
        ShipperFacilityName: 'Mock Facility',
        TransporterFacilityLicenseNumber: '',
        TransporterFacilityName: '',
        ReceiverFacilityLicenseNumber: (entry.RecipientFacilityLicenseNumber as string) ?? 'MOCK-RECEIVER-LIC',
        ReceiverFacilityName: 'Mock Receiver',
        DeliveryCount: 1,
        ReceivedDeliveryCount: 0,
        PackageCount: pkgs.length,
        ReceivedPackageCount: 0,
        ContainsDonation: false,
        ContainsTradeSample: false,
        ContainsTestingSample: false,
        CreatedDateTime: new Date().toISOString(),
        CreatedByUserName: 'mock@facility.com',
        LastModified: new Date().toISOString(),
        EstimatedDepartureDateTime: (entry.EstimatedDepartureDateTime as string) ?? new Date().toISOString(),
        EstimatedArrivalDateTime: (entry.EstimatedArrivalDateTime as string) ?? new Date().toISOString(),
        ReceivedDateTime: null,
      });
    }
  }

  // Write operations — Sales (mock)
  async createSalesReceipts(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Creating ${data.length} sales receipts`);
    for (const entry of data) {
      const transactions = (entry.Transactions as Array<Record<string, unknown>>) ?? [];
      this.salesReceipts.push({
        Id: this.nextReceiptId++,
        ReceiptNumber: `R${String(this.nextReceiptId).padStart(6, '0')}`,
        SalesDateTime: (entry.SalesDateTime as string) ?? new Date().toISOString(),
        SalesCustomerType: (entry.SalesCustomerType as string) ?? 'Consumer',
        PatientLicenseNumber: (entry.PatientLicenseNumber as string) || null,
        TotalPackages: transactions.length,
        TotalPrice: transactions.reduce((sum, t) => sum + ((t.TotalAmount as number) ?? 0), 0),
        LastModified: new Date().toISOString(),
      });
    }
  }

  // Write operations — Submit for Testing (mock)
  async submitPackagesForTesting(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Submitting ${data.length} packages for lab testing`);
    for (const entry of data) {
      const sourceLabel = entry.SourcePackageLabels as string;
      const pkg = this.packages.find(p => p.Label === sourceLabel);
      if (pkg) {
        pkg.LabTestingState = 'SubmittedForTesting';
        pkg.LabTestingStateDate = new Date().toISOString().split('T')[0];
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  // Write operations — Lab Tests (mock)
  async recordLabTests(data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Recording ${data.length} lab test results`);
    for (const entry of data) {
      const label = entry.PackageLabel as string;
      const pkg = this.packages.find(p => p.Label === label);
      if (pkg) {
        const passed = entry.OverallPassed as boolean;
        pkg.LabTestingState = passed ? 'TestPassed' : 'TestFailed';
        pkg.LastModified = new Date().toISOString();
      }
    }
  }

  // Waste & Loss (mock)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPlantBatchWaste(_licenseNumber: string): Promise<MetrcPlantBatchWaste[]> {
    const wasteReasons = ['Contamination', 'Mold/Mildew', 'Pest Damage', 'Male Plants', 'Other'];
    const records: MetrcPlantBatchWaste[] = [];
    for (const batch of this.plantBatches.slice(0, 15)) {
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        records.push({
          Id: 950000 + batch.Id * 10 + i,
          PlantBatchId: batch.Id,
          PlantBatchName: batch.Name,
          WasteReasonName: randomChoice(wasteReasons),
          WasteWeight: randomFloat(5, 200),
          UnitOfWeightName: 'Grams',
          ActualDate: randomDate(60),
          LastModified: new Date().toISOString(),
        });
      }
    }
    return records;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPlantBatchWasteReasons(_licenseNumber: string): Promise<MetrcWasteReason[]> {
    return [
      { Name: 'Contamination' },
      { Name: 'Mold/Mildew' },
      { Name: 'Pest Damage' },
      { Name: 'Male Plants' },
      { Name: 'Other' },
    ];
  }

  async recordPlantBatchWaste(_licenseNumber: string, data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Recording plant batch waste for ${data.length} entries`);
    for (const entry of data) {
      const batch = this.plantBatches.find(b => b.Id === entry.PlantBatchId || b.Name === entry.PlantBatchName);
      if (batch) {
        const count = (entry.Count as number) ?? 1;
        batch.DestroyedCount += count;
        batch.LastModified = new Date().toISOString();
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPackageAdjustReasons(_licenseNumber: string): Promise<MetrcPackageAdjustReason[]> {
    return [
      { Name: 'Theft', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Moisture Loss', RequiresNote: false, RequiresWasteWeight: true, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Damage/Spillage', RequiresNote: true, RequiresWasteWeight: true, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Scale Variance', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Inventory Audit', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Processing Loss', RequiresNote: false, RequiresWasteWeight: true, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false },
      { Name: 'Waste', RequiresNote: true, RequiresWasteWeight: true, RequiresImmatureWasteWeight: true, RequiresMatureWasteWeight: true },
    ];
  }

  async getPlantWasteMethods(): Promise<MetrcWasteMethod[]> {
    return [
      { Name: 'Grinder', ForPlants: true, ForProductDestruction: true, LastModified: new Date().toISOString() },
      { Name: 'Compost', ForPlants: true, ForProductDestruction: false, LastModified: new Date().toISOString() },
      { Name: 'Incinerator', ForPlants: true, ForProductDestruction: true, LastModified: new Date().toISOString() },
      { Name: 'Render Unusable', ForPlants: true, ForProductDestruction: true, LastModified: new Date().toISOString() },
    ];
  }

  async deleteHarvestWaste(_licenseNumber: string, wasteId: number): Promise<void> {
    console.log(`[MOCK] Deleting harvest waste record ${wasteId}`);
    // Find the harvest that owns this waste and reduce its TotalWasteWeight
    for (const harvest of this.harvests) {
      const wasteRecords = generateMockHarvestWaste(harvest.Id);
      const record = wasteRecords.find(w => w.Id === wasteId);
      if (record) {
        harvest.TotalWasteWeight = Math.max(0, harvest.TotalWasteWeight - record.WasteWeight);
        harvest.LastModified = new Date().toISOString();
        break;
      }
    }
  }

  async destroyPlants(_licenseNumber: string, data: Record<string, unknown>[]): Promise<void> {
    console.log(`[MOCK] Destroying ${data.length} plants`);
    for (const entry of data) {
      const plant = this.plants.find(p => p.Id === (entry.Id as number));
      if (plant) {
        plant.DestroyedDate = new Date().toISOString().split('T')[0];
        plant.State = 'Destroyed';
      }
    }
  }

  // Tags (mock)
  async getAvailableTags(pagination?: MetrcPaginationParams): Promise<MetrcTag[]> {
    const tags: MetrcTag[] = Array.from({ length: 200 }, (_, i) => ({
      Id: 900000 + i,
      Label: `1A4FF0000000000${String(i + 1).padStart(6, '0')}`,
      TagTypeName: 'CannabisPackage',
      StatusName: 'Available',
      UsedDateTime: null,
    }));
    return applyPagination(tags, pagination);
  }
}
