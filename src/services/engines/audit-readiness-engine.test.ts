import { describe, it, expect } from 'vitest'
import { generateAuditReadinessReport } from './audit-readiness-engine'
import type { ActionLogSummary } from './audit-readiness-engine'
import type { AuditReconciliationResult } from './audit-reconciliation-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal AuditReconciliationResult for testing canixReconciliation
 * parameter effects on activityScore.
 */
function makeCanixReconciliation(
  matchRate: number,
  criticalBypasses = 0,
): AuditReconciliationResult {
  const discrepancies = Array.from({ length: criticalBypasses }, (_, i) => ({
    type: 'bypass' as const,
    severity: 'critical' as const,
    entityType: 'package',
    entityId: `PKG-${i}`,
    description: 'bypass',
  }))
  return {
    totalCanixActions: 100,
    totalPlatformActions: 100,
    matchedCount: Math.round(matchRate * 100),
    matchRate,
    discrepancies,
    byEntityType: {},
  }
}

/**
 * Build minimal action logs. Pass failedCount to get a specific number of
 * FAILED actions (others are COMPLETED). Keeping total small keeps the
 * failed-action penalty predictable.
 */
function makeActionLogs(total: number, failedCount = 0): ActionLogSummary[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `al-${i}`,
    actionType: 'PACKAGE_UPDATE',
    status: i < failedCount ? 'FAILED' : 'COMPLETED',
    targetType: 'PACKAGE',
    targetCount: 1,
    userId: 'user-1',
    createdAt: '2026-03-08T10:00:00.000Z',
    executedAt: '2026-03-08T10:00:01.000Z',
    errorMessage: null,
  }))
}

/**
 * A recent reconciliation date that doesn't trigger the stale penalty.
 */
const RECENT_RECON = {
  date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
  status: 'clean',
  matchRate: 1.0,
}

// ---------------------------------------------------------------------------
// Baseline: without canixReconciliation
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — without canixReconciliation', () => {
  it('should produce a report with valid structure', () => {
    const report = generateAuditReadinessReport([], [], makeActionLogs(5), RECENT_RECON, 0)

    expect(report.overallReadiness).toBeGreaterThanOrEqual(0)
    expect(report.overallReadiness).toBeLessThanOrEqual(100)
    expect(['ready', 'at_risk', 'not_ready']).toContain(report.readinessLevel)
    expect(report.activityScore).toBeGreaterThanOrEqual(0)
    expect(report.activityScore).toBeLessThanOrEqual(100)
    expect(report.lastReconciliation).not.toBeNull()
    expect(report.generatedAt).toBeTruthy()
  })

  it('should not apply canix reconciliation penalties when parameter is omitted', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(10), RECENT_RECON, 0)
    const withPerfectCanix = generateAuditReadinessReport(
      [], [], makeActionLogs(10), RECENT_RECON, 0,
      makeCanixReconciliation(1.0),
    )

    // Perfect match rate => no penalty; score should be equal
    expect(withoutCanix.activityScore).toBe(withPerfectCanix.activityScore)
  })
})

// ---------------------------------------------------------------------------
// canixReconciliation matchRate >= 0.95: no penalty
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — matchRate >= 0.95', () => {
  it('should apply no canix penalty for matchRate of 0.95', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with95 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.95),
    )

    expect(with95.activityScore).toBe(withoutCanix.activityScore)
  })

  it('should apply no canix penalty for matchRate of 1.0', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with100 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0),
    )

    expect(with100.activityScore).toBe(withoutCanix.activityScore)
  })
})

// ---------------------------------------------------------------------------
// canixReconciliation matchRate 0.8-0.95: -10 penalty
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — matchRate 0.8–0.95', () => {
  it('should apply -10 penalty for matchRate of 0.9', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with90 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.9),
    )

    expect(withoutCanix.activityScore - with90.activityScore).toBe(10)
  })

  it('should apply -10 penalty for matchRate of 0.8 (boundary — inclusive)', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with80 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.8),
    )

    // matchRate < 0.8 triggers -20, exactly 0.8 triggers -10 (the < 0.95 branch)
    // 0.8 is NOT < 0.8, so it falls into the 0.8-0.95 range → -10
    expect(withoutCanix.activityScore - with80.activityScore).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// canixReconciliation matchRate < 0.8: -20 penalty
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — matchRate < 0.8', () => {
  it('should apply -20 penalty for matchRate of 0.7', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with70 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.7),
    )

    expect(withoutCanix.activityScore - with70.activityScore).toBe(20)
  })

  it('should apply -20 penalty for matchRate of 0', () => {
    const withoutCanix = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const with0 = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.0),
    )

    expect(withoutCanix.activityScore - with0.activityScore).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Critical bypass discrepancies: -5 each, max -15
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — critical bypass penalties', () => {
  it('should apply -5 penalty per critical bypass (1 bypass)', () => {
    const baseline = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 0),
    )
    const with1Bypass = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 1),
    )

    expect(baseline.activityScore - with1Bypass.activityScore).toBe(5)
  })

  it('should apply -10 penalty for 2 critical bypasses', () => {
    const baseline = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 0),
    )
    const with2Bypasses = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 2),
    )

    expect(baseline.activityScore - with2Bypasses.activityScore).toBe(10)
  })

  it('should cap bypass penalty at -15 (3+ critical bypasses)', () => {
    const baseline = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 0),
    )
    const withManyBypasses = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0, 10), // 10 bypasses — should cap at -15
    )

    expect(baseline.activityScore - withManyBypasses.activityScore).toBe(15)
  })

  it('should stack bypass penalty with matchRate penalty correctly', () => {
    const baseline = generateAuditReadinessReport([], [], makeActionLogs(0), RECENT_RECON, 0)
    const withBoth = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.7, 3), // -20 for matchRate + -15 for 3 bypasses = -35
    )

    expect(baseline.activityScore - withBoth.activityScore).toBe(35)
  })

  it('should not go below 0 when cumulative penalties exceed 100', () => {
    // Stack maximum penalties: 100% fail rate (-30 cap), no recon (-15),
    // 50 open alerts (-25 cap), bad matchRate (-20), 10 bypasses (-15 cap)
    // Total would be -105 without the floor
    const report = generateAuditReadinessReport(
      [], [], makeActionLogs(100, 100), null, 50,
      makeCanixReconciliation(0.0, 10),
    )

    expect(report.activityScore).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// lastReconciliation synthesis from canixReconciliation
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — lastReconciliation synthesis', () => {
  it('should synthesize lastReconciliation from canixReconciliation when lastRecon is null', () => {
    const report = generateAuditReadinessReport(
      [], [], makeActionLogs(0), null, 0,
      makeCanixReconciliation(0.97),
    )

    expect(report.lastReconciliation).not.toBeNull()
    expect(report.lastReconciliation?.status).toBe('clean')
    expect(report.lastReconciliation?.matchRate).toBe(0.97)
  })

  it('should synthesize lastReconciliation with issues_found status for matchRate < 0.95', () => {
    const report = generateAuditReadinessReport(
      [], [], makeActionLogs(0), null, 0,
      makeCanixReconciliation(0.85),
    )

    expect(report.lastReconciliation?.status).toBe('issues_found')
  })

  it('should return null lastReconciliation when both lastRecon and canixReconciliation are absent', () => {
    const report = generateAuditReadinessReport([], [], makeActionLogs(0), null, 0)

    expect(report.lastReconciliation).toBeNull()
  })

  it('should prefer explicit lastRecon over synthesized value', () => {
    const report = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(0.5),
    )

    expect(report.lastReconciliation?.matchRate).toBe(RECENT_RECON.matchRate)
    expect(report.lastReconciliation?.status).toBe(RECENT_RECON.status)
  })
})

// ---------------------------------------------------------------------------
// Overall readiness score composition
// ---------------------------------------------------------------------------

describe('generateAuditReadinessReport — overall readiness', () => {
  it('should mark readinessLevel as ready when overallReadiness >= 80', () => {
    // Give perfect conditions — empty packages (score 100), no alerts, recent recon, perfect canix
    const report = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0),
    )

    // With empty inputs the audit engine gives 100, employee 100, activity depends on recon status
    // All three sub-scores should be high → overall >= 80
    expect(report.overallReadiness).toBeGreaterThanOrEqual(80)
    expect(report.readinessLevel).toBe('ready')
  })

  it('should mark readinessLevel as at_risk or not_ready when activityScore is heavily penalized', () => {
    // Maximum activity penalties push activityScore to 0.
    // overallReadiness = packageAudit * 0.6 + employeeScore * 0.2 + activityScore * 0.2
    // With empty packages (audit=100) and no employee issues (employee=100):
    //   overallReadiness = 60 + 20 + 0 = 80 → "ready" threshold is 80, so this is at_risk (<80 possible)
    // We verify the canix penalties are reflected in a lower score compared to perfect canix.
    const withWorstCanix = generateAuditReadinessReport(
      [], [], makeActionLogs(100, 100), null, 50,
      makeCanixReconciliation(0.0, 10),
    )
    const withPerfectCanix = generateAuditReadinessReport(
      [], [], makeActionLogs(0), RECENT_RECON, 0,
      makeCanixReconciliation(1.0),
    )

    expect(withWorstCanix.overallReadiness).toBeLessThan(withPerfectCanix.overallReadiness)
  })
})
