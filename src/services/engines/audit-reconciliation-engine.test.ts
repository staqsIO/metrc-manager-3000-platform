import { describe, it, expect } from 'vitest'
import { reconcileAuditTrails } from './audit-reconciliation-engine'
import type { CanixAuditedAction } from '../canix/types'
import type { ActionLogSummary } from './audit-reconciliation-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanixAction(overrides: Partial<CanixAuditedAction> = {}): CanixAuditedAction {
  return {
    id: 'ca-1',
    entityType: 'package',
    entityId: 'PKG-001',
    action: 'update',
    userId: 'user-1',
    userName: 'Jane Smith',
    changes: {},
    performedAt: '2026-03-08T10:00:00.000Z',
    source: 'formul8',
    ...overrides,
  }
}

function makePlatformAction(overrides: Partial<ActionLogSummary> = {}): ActionLogSummary {
  return {
    id: 'pa-1',
    actionType: 'PACKAGE_UPDATE',
    status: 'COMPLETED',
    targetType: 'PACKAGE',
    targetIds: ['pkg-001'],
    targetCount: 1,
    userId: 'user-1',
    createdAt: '2026-03-08T10:00:00.000Z',
    executedAt: '2026-03-08T10:00:30.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — matching', () => {
  it('should match a Canix action to a platform action by entity ID and action type within tolerance', () => {
    const canixAction = makeCanixAction({ entityId: 'PKG-001', action: 'update', performedAt: '2026-03-08T10:00:00.000Z' })
    const platformAction = makePlatformAction({
      targetIds: ['pkg-001'],
      actionType: 'PACKAGE_UPDATE',
      executedAt: '2026-03-08T10:01:00.000Z', // 60s apart — within 15min tolerance
    })

    const result = reconcileAuditTrails([canixAction], [platformAction])

    expect(result.matchedCount).toBe(1)
    expect(result.matchRate).toBe(1)
    expect(result.discrepancies.filter(d => d.type === 'bypass')).toHaveLength(0)
  })

  it('should not match actions beyond the time tolerance', () => {
    const canixAction = makeCanixAction({
      entityId: 'PKG-001',
      action: 'update',
      performedAt: '2026-03-08T10:00:00.000Z',
      source: 'formul8',
    })
    const platformAction = makePlatformAction({
      targetIds: ['pkg-001'],
      actionType: 'PACKAGE_UPDATE',
      executedAt: '2026-03-08T10:20:00.000Z', // 20 min — exceeds 15 min default
    })

    const result = reconcileAuditTrails([canixAction], [platformAction])

    expect(result.matchedCount).toBe(0)
  })

  it('should respect a custom timeToleranceMs option', () => {
    const canixAction = makeCanixAction({ performedAt: '2026-03-08T10:00:00.000Z', source: 'formul8' })
    const platformAction = makePlatformAction({
      executedAt: '2026-03-08T10:02:00.000Z', // 2 min
    })

    // With 1 min tolerance: no match
    const tight = reconcileAuditTrails([canixAction], [platformAction], { timeToleranceMs: 60_000 })
    expect(tight.matchedCount).toBe(0)

    // With 5 min tolerance: match
    const loose = reconcileAuditTrails([canixAction], [platformAction], { timeToleranceMs: 5 * 60_000 })
    expect(loose.matchedCount).toBe(1)
  })

  it('should perform case-insensitive entity ID matching', () => {
    const canixAction = makeCanixAction({ entityId: 'PKG-ABC', action: 'update' })
    const platformAction = makePlatformAction({ targetIds: ['pkg-abc'], actionType: 'PACKAGE_UPDATE' })

    const result = reconcileAuditTrails([canixAction], [platformAction])

    expect(result.matchedCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Bypass detection
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — bypass detection', () => {
  it('should flag unmatched Canix action with non-formul8 source as bypass', () => {
    const canixAction = makeCanixAction({
      entityType: 'package',
      entityId: 'PKG-BYPASS',
      action: 'update',
      source: 'canix_web',
      performedAt: '2026-03-08T10:00:00.000Z',
    })

    const result = reconcileAuditTrails([canixAction], [])

    const bypass = result.discrepancies.find(d => d.type === 'bypass')
    expect(bypass).toBeDefined()
    expect(bypass?.severity).toBe('critical') // package = critical entity
    expect(bypass?.entityId).toBe('PKG-BYPASS')
  })

  it('should flag transfer bypass as critical', () => {
    const canixAction = makeCanixAction({
      entityType: 'transfer',
      entityId: 'TRF-001',
      action: 'create',
      source: 'api',
    })

    const result = reconcileAuditTrails([canixAction], [])

    const bypass = result.discrepancies.find(d => d.type === 'bypass')
    expect(bypass?.severity).toBe('critical')
  })

  it('should flag non-critical entity bypass as warning', () => {
    const canixAction = makeCanixAction({
      entityType: 'item',
      entityId: 'ITEM-001',
      action: 'update',
      source: 'api',
    })

    const result = reconcileAuditTrails([canixAction], [])

    const bypass = result.discrepancies.find(d => d.type === 'bypass')
    expect(bypass?.severity).toBe('warning')
  })

  it('should not flag unmatched Canix action with formul8 source as bypass', () => {
    const canixAction = makeCanixAction({
      entityId: 'PKG-999',
      source: 'formul8',
      action: 'update',
    })

    const result = reconcileAuditTrails([canixAction], [])

    const bypasses = result.discrepancies.filter(d => d.type === 'bypass')
    expect(bypasses).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Unmatched platform actions
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — unmatched platform actions', () => {
  it('should report COMPLETED platform actions with no Canix match as unmatched_platform', () => {
    const platformAction = makePlatformAction({
      id: 'pa-unmatched',
      actionType: 'PACKAGE_UPDATE',
      status: 'COMPLETED',
    })

    const result = reconcileAuditTrails([], [platformAction])

    const unmatched = result.discrepancies.find(d => d.type === 'unmatched_platform')
    expect(unmatched).toBeDefined()
    expect(unmatched?.severity).toBe('info')
    expect(unmatched?.platformAction?.id).toBe('pa-unmatched')
  })

  it('should ignore non-COMPLETED platform actions', () => {
    const platformAction = makePlatformAction({ status: 'PREVIEWING' })

    const result = reconcileAuditTrails([], [platformAction])

    const unmatched = result.discrepancies.filter(d => d.type === 'unmatched_platform')
    expect(unmatched).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Timing mismatch
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — timing mismatch', () => {
  it('should report timing_mismatch for matched actions with >5min time difference', () => {
    const canixAction = makeCanixAction({ performedAt: '2026-03-08T10:00:00.000Z', source: 'formul8' })
    const platformAction = makePlatformAction({
      executedAt: '2026-03-08T10:08:00.000Z', // 8 min — within 15min but >5min
    })

    const result = reconcileAuditTrails([canixAction], [platformAction])

    expect(result.matchedCount).toBe(1)
    const timingMismatch = result.discrepancies.find(d => d.type === 'timing_mismatch')
    expect(timingMismatch).toBeDefined()
    expect(timingMismatch?.severity).toBe('info')
  })

  it('should not report timing_mismatch for actions within 5min', () => {
    const canixAction = makeCanixAction({ performedAt: '2026-03-08T10:00:00.000Z' })
    const platformAction = makePlatformAction({
      executedAt: '2026-03-08T10:04:00.000Z', // 4 min — within 5min
    })

    const result = reconcileAuditTrails([canixAction], [platformAction])

    const timingMismatches = result.discrepancies.filter(d => d.type === 'timing_mismatch')
    expect(timingMismatches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Match rate
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — match rate', () => {
  it('should compute matchRate as matched / total canix actions', () => {
    const matched = makeCanixAction({ entityId: 'PKG-001', source: 'formul8' })
    const unmatched = makeCanixAction({ id: 'ca-2', entityId: 'PKG-002', source: 'canix_web' })
    const platformAction = makePlatformAction({ targetIds: ['pkg-001'] })

    const result = reconcileAuditTrails([matched, unmatched], [platformAction])

    expect(result.matchRate).toBe(0.5)
    expect(result.matchedCount).toBe(1)
    expect(result.totalCanixActions).toBe(2)
  })

  it('should return matchRate of 1 when there are no Canix actions', () => {
    const result = reconcileAuditTrails([], [])
    expect(result.matchRate).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — empty inputs', () => {
  it('should return zero counts for empty inputs', () => {
    const result = reconcileAuditTrails([], [])

    expect(result.totalCanixActions).toBe(0)
    expect(result.totalPlatformActions).toBe(0)
    expect(result.matchedCount).toBe(0)
    expect(result.discrepancies).toHaveLength(0)
    expect(result.byEntityType).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// byEntityType breakdown
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — byEntityType', () => {
  it('should track matched and unmatched counts by entity type', () => {
    const pkgMatched = makeCanixAction({ entityId: 'PKG-001', entityType: 'package', action: 'update', source: 'formul8' })
    const pkgUnmatched = makeCanixAction({ id: 'ca-2', entityId: 'PKG-002', entityType: 'package', action: 'update', source: 'canix_web' })
    const harvestAction = makeCanixAction({ id: 'ca-3', entityId: 'HRV-001', entityType: 'harvest', action: 'update', source: 'canix_web' })

    const platformAction = makePlatformAction({ targetIds: ['pkg-001'], actionType: 'PACKAGE_UPDATE' })

    const result = reconcileAuditTrails([pkgMatched, pkgUnmatched, harvestAction], [platformAction])

    expect(result.byEntityType['package']?.matched).toBe(1)
    expect(result.byEntityType['package']?.unmatched).toBe(1)
    expect(result.byEntityType['harvest']?.matched).toBe(0)
    expect(result.byEntityType['harvest']?.unmatched).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Discrepancy severity ordering
// ---------------------------------------------------------------------------

describe('reconcileAuditTrails — severity ordering', () => {
  it('should sort discrepancies with critical first, then warning, then info', () => {
    // Bypass on package (critical) + unmatched platform (info)
    const canixBypass = makeCanixAction({ entityType: 'package', entityId: 'PKG-B', source: 'canix_web' })
    const platformAction = makePlatformAction({ id: 'pa-unmatched', targetIds: ['different-id'] })

    const result = reconcileAuditTrails([canixBypass], [platformAction])

    const severities = result.discrepancies.map(d => d.severity)
    const critIdx = severities.indexOf('critical')
    const infoIdx = severities.indexOf('info')
    if (critIdx !== -1 && infoIdx !== -1) {
      expect(critIdx).toBeLessThan(infoIdx)
    }
  })
})
