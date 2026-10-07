/**
 * API call budget enforcement.
 *
 * Wraps around the monthly ApiCallBudget table to provide:
 * - Pre-call budget checks (fast-fail before wasting API calls)
 * - Atomic increment on call completion
 * - Warning/blocking thresholds (90% warn, 95% block sync, 100% block all)
 *
 * Phase 1 of the Metrc ingestion re-architecture.
 */

import { prisma } from '@/lib/prisma';

export type BudgetStatus = 'ok' | 'warning' | 'sync_blocked' | 'all_blocked';

export interface BudgetCheck {
  status: BudgetStatus;
  callsUsed: number;
  callsCap: number;
  percentUsed: number;
  yearMonth: string;
}

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check the current budget status without incrementing.
 */
export async function checkBudget(): Promise<BudgetCheck> {
  const yearMonth = getCurrentYearMonth();
  const budget = await prisma.apiCallBudget.upsert({
    where: { yearMonth },
    update: {},
    create: { yearMonth, callsUsed: 0, callsCap: 125000 },
  });

  const percentUsed = budget.callsCap > 0 ? (budget.callsUsed / budget.callsCap) * 100 : 0;

  let status: BudgetStatus = 'ok';
  if (percentUsed >= 100) status = 'all_blocked';
  else if (percentUsed >= 95) status = 'sync_blocked';
  else if (percentUsed >= 90) status = 'warning';

  return {
    status,
    callsUsed: budget.callsUsed,
    callsCap: budget.callsCap,
    percentUsed: Math.round(percentUsed * 100) / 100,
    yearMonth,
  };
}

/**
 * Increment the budget counter by the given number of calls.
 * Call this after a successful Metrc API call (or batch of calls).
 */
export async function incrementBudget(calls: number = 1): Promise<void> {
  const yearMonth = getCurrentYearMonth();
  await prisma.apiCallBudget.upsert({
    where: { yearMonth },
    update: {
      callsUsed: { increment: calls },
      lastUpdatedAt: new Date(),
    },
    create: {
      yearMonth,
      callsUsed: calls,
      callsCap: 125000,
    },
  });
}

/**
 * Guard for sync jobs: checks budget and returns whether to proceed.
 * Sync jobs should stop when budget is at 95%+ (sync_blocked or all_blocked).
 */
export async function canSync(): Promise<{ allowed: boolean; budget: BudgetCheck }> {
  const budget = await checkBudget();
  return {
    allowed: budget.status === 'ok' || budget.status === 'warning',
    budget,
  };
}

/**
 * Guard for mutations: checks budget and returns whether to proceed.
 * Mutations only stop at 100% (all_blocked). They get priority over sync.
 */
export async function canMutate(): Promise<{ allowed: boolean; budget: BudgetCheck }> {
  const budget = await checkBudget();
  return {
    allowed: budget.status !== 'all_blocked',
    budget,
  };
}
