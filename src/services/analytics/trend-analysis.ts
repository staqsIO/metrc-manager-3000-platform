import { type MetrcPackage, calculateAgeDays } from '@/services/metrc/types';

// ---- Interfaces ----

export interface CategoryDistributionEntry {
  category: string;
  count: number;
  totalQuantity: number;
  unitOfMeasure: string;
  percentage: number;
}

export interface AgingVelocity {
  averageAgeDays: number;
  medianAgeDays: number;
  packagesOver60Days: number;
  packagesOver90Days: number;
  percentOver60: number;
  percentOver90: number;
}

export interface RecentActivity {
  packagesLast7Days: number;
  packagesLast30Days: number;
  avgQuantityLast30Days: number;
}

export interface LocationDistributionEntry {
  location: string;
  count: number;
  totalQuantity: number;
}

export interface LabTestingBreakdownEntry {
  state: string;
  count: number;
  percentage: number;
}

export interface InventoryTrends {
  totalPackages: number;
  totalQuantityByUnit: Record<string, number>;
  categoryDistribution: CategoryDistributionEntry[];
  agingVelocity: AgingVelocity;
  recentActivity: RecentActivity;
  locationDistribution: LocationDistributionEntry[];
  labTestingBreakdown: LabTestingBreakdownEntry[];
}

export interface Anomaly {
  type: 'unusual_quantity' | 'location_concentration' | 'testing_gap' | 'hold_cluster';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  affectedPackages: number;
  metadata?: Record<string, unknown>;
}

// ---- Helper functions ----

function computeMedian(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[mid];
  }
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ---- Main analysis functions ----

export function analyzeInventoryTrends(packages: MetrcPackage[]): InventoryTrends {
  const totalPackages = packages.length;

  // Total quantity by unit of measure
  const totalQuantityByUnit: Record<string, number> = {};
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const unit = pkg.UnitOfMeasureName;
    if (totalQuantityByUnit[unit] === undefined) {
      totalQuantityByUnit[unit] = 0;
    }
    totalQuantityByUnit[unit] += pkg.Quantity;
  }

  // Category distribution
  const categoryMap = new Map<string, { count: number; totalQuantity: number; unitOfMeasure: string }>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const category = pkg.ItemCategory;
    const existing = categoryMap.get(category);
    if (existing) {
      existing.count += 1;
      existing.totalQuantity += pkg.Quantity;
    } else {
      categoryMap.set(category, {
        count: 1,
        totalQuantity: pkg.Quantity,
        unitOfMeasure: pkg.UnitOfMeasureName,
      });
    }
  }
  const categoryDistribution: CategoryDistributionEntry[] = Array.from(categoryMap.entries()).map(
    function (entry) {
      const category = entry[0];
      const data = entry[1];
      return {
        category: category,
        count: data.count,
        totalQuantity: roundTo(data.totalQuantity, 2),
        unitOfMeasure: data.unitOfMeasure,
        percentage: totalPackages > 0 ? roundTo((data.count / totalPackages) * 100, 1) : 0,
      };
    }
  );
  categoryDistribution.sort(function (a, b) {
    return b.count - a.count;
  });

  // Aging velocity
  const ageDaysArray: number[] = packages.map(function (pkg) {
    return calculateAgeDays(pkg.PackagedDate);
  });
  const sortedAges = ageDaysArray.slice().sort(function (a, b) {
    return a - b;
  });
  let totalAgeDays = 0;
  let over60 = 0;
  let over90 = 0;
  for (let i = 0; i < ageDaysArray.length; i++) {
    totalAgeDays += ageDaysArray[i];
    if (ageDaysArray[i] > 60) over60++;
    if (ageDaysArray[i] > 90) over90++;
  }
  const agingVelocity: AgingVelocity = {
    averageAgeDays: totalPackages > 0 ? roundTo(totalAgeDays / totalPackages, 1) : 0,
    medianAgeDays: computeMedian(sortedAges),
    packagesOver60Days: over60,
    packagesOver90Days: over90,
    percentOver60: totalPackages > 0 ? roundTo((over60 / totalPackages) * 100, 1) : 0,
    percentOver90: totalPackages > 0 ? roundTo((over90 / totalPackages) * 100, 1) : 0,
  };

  // Recent activity
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let packagesLast7Days = 0;
  let packagesLast30Days = 0;
  let quantityLast30Days = 0;
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const packagedDate = new Date(pkg.PackagedDate);
    if (packagedDate >= sevenDaysAgo) {
      packagesLast7Days++;
    }
    if (packagedDate >= thirtyDaysAgo) {
      packagesLast30Days++;
      quantityLast30Days += pkg.Quantity;
    }
  }
  const recentActivity: RecentActivity = {
    packagesLast7Days: packagesLast7Days,
    packagesLast30Days: packagesLast30Days,
    avgQuantityLast30Days:
      packagesLast30Days > 0 ? roundTo(quantityLast30Days / packagesLast30Days, 2) : 0,
  };

  // Location distribution
  const locationMap = new Map<string, { count: number; totalQuantity: number }>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const location = pkg.LocationName || 'Unassigned';
    const existingLoc = locationMap.get(location);
    if (existingLoc) {
      existingLoc.count += 1;
      existingLoc.totalQuantity += pkg.Quantity;
    } else {
      locationMap.set(location, { count: 1, totalQuantity: pkg.Quantity });
    }
  }
  const locationDistribution: LocationDistributionEntry[] = Array.from(locationMap.entries()).map(
    function (entry) {
      return {
        location: entry[0],
        count: entry[1].count,
        totalQuantity: roundTo(entry[1].totalQuantity, 2),
      };
    }
  );
  locationDistribution.sort(function (a, b) {
    return b.count - a.count;
  });

  // Lab testing breakdown
  const labMap = new Map<string, number>();
  for (let i = 0; i < packages.length; i++) {
    const state = packages[i].LabTestingState || 'Unknown';
    const current = labMap.get(state);
    labMap.set(state, (current || 0) + 1);
  }
  const labTestingBreakdown: LabTestingBreakdownEntry[] = Array.from(labMap.entries()).map(
    function (entry) {
      return {
        state: entry[0],
        count: entry[1],
        percentage: totalPackages > 0 ? roundTo((entry[1] / totalPackages) * 100, 1) : 0,
      };
    }
  );
  labTestingBreakdown.sort(function (a, b) {
    return b.count - a.count;
  });

  return {
    totalPackages: totalPackages,
    totalQuantityByUnit: totalQuantityByUnit,
    categoryDistribution: categoryDistribution,
    agingVelocity: agingVelocity,
    recentActivity: recentActivity,
    locationDistribution: locationDistribution,
    labTestingBreakdown: labTestingBreakdown,
  };
}

export function detectAnomalies(packages: MetrcPackage[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (packages.length === 0) {
    return anomalies;
  }

  // --- unusual_quantity: packages with quantity > 3 std devs from category mean ---
  const categoryQuantities = new Map<string, number[]>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const cat = pkg.ItemCategory;
    let quantities = categoryQuantities.get(cat);
    if (!quantities) {
      quantities = [];
      categoryQuantities.set(cat, quantities);
    }
    quantities.push(pkg.Quantity);
  }

  let unusualQuantityPackages = 0;
  const unusualCategories: string[] = [];

  Array.from(categoryQuantities.entries()).forEach(function (entry) {
    const category = entry[0];
    const quantities = entry[1];
    if (quantities.length < 2) return;

    let sum = 0;
    for (let j = 0; j < quantities.length; j++) {
      sum += quantities[j];
    }
    const mean = sum / quantities.length;

    let varianceSum = 0;
    for (let j = 0; j < quantities.length; j++) {
      const diff = quantities[j] - mean;
      varianceSum += diff * diff;
    }
    const stdDev = Math.sqrt(varianceSum / quantities.length);

    if (stdDev === 0) return;

    const threshold = mean + 3 * stdDev;
    let outlierCount = 0;
    for (let j = 0; j < quantities.length; j++) {
      if (quantities[j] > threshold) {
        outlierCount++;
      }
    }

    if (outlierCount > 0) {
      unusualQuantityPackages += outlierCount;
      unusualCategories.push(category);
    }
  });

  if (unusualQuantityPackages > 0) {
    anomalies.push({
      type: 'unusual_quantity',
      severity: unusualQuantityPackages >= 5 ? 'critical' : 'warning',
      title: 'Unusual package quantities detected',
      description:
        unusualQuantityPackages +
        ' package(s) have quantities more than 3 standard deviations above the category mean in: ' +
        unusualCategories.join(', '),
      affectedPackages: unusualQuantityPackages,
      metadata: {
        categories: unusualCategories,
      },
    });
  }

  // --- location_concentration: any location with >40% of all packages ---
  const locationCounts = new Map<string, number>();
  for (let i = 0; i < packages.length; i++) {
    const loc = packages[i].LocationName || 'Unassigned';
    const count = locationCounts.get(loc);
    locationCounts.set(loc, (count || 0) + 1);
  }

  Array.from(locationCounts.entries()).forEach(function (entry) {
    const location = entry[0];
    const count = entry[1];
    const percentage = (count / packages.length) * 100;

    if (percentage > 40) {
      anomalies.push({
        type: 'location_concentration',
        severity: percentage > 70 ? 'critical' : 'warning',
        title: 'High concentration of packages in single location',
        description:
          roundTo(percentage, 1) +
          '% of all packages (' +
          count +
          ') are concentrated in "' +
          location +
          '"',
        affectedPackages: count,
        metadata: {
          location: location,
          percentage: roundTo(percentage, 1),
        },
      });
    }
  });

  // --- testing_gap: >20% of packages not submitted for testing after 14+ days ---
  let untestedOldPackages = 0;
  const notSubmittedStates = new Set<string>(['NotSubmitted', 'NotRequired']);

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const ageDays = calculateAgeDays(pkg.PackagedDate);
    if (ageDays >= 14 && notSubmittedStates.has(pkg.LabTestingState)) {
      untestedOldPackages++;
    }
  }

  const untestedPercentage = packages.length > 0 ? (untestedOldPackages / packages.length) * 100 : 0;
  if (untestedPercentage > 20) {
    anomalies.push({
      type: 'testing_gap',
      severity: untestedPercentage > 50 ? 'critical' : 'warning',
      title: 'Significant testing gap detected',
      description:
        roundTo(untestedPercentage, 1) +
        '% of packages (' +
        untestedOldPackages +
        ') have not been submitted for testing after 14+ days',
      affectedPackages: untestedOldPackages,
      metadata: {
        percentage: roundTo(untestedPercentage, 1),
        daysThreshold: 14,
      },
    });
  }

  // --- hold_cluster: 3+ packages on hold in the same location ---
  const holdByLocation = new Map<string, number>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    if (pkg.IsOnHold) {
      const loc = pkg.LocationName || 'Unassigned';
      const current = holdByLocation.get(loc);
      holdByLocation.set(loc, (current || 0) + 1);
    }
  }

  Array.from(holdByLocation.entries()).forEach(function (entry) {
    const location = entry[0];
    const count = entry[1];
    if (count >= 3) {
      anomalies.push({
        type: 'hold_cluster',
        severity: count >= 10 ? 'critical' : count >= 5 ? 'warning' : 'info',
        title: 'Cluster of held packages in single location',
        description:
          count + ' packages are on hold in "' + location + '", which may indicate a systemic issue',
        affectedPackages: count,
        metadata: {
          location: location,
        },
      });
    }
  });

  return anomalies;
}
