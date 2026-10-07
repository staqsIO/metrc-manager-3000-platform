import type { PrismaClient, Prisma } from '@prisma/client';
import type { IMetrcClient } from '@/services/metrc/types';
import { evaluateRulesAgainstPackages } from './rules-engine';
import type { RuleCondition, RuleDefinition } from './rules-engine';

export interface EvaluationResult {
  evaluated: number;
  rulesChecked: number;
  violationsFound: number;
  alertsCreated: number;
  alertsSkipped: number;
  alertsAutoResolved: number;
}

interface EvaluationOptions {
  stateCode?: string;
  /** Exclude discount category rules (default: true for compliance evaluation) */
  excludeDiscount?: boolean;
}

/**
 * Convert DB BusinessRule rows to the RuleDefinition format the engine expects.
 * Reusable across tRPC mutation, cron endpoint, and copilot tools.
 */
function toRuleDefinitions(rules: {
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
}[]): RuleDefinition[] {
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

/**
 * Shared evaluation function: fetches rules + packages, evaluates, batch-creates alerts,
 * and auto-resolves stale alerts whose conditions are no longer met.
 *
 * Used by:
 *  - compliance.runEvaluation tRPC mutation
 *  - /api/cron/rules-eval cron endpoint
 */
export async function evaluateAndCreateAlerts(
  prisma: PrismaClient,
  facilityId: string,
  client: IMetrcClient,
  options?: EvaluationOptions,
): Promise<EvaluationResult> {
  const excludeDiscount = options?.excludeDiscount ?? true;
  const stateCode = options?.stateCode;

  // Build rule filter: active rules, optionally state-filtered, optionally exclude discount
  const ruleWhere: Prisma.BusinessRuleWhereInput = {
    facilityId,
    isActive: true,
    ...(excludeDiscount ? { category: { not: 'discount' } } : {}),
    ...(stateCode
      ? { OR: [{ stateCode }, { stateCode: null }] }
      : {}),
  };

  const [rules, packages] = await Promise.all([
    prisma.businessRule.findMany({ where: ruleWhere }),
    client.getActivePackages(),
  ]);

  const ruleDefinitions = toRuleDefinitions(rules);
  const violations = evaluateRulesAgainstPackages(ruleDefinitions, packages);

  // Batch create alerts — skipDuplicates leverages the @@unique constraint
  const alertData = violations.map(v => ({
    facilityId,
    category: v.category,
    severity: v.severity,
    title: v.title,
    description: v.description,
    packageLabel: v.packageLabel ?? null,
    ruleId: v.ruleId,
    actionType: v.actionType ?? null,
    actionParams: (v.actionParams as Prisma.InputJsonValue) ?? undefined,
    status: 'OPEN',
    metadata: (v.metadata as Prisma.InputJsonValue) ?? undefined,
  }));

  const createResult = await prisma.complianceAlert.createMany({
    data: alertData,
    skipDuplicates: true,
  });

  // Auto-resolution: find OPEN alerts whose condition is no longer met
  const currentViolationKeys = new Set(
    violations.map(v => `${v.ruleId}::${v.packageLabel ?? ''}`)
  );

  const openAlerts = await prisma.complianceAlert.findMany({
    where: { facilityId, status: 'OPEN', ruleId: { not: null } },
    select: { id: true, ruleId: true, packageLabel: true },
  });

  const staleAlertIds = openAlerts
    .filter(a => !currentViolationKeys.has(`${a.ruleId}::${a.packageLabel ?? ''}`))
    .map(a => a.id);

  let autoResolved = 0;
  if (staleAlertIds.length > 0) {
    const resolveResult = await prisma.complianceAlert.updateMany({
      where: { id: { in: staleAlertIds } },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolutionNote: 'Auto-resolved: condition no longer met',
      },
    });
    autoResolved = resolveResult.count;
  }

  return {
    evaluated: packages.length,
    rulesChecked: ruleDefinitions.length,
    violationsFound: violations.length,
    alertsCreated: createResult.count,
    alertsSkipped: violations.length - createResult.count,
    alertsAutoResolved: autoResolved,
  };
}
