import type { MetrcPackage, MetrcTransfer } from '@/services/metrc/types';
import { generateAuditSnapshot, type AuditResult } from './audit-engine';
import {
  analyzeEmployeePatterns,
  identifyTrainingNeeds,
  type EmployeePatterns,
  type TrainingNeed,
} from './operations-analysis';
import type { AuditReconciliationResult } from './audit-reconciliation-engine';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ActionLogSummary {
  id: string;
  actionType: string;
  status: string;
  targetType: string;
  targetCount: number;
  userId: string;
  createdAt: string;
  executedAt: string | null;
  errorMessage: string | null;
}

export interface RecentActivitySummary {
  totalActions: number;
  completedCount: number;
  failedCount: number;
  previewOnlyCount: number;
  actions: ActionLogSummary[];
}

export interface LastReconciliation {
  date: string | null;
  status: string | null;
  matchRate: number | null;
}

export interface AuditReadinessReport {
  // From existing audit engine
  packageAudit: AuditResult;

  // Employee analysis
  employeePatterns: EmployeePatterns;
  trainingNeeds: TrainingNeed[];
  employeeScore: number; // 0-100

  // Recent activity summary
  recentActions: RecentActivitySummary;
  activityScore: number; // 0-100

  // Reconciliation status
  lastReconciliation: LastReconciliation | null;

  // Composite
  overallReadiness: number; // weighted: 60% package audit + 20% employee + 20% activity
  readinessLevel: 'ready' | 'at_risk' | 'not_ready';
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function computeEmployeeScore(
  patterns: EmployeePatterns,
  trainingNeeds: TrainingNeed[],
): number {
  let score = 100;

  // Deduct for after-hours activity: -2 per employee, max -10 (informational, not compliance-critical)
  const afterHoursDeduction = Math.min(10, patterns.afterHoursActivity.length * 2);
  score -= afterHoursDeduction;

  // Deduct for critical training needs: -10 each, max -30
  let criticalCount = 0;
  for (let i = 0; i < trainingNeeds.length; i++) {
    if (trainingNeeds[i].severity === 'critical') criticalCount++;
  }
  score -= Math.min(30, criticalCount * 10);

  // Deduct for warning training needs: -5 each, max -20
  let warningCount = 0;
  for (let i = 0; i < trainingNeeds.length; i++) {
    if (trainingNeeds[i].severity === 'warning') warningCount++;
  }
  score -= Math.min(20, warningCount * 5);

  return Math.max(0, score);
}

function computeActivityScore(
  actions: ActionLogSummary[],
  lastRecon: LastReconciliation | null,
  openAlertCount: number,
  canixReconciliation?: AuditReconciliationResult,
): number {
  let score = 100;

  const totalActions = actions.length;
  if (totalActions > 0) {
    // Deduct for failed actions (% of total), max -30
    let failedCount = 0;
    for (let i = 0; i < actions.length; i++) {
      if (actions[i].status === 'FAILED') failedCount++;
    }
    const failPct = (failedCount / totalActions) * 100;
    score -= Math.min(30, Math.round(failPct));
  }

  // Deduct for stale reconciliation (>30 days since last), -15
  if (lastRecon && lastRecon.date) {
    const daysSinceRecon = Math.floor(
      (Date.now() - new Date(lastRecon.date).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceRecon > 30) {
      score -= 15;
    }
  } else {
    // No reconciliation ever done — deduct
    score -= 15;
  }

  // Canix audit reconciliation: penalize for low match rate and bypasses
  if (canixReconciliation) {
    if (canixReconciliation.matchRate < 0.8) {
      score -= 20;
    } else if (canixReconciliation.matchRate < 0.95) {
      score -= 10;
    }
    // Critical bypass discrepancies: -5 each, max -15
    const criticalBypasses = canixReconciliation.discrepancies
      .filter(d => d.type === 'bypass' && d.severity === 'critical').length;
    score -= Math.min(15, criticalBypasses * 5);
  }

  // Deduct for unresolved compliance alerts: -2 each, max -25
  score -= Math.min(25, openAlertCount * 2);

  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// generateAuditReadinessReport
// ---------------------------------------------------------------------------

export function generateAuditReadinessReport(
  packages: MetrcPackage[],
  transfers: MetrcTransfer[],
  actionLogs: ActionLogSummary[],
  lastRecon: LastReconciliation | null,
  openAlertCount: number,
  canixReconciliation?: AuditReconciliationResult,
  facilityType?: string | null,
): AuditReadinessReport {
  // 1. Package audit (existing engine)
  const packageAudit = generateAuditSnapshot(packages, facilityType);

  // 2. Employee analysis (existing engine)
  const employeePatterns = analyzeEmployeePatterns(transfers);
  const trainingNeeds = identifyTrainingNeeds(packages, transfers);

  // 3. Scores
  const employeeScore = computeEmployeeScore(employeePatterns, trainingNeeds);

  // 4. Activity summary
  let completedCount = 0;
  let failedCount = 0;
  let previewOnlyCount = 0;
  for (let i = 0; i < actionLogs.length; i++) {
    const status = actionLogs[i].status;
    if (status === 'COMPLETED') completedCount++;
    else if (status === 'FAILED') failedCount++;
    else if (status === 'PREVIEWING') previewOnlyCount++;
  }

  const recentActions: RecentActivitySummary = {
    totalActions: actionLogs.length,
    completedCount,
    failedCount,
    previewOnlyCount,
    actions: actionLogs,
  };

  const activityScore = computeActivityScore(actionLogs, lastRecon, openAlertCount, canixReconciliation);

  // 5. Composite readiness score
  const overallReadiness = Math.round(
    packageAudit.overallScore * 0.6 + employeeScore * 0.2 + activityScore * 0.2,
  );

  let readinessLevel: 'ready' | 'at_risk' | 'not_ready';
  if (overallReadiness >= 80) readinessLevel = 'ready';
  else if (overallReadiness >= 60) readinessLevel = 'at_risk';
  else readinessLevel = 'not_ready';

  // If canixReconciliation is provided and lastRecon is null, synthesize one
  const effectiveLastRecon = lastRecon ?? (canixReconciliation ? {
    date: new Date().toISOString(),
    status: canixReconciliation.matchRate >= 0.95 ? 'clean' : 'issues_found',
    matchRate: canixReconciliation.matchRate,
  } : null);

  return {
    packageAudit,
    employeePatterns,
    trainingNeeds,
    employeeScore,
    recentActions,
    activityScore,
    lastReconciliation: effectiveLastRecon,
    overallReadiness,
    readinessLevel,
    generatedAt: new Date().toISOString(),
  };
}
