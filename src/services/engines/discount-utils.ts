// Shared utilities for discount routers (auto-discount + manual discount)
// Extracted to eliminate duplication between auto-discount.ts and discount.ts (FOR-1141)

import type { RuleCondition, RuleDefinition } from '@/services/engines/rules-engine';

type BusinessRuleRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  severity: string;
  isActive: boolean;
  conditions: unknown;
  actionType: string;
  actionParams: unknown;
  metadata: unknown;
};

export function toRuleDefinitions(rules: BusinessRuleRow[]): RuleDefinition[] {
  return rules.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    category: r.category,
    severity: r.severity,
    isActive: r.isActive,
    conditions: r.conditions as unknown as RuleCondition[],
    actionType: r.actionType,
    metadata: {
      ...(r.metadata as Record<string, unknown> ?? {}),
      ...(r.actionParams ? { actionParams: r.actionParams } : {}),
      actionType: r.actionType,
    },
  }));
}
