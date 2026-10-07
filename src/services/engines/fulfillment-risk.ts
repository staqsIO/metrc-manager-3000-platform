import type { MetrcPackage, MetrcTransfer } from '@/services/metrc/types';
import { calculateAgeDays } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CategoryStock {
  category: string;
  packageCount: number;
  totalQuantity: number;
  unitOfMeasure: string;
  averageAge: number;
  expiringWithin30Days: number;
  onHoldCount: number;
  availableQuantity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface FulfillmentRisk {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  category: string;
  affectedPackages: number;
  metric: number;
}

export interface TransferVelocity {
  period: string;
  outgoingCount: number;
  outgoingPackages: number;
  incomingCount: number;
  incomingPackages: number;
  netFlow: number;
}

export interface FulfillmentAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  categoryStock: CategoryStock[];
  risks: FulfillmentRisk[];
  transferVelocity: TransferVelocity[];
  summary: {
    totalAvailablePackages: number;
    totalOnHold: number;
    totalExpiringSoon: number;
    categoriesAtRisk: number;
    lowStockCategories: string[];
  };
}

// ---------------------------------------------------------------------------
// assessFulfillmentRisk
// ---------------------------------------------------------------------------

export function assessFulfillmentRisk(
  packages: MetrcPackage[],
  outgoingTransfers: MetrcTransfer[],
  incomingTransfers: MetrcTransfer[],
): FulfillmentAssessment {
  // Build category stock analysis
  const categoryMap = new Map<string, {
    count: number;
    totalQty: number;
    unit: string;
    ageDaysSum: number;
    expiring30: number;
    onHold: number;
    availableQty: number;
  }>();

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const category = pkg.ItemCategory;
    const ageDays = calculateAgeDays(pkg.PackagedDate);
    const isAvailable = !pkg.IsOnHold && pkg.Quantity > 0;

    const existing = categoryMap.get(category);
    if (existing) {
      existing.count += 1;
      existing.totalQty += pkg.Quantity;
      existing.ageDaysSum += ageDays;
      if (ageDays > 150) existing.expiring30 += 1; // Approaching 180-day limit
      if (pkg.IsOnHold) existing.onHold += 1;
      if (isAvailable) existing.availableQty += pkg.Quantity;
    } else {
      categoryMap.set(category, {
        count: 1,
        totalQty: pkg.Quantity,
        unit: pkg.UnitOfMeasureName,
        ageDaysSum: ageDays,
        expiring30: ageDays > 150 ? 1 : 0,
        onHold: pkg.IsOnHold ? 1 : 0,
        availableQty: isAvailable ? pkg.Quantity : 0,
      });
    }
  }

  const categoryStock: CategoryStock[] = [];
  const risks: FulfillmentRisk[] = [];
  const lowStockCategories: string[] = [];
  let categoriesAtRisk = 0;

  const catEntries = Array.from(categoryMap.entries());
  for (let i = 0; i < catEntries.length; i++) {
    const category = catEntries[i][0];
    const data = catEntries[i][1];
    const avgAge = data.count > 0 ? Math.round(data.ageDaysSum / data.count) : 0;
    const holdPct = data.count > 0 ? data.onHold / data.count : 0;
    const expiringPct = data.count > 0 ? data.expiring30 / data.count : 0;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (data.count <= 3 || holdPct > 0.5 || expiringPct > 0.4) {
      riskLevel = 'critical';
    } else if (data.count <= 10 || holdPct > 0.3 || expiringPct > 0.2) {
      riskLevel = 'high';
    } else if (holdPct > 0.15 || expiringPct > 0.1 || avgAge > 90) {
      riskLevel = 'medium';
    }

    categoryStock.push({
      category,
      packageCount: data.count,
      totalQuantity: Math.round(data.totalQty * 100) / 100,
      unitOfMeasure: data.unit,
      averageAge: avgAge,
      expiringWithin30Days: data.expiring30,
      onHoldCount: data.onHold,
      availableQuantity: Math.round(data.availableQty * 100) / 100,
      riskLevel,
    });

    if (riskLevel === 'critical' || riskLevel === 'high') {
      categoriesAtRisk++;
    }

    // Generate specific risks
    if (data.count <= 3) {
      lowStockCategories.push(category);
      risks.push({
        riskLevel: 'critical',
        title: 'Critically low stock',
        description: category + ' has only ' + data.count + ' package(s) remaining',
        category,
        affectedPackages: data.count,
        metric: data.count,
      });
    } else if (data.count <= 10) {
      lowStockCategories.push(category);
      risks.push({
        riskLevel: 'high',
        title: 'Low stock warning',
        description: category + ' has only ' + data.count + ' packages remaining',
        category,
        affectedPackages: data.count,
        metric: data.count,
      });
    }

    if (holdPct > 0.3 && data.onHold >= 3) {
      risks.push({
        riskLevel: holdPct > 0.5 ? 'critical' : 'high',
        title: 'High hold rate affecting availability',
        description: Math.round(holdPct * 100) + '% of ' + category + ' packages (' + data.onHold + ') are on hold',
        category,
        affectedPackages: data.onHold,
        metric: Math.round(holdPct * 100),
      });
    }

    if (data.expiring30 >= 3) {
      risks.push({
        riskLevel: expiringPct > 0.3 ? 'critical' : 'high',
        title: 'Packages approaching expiration',
        description: data.expiring30 + ' ' + category + ' packages are over 150 days old (approaching 180-day limit)',
        category,
        affectedPackages: data.expiring30,
        metric: data.expiring30,
      });
    }

    if (avgAge > 90 && data.count >= 5) {
      risks.push({
        riskLevel: avgAge > 120 ? 'high' : 'medium',
        title: 'Aging inventory concentration',
        description: category + ' has an average age of ' + avgAge + ' days across ' + data.count + ' packages',
        category,
        affectedPackages: data.count,
        metric: avgAge,
      });
    }
  }

  categoryStock.sort(function (a, b) {
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (riskOrder[a.riskLevel] || 3) - (riskOrder[b.riskLevel] || 3);
  });

  risks.sort(function (a, b) {
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (riskOrder[a.riskLevel] || 3) - (riskOrder[b.riskLevel] || 3);
  });

  // Transfer velocity — last 7, 30, 90 days
  const now = new Date();
  const periods = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
  ];

  const transferVelocity: TransferVelocity[] = [];
  for (let p = 0; p < periods.length; p++) {
    const cutoff = new Date(now.getTime() - periods[p].days * 24 * 60 * 60 * 1000);
    let outCount = 0;
    let outPkgs = 0;
    let inCount = 0;
    let inPkgs = 0;

    for (let t = 0; t < outgoingTransfers.length; t++) {
      const transferDate = new Date(outgoingTransfers[t].CreatedDateTime);
      if (transferDate >= cutoff) {
        outCount++;
        outPkgs += outgoingTransfers[t].PackageCount;
      }
    }

    for (let t = 0; t < incomingTransfers.length; t++) {
      const transferDate = new Date(incomingTransfers[t].CreatedDateTime);
      if (transferDate >= cutoff) {
        inCount++;
        inPkgs += incomingTransfers[t].PackageCount;
      }
    }

    transferVelocity.push({
      period: periods[p].label,
      outgoingCount: outCount,
      outgoingPackages: outPkgs,
      incomingCount: inCount,
      incomingPackages: inPkgs,
      netFlow: inPkgs - outPkgs,
    });
  }

  // Overall risk
  let totalOnHold = 0;
  let totalExpiringSoon = 0;
  let totalAvailable = 0;
  for (let i = 0; i < packages.length; i++) {
    if (packages[i].IsOnHold) totalOnHold++;
    if (calculateAgeDays(packages[i].PackagedDate) > 150) totalExpiringSoon++;
    if (!packages[i].IsOnHold && packages[i].Quantity > 0) totalAvailable++;
  }

  let overallRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  const criticalRisks = risks.filter(function (r) { return r.riskLevel === 'critical'; }).length;
  const highRisks = risks.filter(function (r) { return r.riskLevel === 'high'; }).length;

  if (criticalRisks >= 3 || lowStockCategories.length >= 3) {
    overallRisk = 'critical';
  } else if (criticalRisks >= 1 || highRisks >= 3) {
    overallRisk = 'high';
  } else if (highRisks >= 1 || categoriesAtRisk >= 2) {
    overallRisk = 'medium';
  }

  return {
    overallRisk,
    categoryStock,
    risks,
    transferVelocity,
    summary: {
      totalAvailablePackages: totalAvailable,
      totalOnHold,
      totalExpiringSoon,
      categoriesAtRisk,
      lowStockCategories,
    },
  };
}
