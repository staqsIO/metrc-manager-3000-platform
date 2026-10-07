import type { MetrcPackage, MetrcTransfer } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface EmployeeActivity {
  userName: string;
  transferCount: number;
  totalPackagesHandled: number;
  firstActivity: string;
  lastActivity: string;
  activeDays: number;
  averagePackagesPerTransfer: number;
  timeOfDayDistribution: Record<string, number>; // hour bucket -> count
  isActive: boolean; // activity within last 90 days
}

export interface EmployeePatterns {
  employees: EmployeeActivity[];
  totalEmployees: number;
  activeEmployees: number;
  mostActiveEmployee: { userName: string; transferCount: number } | null;
  averageTransfersPerEmployee: number;
  afterHoursActivity: { userName: string; count: number; latestTime: string }[];
}

export interface EmployeePatternOptions {
  /** Start of "business hours" (0-23). Default: 5 (5 AM) */
  businessHoursStart?: number;
  /** End of "business hours" (0-23, 0 = midnight). Default: 0 (midnight) */
  businessHoursEnd?: number;
  /** Days of inactivity before marking employee as inactive. Default: 90 */
  activeCutoffDays?: number;
}

export interface TrainingNeed {
  userName: string;
  category: 'high_error_rate' | 'low_volume' | 'after_hours' | 'hold_association';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  metric: number;
}

export interface ReconciliationItem {
  packageLabel: string;
  field: string;
  metrcValue: string;
  externalValue: string;
  discrepancyType: 'missing_in_external' | 'missing_in_metrc' | 'value_mismatch' | 'quantity_mismatch';
  severity: 'low' | 'medium' | 'high';
}

export interface ReconciliationResult {
  totalCompared: number;
  matchCount: number;
  discrepancyCount: number;
  matchRate: number;
  discrepancies: ReconciliationItem[];
  byType: { type: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
}

export interface ExternalRecord {
  label: string;
  quantity?: number;
  category?: string;
  location?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// analyzeEmployeePatterns
// ---------------------------------------------------------------------------

export function analyzeEmployeePatterns(transfers: MetrcTransfer[], options?: EmployeePatternOptions): EmployeePatterns {
  const businessStart = options?.businessHoursStart ?? 5;  // 5 AM default
  const businessEnd = options?.businessHoursEnd ?? 0;      // midnight default (0 = 12 AM)
  const activeCutoffDays = options?.activeCutoffDays ?? 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - activeCutoffDays);
  const cutoffStr = cutoffDate.toISOString();
  const employeeMap = new Map<string, {
    transferCount: number;
    totalPackages: number;
    firstActivity: string;
    lastActivity: string;
    activeDates: Set<string>;
    hourCounts: Record<string, number>;
  }>();

  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    const userName = transfer.CreatedByUserName || 'Unknown';
    const createdDate = transfer.CreatedDateTime;
    const dateOnly = createdDate.substring(0, 10);

    let hourStr = '00';
    if (createdDate.length > 11) {
      hourStr = createdDate.substring(11, 13);
    }

    const existing = employeeMap.get(userName);
    if (existing) {
      existing.transferCount += 1;
      existing.totalPackages += transfer.PackageCount;
      if (createdDate < existing.firstActivity) existing.firstActivity = createdDate;
      if (createdDate > existing.lastActivity) existing.lastActivity = createdDate;
      existing.activeDates.add(dateOnly);
      existing.hourCounts[hourStr] = (existing.hourCounts[hourStr] || 0) + 1;
    } else {
      const hourCounts: Record<string, number> = {};
      hourCounts[hourStr] = 1;
      const activeDates = new Set<string>();
      activeDates.add(dateOnly);
      employeeMap.set(userName, {
        transferCount: 1,
        totalPackages: transfer.PackageCount,
        firstActivity: createdDate,
        lastActivity: createdDate,
        activeDates,
        hourCounts,
      });
    }
  }

  const employees: EmployeeActivity[] = [];
  const afterHoursActivity: { userName: string; count: number; latestTime: string }[] = [];

  const entries = Array.from(employeeMap.entries());
  for (let i = 0; i < entries.length; i++) {
    const userName = entries[i][0];
    const data = entries[i][1];

    const isActive = data.lastActivity >= cutoffStr;

    employees.push({
      userName,
      transferCount: data.transferCount,
      totalPackagesHandled: data.totalPackages,
      firstActivity: data.firstActivity,
      lastActivity: data.lastActivity,
      activeDays: data.activeDates.size,
      averagePackagesPerTransfer: data.transferCount > 0
        ? Math.round((data.totalPackages / data.transferCount) * 10) / 10
        : 0,
      timeOfDayDistribution: data.hourCounts,
      isActive,
    });

    // After hours detection — only flag active employees
    // Default: 5am-midnight is business hours, only 12am-5am is "after hours"
    if (isActive) {
      let afterHoursCount = 0;
      let latestTime = '';
      const hourEntries = Object.entries(data.hourCounts);
      for (let h = 0; h < hourEntries.length; h++) {
        const hour = parseInt(hourEntries[h][0], 10);
        const count = hourEntries[h][1];
        const isAfterHours = businessEnd === 0
          ? hour < businessStart              // e.g., before 5am
          : hour < businessStart || hour >= businessEnd;
        if (isAfterHours) {
          afterHoursCount += count;
          if (hourEntries[h][0] > latestTime) {
            latestTime = hourEntries[h][0] + ':00';
          }
        }
      }
      if (afterHoursCount > 0) {
        afterHoursActivity.push({ userName, count: afterHoursCount, latestTime });
      }
    }
  }

  employees.sort(function (a, b) { return b.transferCount - a.transferCount; });
  afterHoursActivity.sort(function (a, b) { return b.count - a.count; });

  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(e => e.isActive).length;
  let totalTransfers = 0;
  for (let i = 0; i < employees.length; i++) {
    totalTransfers += employees[i].transferCount;
  }

  return {
    employees,
    totalEmployees,
    activeEmployees,
    mostActiveEmployee: employees.length > 0
      ? { userName: employees[0].userName, transferCount: employees[0].transferCount }
      : null,
    averageTransfersPerEmployee: activeEmployees > 0
      ? Math.round((totalTransfers / activeEmployees) * 10) / 10
      : 0,
    afterHoursActivity,
  };
}

// ---------------------------------------------------------------------------
// identifyTrainingNeeds
// ---------------------------------------------------------------------------

export function identifyTrainingNeeds(
  packages: MetrcPackage[],
  transfers: MetrcTransfer[],
): TrainingNeed[] {
  const needs: TrainingNeed[] = [];

  // Analyze packages for employees associated with holds/remediation
  // Group by source — packages received from specific facilities
  const facilityHolds = new Map<string, { holdCount: number; totalCount: number }>();
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const source = pkg.ReceivedFromFacilityName || 'Internal';
    const existing = facilityHolds.get(source);
    if (existing) {
      existing.totalCount += 1;
      if (pkg.IsOnHold || pkg.ProductRequiresRemediation) {
        existing.holdCount += 1;
      }
    } else {
      facilityHolds.set(source, {
        totalCount: 1,
        holdCount: (pkg.IsOnHold || pkg.ProductRequiresRemediation) ? 1 : 0,
      });
    }
  }

  const facilityEntries = Array.from(facilityHolds.entries());
  for (let i = 0; i < facilityEntries.length; i++) {
    const facility = facilityEntries[i][0];
    const data = facilityEntries[i][1];
    if (data.totalCount >= 5 && data.holdCount / data.totalCount > 0.15) {
      needs.push({
        userName: facility,
        category: 'high_error_rate',
        severity: data.holdCount / data.totalCount > 0.3 ? 'critical' : 'warning',
        title: 'High hold/remediation rate from source',
        description: facility + ' has ' + data.holdCount + ' of ' + data.totalCount +
          ' packages on hold or requiring remediation (' +
          Math.round((data.holdCount / data.totalCount) * 100) + '%)',
        metric: Math.round((data.holdCount / data.totalCount) * 100),
      });
    }
  }

  // Analyze transfer patterns — low volume employees
  const employeeTransfers = new Map<string, number>();
  for (let i = 0; i < transfers.length; i++) {
    const user = transfers[i].CreatedByUserName || 'Unknown';
    employeeTransfers.set(user, (employeeTransfers.get(user) || 0) + 1);
  }

  if (employeeTransfers.size >= 3) {
    let totalTransferCount = 0;
    const transferEntries = Array.from(employeeTransfers.entries());
    for (let i = 0; i < transferEntries.length; i++) {
      totalTransferCount += transferEntries[i][1];
    }
    const avgTransfers = totalTransferCount / transferEntries.length;

    for (let i = 0; i < transferEntries.length; i++) {
      const user = transferEntries[i][0];
      const count = transferEntries[i][1];
      if (count < avgTransfers * 0.25 && count < 5) {
        needs.push({
          userName: user,
          category: 'low_volume',
          severity: 'info',
          title: 'Low transfer activity',
          description: user + ' has only ' + count +
            ' transfers (avg: ' + Math.round(avgTransfers) + '). May need onboarding or reassignment.',
          metric: count,
        });
      }
    }
  }

  // After-hours pattern check
  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    const createdDate = transfer.CreatedDateTime;
    if (createdDate.length > 11) {
      const hour = parseInt(createdDate.substring(11, 13), 10);
      if (hour < 5) { // Only flag genuinely unusual hours (12am-5am)
        const user = transfer.CreatedByUserName || 'Unknown';
        // Check if already flagged
        let alreadyFlagged = false;
        for (let n = 0; n < needs.length; n++) {
          if (needs[n].userName === user && needs[n].category === 'after_hours') {
            alreadyFlagged = true;
            break;
          }
        }
        if (!alreadyFlagged) {
          needs.push({
            userName: user,
            category: 'after_hours',
            severity: 'warning',
            title: 'Unusual after-hours activity',
            description: user + ' has transfer activity at unusual hours (' +
              createdDate.substring(11, 16) + '). Verify authorization.',
            metric: hour,
          });
        }
      }
    }
  }

  needs.sort(function (a, b) {
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
  });

  return needs;
}

// ---------------------------------------------------------------------------
// reconcileInventory
// ---------------------------------------------------------------------------

export function reconcileInventory(
  metrcPackages: MetrcPackage[],
  externalRecords: ExternalRecord[],
): ReconciliationResult {
  // Build lookup maps
  const metrcMap = new Map<string, MetrcPackage>();
  for (let i = 0; i < metrcPackages.length; i++) {
    metrcMap.set(metrcPackages[i].Label, metrcPackages[i]);
  }

  const externalMap = new Map<string, ExternalRecord>();
  for (let i = 0; i < externalRecords.length; i++) {
    externalMap.set(externalRecords[i].label, externalRecords[i]);
  }

  const discrepancies: ReconciliationItem[] = [];
  let matchCount = 0;

  // Check all Metrc packages against external
  const metrcLabels = Array.from(metrcMap.keys());
  for (let i = 0; i < metrcLabels.length; i++) {
    const label = metrcLabels[i];
    const metrcPkg = metrcMap.get(label)!;
    const externalRec = externalMap.get(label);

    if (!externalRec) {
      discrepancies.push({
        packageLabel: label,
        field: 'existence',
        metrcValue: 'Present',
        externalValue: 'Missing',
        discrepancyType: 'missing_in_external',
        severity: 'high',
      });
      continue;
    }

    let hasDiscrepancy = false;

    // Quantity check
    if (externalRec.quantity !== undefined) {
      const metrcQty = Math.round(metrcPkg.Quantity * 100) / 100;
      const extQty = Math.round(externalRec.quantity * 100) / 100;
      if (metrcQty !== extQty) {
        const diff = Math.abs(metrcQty - extQty);
        const percentDiff = metrcQty > 0 ? (diff / metrcQty) * 100 : 100;
        discrepancies.push({
          packageLabel: label,
          field: 'quantity',
          metrcValue: String(metrcQty),
          externalValue: String(extQty),
          discrepancyType: 'quantity_mismatch',
          severity: percentDiff > 10 ? 'high' : percentDiff > 2 ? 'medium' : 'low',
        });
        hasDiscrepancy = true;
      }
    }

    // Category check
    if (externalRec.category !== undefined && externalRec.category !== metrcPkg.ItemCategory) {
      discrepancies.push({
        packageLabel: label,
        field: 'category',
        metrcValue: metrcPkg.ItemCategory,
        externalValue: externalRec.category,
        discrepancyType: 'value_mismatch',
        severity: 'medium',
      });
      hasDiscrepancy = true;
    }

    // Location check
    if (externalRec.location !== undefined && externalRec.location !== metrcPkg.LocationName) {
      discrepancies.push({
        packageLabel: label,
        field: 'location',
        metrcValue: metrcPkg.LocationName || 'Unassigned',
        externalValue: externalRec.location,
        discrepancyType: 'value_mismatch',
        severity: 'low',
      });
      hasDiscrepancy = true;
    }

    if (!hasDiscrepancy) {
      matchCount++;
    }
  }

  // Check external records not in Metrc
  const externalLabels = Array.from(externalMap.keys());
  for (let i = 0; i < externalLabels.length; i++) {
    const label = externalLabels[i];
    if (!metrcMap.has(label)) {
      discrepancies.push({
        packageLabel: label,
        field: 'existence',
        metrcValue: 'Missing',
        externalValue: 'Present',
        discrepancyType: 'missing_in_metrc',
        severity: 'high',
      });
    }
  }

  const totalCompared = metrcLabels.length + externalLabels.filter(l => !metrcMap.has(l)).length;

  // Count by type
  const typeCountMap = new Map<string, number>();
  const severityCountMap = new Map<string, number>();
  for (let i = 0; i < discrepancies.length; i++) {
    const d = discrepancies[i];
    typeCountMap.set(d.discrepancyType, (typeCountMap.get(d.discrepancyType) || 0) + 1);
    severityCountMap.set(d.severity, (severityCountMap.get(d.severity) || 0) + 1);
  }

  const byType: { type: string; count: number }[] = [];
  const typeEntries = Array.from(typeCountMap.entries());
  for (let i = 0; i < typeEntries.length; i++) {
    byType.push({ type: typeEntries[i][0], count: typeEntries[i][1] });
  }

  const bySeverity: { severity: string; count: number }[] = [];
  const sevEntries = Array.from(severityCountMap.entries());
  for (let i = 0; i < sevEntries.length; i++) {
    bySeverity.push({ severity: sevEntries[i][0], count: sevEntries[i][1] });
  }

  return {
    totalCompared,
    matchCount,
    discrepancyCount: discrepancies.length,
    matchRate: totalCompared > 0 ? Math.round((matchCount / totalCompared) * 1000) / 10 : 0,
    discrepancies,
    byType,
    bySeverity,
  };
}
