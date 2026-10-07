import type { MetrcPackage, MetrcPlant } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface StrainYield {
  strainName: string;
  totalPlants: number;
  growthPhases: Record<string, number>;
  totalPackageQuantity: number;
  packageCount: number;
  averageQuantityPerPackage: number;
  unitOfMeasure: string;
  estimatedYieldPerPlant: number;
  categories: { category: string; quantity: number; count: number }[];
}

export interface YieldAnalysis {
  strains: StrainYield[];
  topYieldingStrains: { strainName: string; estimatedYieldPerPlant: number }[];
  totalPlants: number;
  totalPackages: number;
  overallAverageYieldPerPlant: number;
}

export interface LossAnalysis {
  zeroQuantityPackages: number;
  nearZeroPackages: number;
  failedTestingPackages: number;
  onHoldPackages: number;
  remediationRequired: number;
  totalLossPackages: number;
  lossPercentage: number;
  byCategory: {
    category: string;
    lossCount: number;
    totalCount: number;
    lossPercentage: number;
  }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEIGHT_UNITS = ['Grams', 'Ounces'];
const TOP_STRAINS_LIMIT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWeightBased(pkg: MetrcPackage): boolean {
  return WEIGHT_UNITS.indexOf(pkg.UnitOfMeasureName) !== -1;
}

function isLossPackage(pkg: MetrcPackage): boolean {
  if (pkg.Quantity === 0) return true;
  if (isNearZero(pkg)) return true;
  if (isFailedTesting(pkg)) return true;
  if (pkg.IsOnHold) return true;
  if (pkg.ProductRequiresRemediation) return true;
  return false;
}

function isNearZero(pkg: MetrcPackage): boolean {
  // quantity < 1 regardless of unit (Grams or Each)
  return pkg.Quantity > 0 && pkg.Quantity < 1;
}

function isFailedTesting(pkg: MetrcPackage): boolean {
  return (
    pkg.LabTestingState === 'TestFailed' ||
    pkg.LabTestingState === 'LabTestFailed'
  );
}

// ---------------------------------------------------------------------------
// analyzeYieldsByStrain
// ---------------------------------------------------------------------------

export function analyzeYieldsByStrain(
  packages: MetrcPackage[],
  plants: MetrcPlant[],
): YieldAnalysis {
  // -- Group plants by strain -----------------------------------------------
  const plantsByStrain = new Map<string, MetrcPlant[]>();
  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];
    const strain = plant.StrainName || 'Unknown';
    const existing = plantsByStrain.get(strain);
    if (existing) {
      existing.push(plant);
    } else {
      plantsByStrain.set(strain, [plant]);
    }
  }

  // -- Filter to weight-based packages and group by strain ------------------
  const weightPackages: MetrcPackage[] = [];
  for (let p = 0; p < packages.length; p++) {
    if (isWeightBased(packages[p])) {
      weightPackages.push(packages[p]);
    }
  }

  const packagesByStrain = new Map<string, MetrcPackage[]>();
  for (let j = 0; j < weightPackages.length; j++) {
    const pkg = weightPackages[j];
    const pkgStrain = pkg.ItemStrainName || 'Unknown';
    const existingPkgs = packagesByStrain.get(pkgStrain);
    if (existingPkgs) {
      existingPkgs.push(pkg);
    } else {
      packagesByStrain.set(pkgStrain, [pkg]);
    }
  }

  // -- Collect all strain names from both sources ---------------------------
  const allStrainNames = new Set<string>();
  const plantStrainEntries = Array.from(plantsByStrain.keys());
  for (let si = 0; si < plantStrainEntries.length; si++) {
    allStrainNames.add(plantStrainEntries[si]);
  }
  const pkgStrainEntries = Array.from(packagesByStrain.keys());
  for (let sk = 0; sk < pkgStrainEntries.length; sk++) {
    allStrainNames.add(pkgStrainEntries[sk]);
  }

  // -- Build per-strain yield records ---------------------------------------
  const strains: StrainYield[] = [];
  const strainNameList = Array.from(allStrainNames);

  for (let sn = 0; sn < strainNameList.length; sn++) {
    const name = strainNameList[sn];
    const strainPlants = plantsByStrain.get(name) || [];
    const strainPackages = packagesByStrain.get(name) || [];

    // Growth phases
    const phaseMap = new Map<string, number>();
    for (let pi = 0; pi < strainPlants.length; pi++) {
      const phase = strainPlants[pi].GrowthPhase || 'Unknown';
      phaseMap.set(phase, (phaseMap.get(phase) || 0) + 1);
    }
    const growthPhases: Record<string, number> = {};
    const phaseEntries = Array.from(phaseMap.entries());
    for (let pe = 0; pe < phaseEntries.length; pe++) {
      growthPhases[phaseEntries[pe][0]] = phaseEntries[pe][1];
    }

    // Package quantity totals
    let totalPackageQuantity = 0;
    for (let qi = 0; qi < strainPackages.length; qi++) {
      totalPackageQuantity += strainPackages[qi].Quantity;
    }

    const packageCount = strainPackages.length;
    const averageQuantityPerPackage =
      packageCount > 0 ? totalPackageQuantity / packageCount : 0;

    // Determine dominant unit of measure
    let unitOfMeasure = 'Grams';
    if (strainPackages.length > 0) {
      unitOfMeasure = strainPackages[0].UnitOfMeasureName;
    }

    // Estimated yield per plant
    const estimatedYieldPerPlant =
      strainPlants.length > 0
        ? totalPackageQuantity / strainPlants.length
        : 0;

    // Categories breakdown
    const categoryMap = new Map<string, { quantity: number; count: number }>();
    for (let ci = 0; ci < strainPackages.length; ci++) {
      const cat = strainPackages[ci].ItemCategory || 'Uncategorized';
      const catEntry = categoryMap.get(cat);
      if (catEntry) {
        catEntry.quantity += strainPackages[ci].Quantity;
        catEntry.count += 1;
      } else {
        categoryMap.set(cat, {
          quantity: strainPackages[ci].Quantity,
          count: 1,
        });
      }
    }
    const categories: { category: string; quantity: number; count: number }[] = [];
    const catEntries = Array.from(categoryMap.entries());
    for (let ce = 0; ce < catEntries.length; ce++) {
      categories.push({
        category: catEntries[ce][0],
        quantity: catEntries[ce][1].quantity,
        count: catEntries[ce][1].count,
      });
    }

    strains.push({
      strainName: name,
      totalPlants: strainPlants.length,
      growthPhases: growthPhases,
      totalPackageQuantity: totalPackageQuantity,
      packageCount: packageCount,
      averageQuantityPerPackage: averageQuantityPerPackage,
      unitOfMeasure: unitOfMeasure,
      estimatedYieldPerPlant: estimatedYieldPerPlant,
      categories: categories,
    });
  }

  // -- Top yielding strains (top 5 by estimatedYieldPerPlant) ---------------
  const sorted = strains.slice().sort(function (a, b) {
    return b.estimatedYieldPerPlant - a.estimatedYieldPerPlant;
  });
  const topYieldingStrains: { strainName: string; estimatedYieldPerPlant: number }[] = [];
  const topCount = Math.min(TOP_STRAINS_LIMIT, sorted.length);
  for (let ti = 0; ti < topCount; ti++) {
    topYieldingStrains.push({
      strainName: sorted[ti].strainName,
      estimatedYieldPerPlant: sorted[ti].estimatedYieldPerPlant,
    });
  }

  // -- Aggregate totals -----------------------------------------------------
  const totalPlants = plants.length;
  const totalPackages = weightPackages.length;
  let totalYield = 0;
  for (let yi = 0; yi < weightPackages.length; yi++) {
    totalYield += weightPackages[yi].Quantity;
  }
  const overallAverageYieldPerPlant =
    totalPlants > 0 ? totalYield / totalPlants : 0;

  return {
    strains: strains,
    topYieldingStrains: topYieldingStrains,
    totalPlants: totalPlants,
    totalPackages: totalPackages,
    overallAverageYieldPerPlant: overallAverageYieldPerPlant,
  };
}

// ---------------------------------------------------------------------------
// analyzeLossPoints
// ---------------------------------------------------------------------------

export function analyzeLossPoints(packages: MetrcPackage[]): LossAnalysis {
  let zeroQuantityPackages = 0;
  let nearZeroPackages = 0;
  let failedTestingPackages = 0;
  let onHoldPackages = 0;
  let remediationRequired = 0;

  // Per-category tracking
  const categoryTotals = new Map<string, number>();
  const categoryLosses = new Map<string, number>();

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const category = pkg.ItemCategory || 'Uncategorized';

    // Track totals per category
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + 1);

    // Count individual loss conditions (a package can match multiple)
    if (pkg.Quantity === 0) {
      zeroQuantityPackages++;
    }
    if (isNearZero(pkg)) {
      nearZeroPackages++;
    }
    if (isFailedTesting(pkg)) {
      failedTestingPackages++;
    }
    if (pkg.IsOnHold) {
      onHoldPackages++;
    }
    if (pkg.ProductRequiresRemediation) {
      remediationRequired++;
    }

    // Track category losses (a package counts as loss once per category)
    if (isLossPackage(pkg)) {
      categoryLosses.set(category, (categoryLosses.get(category) || 0) + 1);
    }
  }

  // Count unique loss packages (each package counted once)
  let totalLossPackages = 0;
  for (let li = 0; li < packages.length; li++) {
    if (isLossPackage(packages[li])) {
      totalLossPackages++;
    }
  }

  const lossPercentage =
    packages.length > 0 ? (totalLossPackages / packages.length) * 100 : 0;

  // Build category breakdown
  const byCategory: {
    category: string;
    lossCount: number;
    totalCount: number;
    lossPercentage: number;
  }[] = [];

  const catTotalEntries = Array.from(categoryTotals.entries());
  for (let ci = 0; ci < catTotalEntries.length; ci++) {
    const catName = catTotalEntries[ci][0];
    const totalCount = catTotalEntries[ci][1];
    const lossCount = categoryLosses.get(catName) || 0;
    byCategory.push({
      category: catName,
      lossCount: lossCount,
      totalCount: totalCount,
      lossPercentage: totalCount > 0 ? (lossCount / totalCount) * 100 : 0,
    });
  }

  return {
    zeroQuantityPackages: zeroQuantityPackages,
    nearZeroPackages: nearZeroPackages,
    failedTestingPackages: failedTestingPackages,
    onHoldPackages: onHoldPackages,
    remediationRequired: remediationRequired,
    totalLossPackages: totalLossPackages,
    lossPercentage: lossPercentage,
    byCategory: byCategory,
  };
}
