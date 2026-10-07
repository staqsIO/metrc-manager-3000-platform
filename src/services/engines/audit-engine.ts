import type { MetrcPackage } from '@/services/metrc/types';
import { calculateAgeDays } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AuditFinding {
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  recommendation: string;
  affectedCount: number;
  affectedPackageLabels: string[];
  actionType?: 'expedite_testing' | 'remediate' | 'finish' | 'navigate_aging' | 'navigate_inventory';
}

export interface AuditCategory {
  name: string;
  score: number;
  maxScore: number;
  findings: AuditFinding[];
}

export interface AuditResult {
  overallScore: number;
  categories: AuditCategory[];
  totalFindings: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  findings: AuditFinding[];
  generatedAt: string;
  packageCount: number;
}

// ---------------------------------------------------------------------------
// generateAuditSnapshot
// ---------------------------------------------------------------------------

export function generateAuditSnapshot(packages: MetrcPackage[], facilityType?: string | null): AuditResult {
  const totalPkgs = packages.length;

  // ---------- Category: Lab Testing Compliance ----------
  let labScore = 100;
  const notSubmittedLabels: string[] = [];
  const failedLabels: string[] = [];
  const labFindings: AuditFinding[] = [];

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const age = calculateAgeDays(pkg.PackagedDate);
    if ((pkg.LabTestingState === 'NotSubmitted' || pkg.LabTestingState === 'NotRequired') && age > 14) {
      notSubmittedLabels.push(pkg.Label);
    }
    if (pkg.LabTestingState === 'TestFailed' || pkg.LabTestingState === 'LabTestFailed') {
      failedLabels.push(pkg.Label);
    }
  }

  // Partition into flagged (already acted on) vs unflagged
  const flaggedLabLabels: string[] = [];
  const unflaggedLabLabels: string[] = [];
  for (const label of notSubmittedLabels) {
    const pkg = packages.find(p => p.Label === label);
    if (pkg?.Note?.toLowerCase().includes('flagged')) {
      flaggedLabLabels.push(label);
    } else {
      unflaggedLabLabels.push(label);
    }
  }

  if (unflaggedLabLabels.length > 0) {
    const pct = totalPkgs > 0 ? Math.round((unflaggedLabLabels.length / totalPkgs) * 100) : 0;
    labScore -= Math.min(40, pct * 2);
    labFindings.push({
      category: 'Lab Testing',
      severity: pct > 30 ? 'critical' : pct > 10 ? 'warning' : 'info',
      title: 'Packages not submitted for testing',
      description: unflaggedLabLabels.length + ' packages (' + pct + '%) have not been submitted for lab testing after 14+ days.',
      recommendation: 'Submit all packages for lab testing within 14 days of packaging.',
      affectedCount: unflaggedLabLabels.length,
      affectedPackageLabels: unflaggedLabLabels,
      actionType: 'expedite_testing',
    });
  }

  if (flaggedLabLabels.length > 0) {
    labFindings.push({
      category: 'Lab Testing',
      severity: 'info',
      title: 'Packages flagged for lab testing',
      description: flaggedLabLabels.length + ' packages have been flagged for expedited lab testing.',
      recommendation: 'These packages have already been flagged. Follow up with the lab to confirm submission.',
      affectedCount: flaggedLabLabels.length,
      affectedPackageLabels: flaggedLabLabels,
      actionType: 'navigate_inventory',
    });
  }

  if (failedLabels.length > 0) {
    labScore -= Math.min(30, failedLabels.length * 5);
    labFindings.push({
      category: 'Lab Testing',
      severity: failedLabels.length > 5 ? 'critical' : 'warning',
      title: 'Failed lab tests',
      description: failedLabels.length + ' packages have failed lab testing and may require remediation.',
      recommendation: 'Review failed packages and initiate remediation or destruction procedures.',
      affectedCount: failedLabels.length,
      affectedPackageLabels: failedLabels,
      actionType: 'remediate',
    });
  }

  labScore = Math.max(0, labScore);

  // ---------- Category: Inventory Aging ----------
  let agingScore = 100;
  const over90Labels: string[] = [];
  const over180Labels: string[] = [];
  const agingFindings: AuditFinding[] = [];

  for (let i = 0; i < packages.length; i++) {
    const age = calculateAgeDays(packages[i].PackagedDate);
    if (age > 180) over180Labels.push(packages[i].Label);
    else if (age > 90) over90Labels.push(packages[i].Label);
  }

  if (over180Labels.length > 0) {
    agingScore -= Math.min(50, over180Labels.length * 10);
    agingFindings.push({
      category: 'Inventory Aging',
      severity: 'critical',
      title: 'Packages exceeding 180-day limit',
      description: over180Labels.length + ' packages are over 180 days old and may be non-compliant.',
      recommendation: 'Immediately review and disposition packages exceeding the 180-day threshold.',
      affectedCount: over180Labels.length,
      affectedPackageLabels: over180Labels,
      actionType: 'navigate_aging',
    });
  }

  if (over90Labels.length > 0) {
    const pct = totalPkgs > 0 ? Math.round((over90Labels.length / totalPkgs) * 100) : 0;
    agingScore -= Math.min(30, pct);
    agingFindings.push({
      category: 'Inventory Aging',
      severity: pct > 30 ? 'warning' : 'info',
      title: 'Aging inventory (90+ days)',
      description: over90Labels.length + ' packages (' + pct + '%) are over 90 days old.',
      recommendation: 'Prioritize older inventory for sale or processing to maintain FIFO compliance.',
      affectedCount: over90Labels.length,
      affectedPackageLabels: over90Labels,
      actionType: 'navigate_aging',
    });
  }

  agingScore = Math.max(0, agingScore);

  // ---------- Category: Package Holds ----------
  let holdScore = 100;
  const onHoldLabels: string[] = [];
  const remediationLabels: string[] = [];
  const holdFindings: AuditFinding[] = [];

  for (let i = 0; i < packages.length; i++) {
    if (packages[i].IsOnHold) onHoldLabels.push(packages[i].Label);
    if (packages[i].ProductRequiresRemediation) remediationLabels.push(packages[i].Label);
  }

  if (onHoldLabels.length > 0) {
    const pct = totalPkgs > 0 ? Math.round((onHoldLabels.length / totalPkgs) * 100) : 0;
    holdScore -= Math.min(40, pct * 3);
    holdFindings.push({
      category: 'Package Holds',
      severity: pct > 20 ? 'critical' : pct > 5 ? 'warning' : 'info',
      title: 'Packages on hold',
      description: onHoldLabels.length + ' packages (' + pct + '%) are currently on hold.',
      recommendation: 'Investigate and resolve hold reasons. Extended holds indicate process issues.',
      affectedCount: onHoldLabels.length,
      affectedPackageLabels: onHoldLabels,
      actionType: 'navigate_inventory',
    });
  }

  if (remediationLabels.length > 0) {
    holdScore -= Math.min(30, remediationLabels.length * 5);
    holdFindings.push({
      category: 'Package Holds',
      severity: remediationLabels.length > 5 ? 'critical' : 'warning',
      title: 'Packages requiring remediation',
      description: remediationLabels.length + ' packages require remediation.',
      recommendation: 'Complete remediation procedures or schedule destruction if remediation is not viable.',
      affectedCount: remediationLabels.length,
      affectedPackageLabels: remediationLabels,
      actionType: 'remediate',
    });
  }

  holdScore = Math.max(0, holdScore);

  // ---------- Category: Location Tracking ----------
  let locationScore = 100;
  const unassignedLabels: string[] = [];
  const locationFindings: AuditFinding[] = [];

  for (let i = 0; i < packages.length; i++) {
    if (!packages[i].LocationName || packages[i].LocationName === '') {
      unassignedLabels.push(packages[i].Label);
    }
  }

  if (unassignedLabels.length > 0) {
    const pct = totalPkgs > 0 ? Math.round((unassignedLabels.length / totalPkgs) * 100) : 0;
    locationScore -= Math.min(50, pct * 2);
    locationFindings.push({
      category: 'Location Tracking',
      severity: pct > 20 ? 'critical' : pct > 5 ? 'warning' : 'info',
      title: 'Packages without assigned location',
      description: unassignedLabels.length + ' packages (' + pct + '%) have no location assigned.',
      recommendation: 'Assign all packages to a tracked location for audit compliance.',
      affectedCount: unassignedLabels.length,
      affectedPackageLabels: unassignedLabels,
      actionType: 'navigate_inventory',
    });
  }

  locationScore = Math.max(0, locationScore);

  // ---------- Category: Data Completeness ----------
  let dataScore = 100;
  const missingStrainLabels: string[] = [];
  const zeroQuantityLabels: string[] = [];
  const dataFindings: AuditFinding[] = [];

  for (let i = 0; i < packages.length; i++) {
    if (!packages[i].ItemStrainName || packages[i].ItemStrainName === '') missingStrainLabels.push(packages[i].Label);
    if (packages[i].Quantity === 0) zeroQuantityLabels.push(packages[i].Label);
  }

  // Partition zero-quantity packages into flagged vs unflagged
  const flaggedZeroLabels: string[] = [];
  const unflaggedZeroLabels: string[] = [];
  for (const label of zeroQuantityLabels) {
    const pkg = packages.find(p => p.Label === label);
    if (pkg?.Note?.toLowerCase().includes('flagged')) {
      flaggedZeroLabels.push(label);
    } else {
      unflaggedZeroLabels.push(label);
    }
  }

  if (unflaggedZeroLabels.length > 0) {
    dataScore -= Math.min(20, unflaggedZeroLabels.length * 2);
    dataFindings.push({
      category: 'Data Completeness',
      severity: unflaggedZeroLabels.length > 10 ? 'warning' : 'info',
      title: 'Zero-quantity packages',
      description: unflaggedZeroLabels.length + ' active packages have zero quantity.',
      recommendation: 'Finish or archive zero-quantity packages to keep inventory accurate.',
      affectedCount: unflaggedZeroLabels.length,
      affectedPackageLabels: unflaggedZeroLabels,
      actionType: 'finish',
    });
  }

  if (flaggedZeroLabels.length > 0) {
    dataFindings.push({
      category: 'Data Completeness',
      severity: 'info',
      title: 'Zero-quantity packages already flagged',
      description: flaggedZeroLabels.length + ' zero-quantity packages have been flagged for action.',
      recommendation: 'These packages have already been flagged. Verify they are processed.',
      affectedCount: flaggedZeroLabels.length,
      affectedPackageLabels: flaggedZeroLabels,
      actionType: 'navigate_inventory',
    });
  }

  // Strain data is expected for Cultivator/Microbusiness but not Manufacturer/Dispensary
  const strainRelevant = !facilityType || facilityType === 'Cultivator' || facilityType === 'Microbusiness';
  if (strainRelevant && missingStrainLabels.length > 0) {
    const pct = totalPkgs > 0 ? Math.round((missingStrainLabels.length / totalPkgs) * 100) : 0;
    dataScore -= Math.min(20, pct);
    dataFindings.push({
      category: 'Data Completeness',
      severity: pct > 30 ? 'warning' : 'info',
      title: 'Missing strain information',
      description: missingStrainLabels.length + ' packages (' + pct + '%) are missing strain name.',
      recommendation: 'Ensure all packages have strain information for traceability.',
      affectedCount: missingStrainLabels.length,
      affectedPackageLabels: missingStrainLabels,
      actionType: 'navigate_inventory',
    });
  }

  dataScore = Math.max(0, dataScore);

  // ---------- Assemble result ----------
  const categories: AuditCategory[] = [
    { name: 'Lab Testing', score: labScore, maxScore: 100, findings: labFindings },
    { name: 'Inventory Aging', score: agingScore, maxScore: 100, findings: agingFindings },
    { name: 'Package Holds', score: holdScore, maxScore: 100, findings: holdFindings },
    { name: 'Location Tracking', score: locationScore, maxScore: 100, findings: locationFindings },
    { name: 'Data Completeness', score: dataScore, maxScore: 100, findings: dataFindings },
  ];

  const allFindings: AuditFinding[] = [];
  for (let c = 0; c < categories.length; c++) {
    for (let f = 0; f < categories[c].findings.length; f++) {
      allFindings.push(categories[c].findings[f]);
    }
  }

  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (let i = 0; i < allFindings.length; i++) {
    if (allFindings[i].severity === 'critical') criticalCount++;
    else if (allFindings[i].severity === 'warning') warningCount++;
    else infoCount++;
  }

  // Overall score = weighted average of categories
  let totalScore = 0;
  for (let c = 0; c < categories.length; c++) {
    totalScore += categories[c].score;
  }
  const overallScore = categories.length > 0 ? Math.round(totalScore / categories.length) : 100;

  return {
    overallScore,
    categories,
    totalFindings: allFindings.length,
    criticalCount,
    warningCount,
    infoCount,
    findings: allFindings,
    generatedAt: new Date().toISOString(),
    packageCount: totalPkgs,
  };
}
