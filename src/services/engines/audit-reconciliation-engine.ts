/**
 * Audit Reconciliation Engine
 *
 * Cross-references Canix ERP audit trail with platform ActionLog
 * to detect actions performed outside the platform (bypass detection).
 *
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { CanixAuditedAction } from '../canix/types';

// ============================================================
// Types
// ============================================================

export interface ActionLogSummary {
  id: string;
  actionType: string;
  status: string;
  targetType: string;
  targetIds: string[];
  targetCount: number;
  userId: string;
  createdAt: string;
  executedAt: string | null;
}

export interface AuditDiscrepancy {
  type: 'bypass' | 'unmatched_platform' | 'timing_mismatch';
  severity: 'critical' | 'warning' | 'info';
  canixAction?: CanixAuditedAction;
  platformAction?: ActionLogSummary;
  entityType: string;
  entityId: string;
  description: string;
}

export interface AuditReconciliationResult {
  totalCanixActions: number;
  totalPlatformActions: number;
  matchedCount: number;
  matchRate: number;
  discrepancies: AuditDiscrepancy[];
  byEntityType: Record<string, { matched: number; unmatched: number }>;
}

export interface ReconciliationOptions {
  /** Time tolerance for matching actions (ms). Default: 15 minutes. */
  timeToleranceMs?: number;
}

// ============================================================
// Mapping: Canix entity/action → platform targetType/actionType
// ============================================================

const ENTITY_TYPE_MAP: Record<string, string> = {
  package: 'PACKAGE',
  plant: 'PLANT',
  plant_batch: 'PLANT_BATCH',
  harvest: 'HARVEST',
  transfer: 'TRANSFER',
  item: 'ITEM',
  sale: 'SALE',
};

const ACTION_TYPE_MAP: Record<string, string[]> = {
  create: ['_CREATE'],
  update: ['_UPDATE', '_ADJUST', '_CHANGE'],
  delete: ['_DELETE', '_DESTROY'],
  adjust: ['_ADJUST'],
  move: ['_MOVE', '_TRANSFER'],
};

/** Critical entity types where bypasses are severe */
const CRITICAL_ENTITY_TYPES = new Set(['package', 'transfer', 'harvest']);

// ============================================================
// Core reconciliation
// ============================================================

/**
 * Reconcile Canix audit trail against platform ActionLog.
 *
 * Match strategy:
 * 1. Map Canix entityType/action to platform targetType/actionType
 * 2. Match by entity ID + action type within time tolerance
 * 3. Unmatched Canix actions (source !== 'formul8') → bypass
 * 4. Unmatched platform actions → unmatched_platform
 * 5. Matched with >5 min timing diff → timing_mismatch
 */
export function reconcileAuditTrails(
  canixActions: CanixAuditedAction[],
  platformActions: ActionLogSummary[],
  options?: ReconciliationOptions,
): AuditReconciliationResult {
  const timeToleranceMs = options?.timeToleranceMs ?? 15 * 60 * 1000; // 15 minutes default

  const discrepancies: AuditDiscrepancy[] = [];
  const byEntityType: Record<string, { matched: number; unmatched: number }> = {};
  let matchedCount = 0;

  // Build platform action index: entityId → actions
  const platformIndex = new Map<string, ActionLogSummary[]>();
  for (const action of platformActions) {
    if (action.status !== 'COMPLETED') continue;
    for (const targetId of action.targetIds) {
      const key = targetId.toLowerCase();
      const existing = platformIndex.get(key) ?? [];
      existing.push(action);
      platformIndex.set(key, existing);
    }
  }

  const matchedPlatformIds = new Set<string>();

  // Process each Canix action
  for (const canixAction of canixActions) {
    const mappedTargetType = ENTITY_TYPE_MAP[canixAction.entityType.toLowerCase()] ?? canixAction.entityType.toUpperCase();
    const entityKey = canixAction.entityId.toLowerCase();

    // Ensure byEntityType tracking
    if (!byEntityType[canixAction.entityType]) {
      byEntityType[canixAction.entityType] = { matched: 0, unmatched: 0 };
    }

    // Find matching platform actions
    const candidates = platformIndex.get(entityKey) ?? [];
    const canixTime = new Date(canixAction.performedAt).getTime();

    // Try to match by action type and time
    const actionSuffixes = ACTION_TYPE_MAP[canixAction.action.toLowerCase()] ?? [`_${canixAction.action.toUpperCase()}`];
    let matched = false;

    for (const candidate of candidates) {
      const matchesType = actionSuffixes.some(suffix =>
        candidate.actionType.endsWith(suffix) || candidate.actionType === `${mappedTargetType}${suffix}`
      );
      if (!matchesType) continue;

      const platformTime = new Date(candidate.executedAt ?? candidate.createdAt).getTime();
      const timeDiff = Math.abs(canixTime - platformTime);

      if (timeDiff <= timeToleranceMs) {
        matched = true;
        matchedCount++;
        matchedPlatformIds.add(candidate.id);
        byEntityType[canixAction.entityType]!.matched++;

        // Check for timing mismatch (>5 min)
        if (timeDiff > 5 * 60 * 1000) {
          discrepancies.push({
            type: 'timing_mismatch',
            severity: 'info',
            canixAction,
            platformAction: candidate,
            entityType: canixAction.entityType,
            entityId: canixAction.entityId,
            description: `Action matched but with ${Math.round(timeDiff / 60000)}min timing difference`,
          });
        }
        break;
      }
    }

    if (!matched) {
      // Unmatched Canix action — check if it's a bypass
      // 'formul8' is the source value Canix records for actions made through this platform's
      // integration. It is stored data, so it keeps the old product name.
      if (canixAction.source !== 'formul8') {
        const isCritical = CRITICAL_ENTITY_TYPES.has(canixAction.entityType.toLowerCase());
        discrepancies.push({
          type: 'bypass',
          severity: isCritical ? 'critical' : 'warning',
          canixAction,
          entityType: canixAction.entityType,
          entityId: canixAction.entityId,
          description: `${canixAction.entityType} ${canixAction.action} performed outside this platform (source: ${canixAction.source}, user: ${canixAction.userName})`,
        });
      }
      byEntityType[canixAction.entityType]!.unmatched++;
    }
  }

  // Find unmatched platform actions
  for (const action of platformActions) {
    if (action.status !== 'COMPLETED') continue;
    if (!matchedPlatformIds.has(action.id)) {
      discrepancies.push({
        type: 'unmatched_platform',
        severity: 'info',
        platformAction: action,
        entityType: action.targetType,
        entityId: action.targetIds[0] ?? 'unknown',
        description: `Platform action ${action.actionType} has no corresponding Canix audit entry`,
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  discrepancies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const total = canixActions.length;
  return {
    totalCanixActions: canixActions.length,
    totalPlatformActions: platformActions.length,
    matchedCount,
    matchRate: total > 0 ? Math.round((matchedCount / total) * 100) / 100 : 1,
    discrepancies,
    byEntityType,
  };
}
