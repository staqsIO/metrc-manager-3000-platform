// Disposition Tracking Engine (FOR-1184)
// Pure functions — no React, no Prisma, no tRPC imports

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DispositionCategory = 'sample' | 'vendor_day' | 'promo' | 'damage' | 'waste';

export const DISPOSITION_CATEGORIES: DispositionCategory[] = [
  'sample', 'vendor_day', 'promo', 'damage', 'waste',
];

export const DISPOSITION_CATEGORY_LABELS: Record<DispositionCategory, string> = {
  sample: 'Sample',
  vendor_day: 'Vendor Day',
  promo: 'Promo',
  damage: 'Damage',
  waste: 'Waste',
};

export interface CategoryLimit {
  units: number | null;   // null = unlimited
  value: number | null;   // null = unlimited (dollars)
}

export interface DispositionPolicyData {
  isEnabled: boolean;
  categoryLimits: Partial<Record<DispositionCategory, CategoryLimit>>;
  allowBudgetOverride: boolean;
  requireNote: boolean;
  alertThreshold: number; // 0.0-1.0, default 0.85
}

export interface DispositionRecordData {
  category: DispositionCategory;
  quantity: number;
  estimatedValue: number;
  createdAt: Date;
}

export interface MonthlyUsage {
  units: number;
  value: number;
  count: number;
}

export interface BudgetStatus {
  category: DispositionCategory;
  label: string;
  monthlyUsage: MonthlyUsage;
  limit: CategoryLimit;
  unitsRemaining: number | null;  // null = unlimited
  valueRemaining: number | null;  // null = unlimited
  unitsFraction: number | null;   // 0.0-1.0, null = unlimited
  valueFraction: number | null;   // 0.0-1.0, null = unlimited
  status: 'ok' | 'warning' | 'exceeded';
}

export interface DispositionSummary {
  month: string; // YYYY-MM
  totalUnits: number;
  totalValue: number;
  totalCount: number;
  byCategory: Record<DispositionCategory, MonthlyUsage>;
  budgets: BudgetStatus[];
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  budgetAfter?: BudgetStatus;
}

// ---------------------------------------------------------------------------
// Parsers (safe JSON field parsing, same pattern as auto-discount)
// ---------------------------------------------------------------------------

export function parseCategoryLimits(raw: unknown): Partial<Record<DispositionCategory, CategoryLimit>> {
  if (!raw) return {};
  let obj: unknown;
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  if (!obj || typeof obj !== 'object') return {};

  const result: Partial<Record<DispositionCategory, CategoryLimit>> = {};
  for (const cat of DISPOSITION_CATEGORIES) {
    const entry = (obj as Record<string, unknown>)[cat];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      result[cat] = {
        units: typeof e.units === 'number' && e.units >= 0 ? e.units : null,
        value: typeof e.value === 'number' && e.value >= 0 ? e.value : null,
      };
    }
  }
  return result;
}

/** Convert a raw Prisma policy row (or null) into the pure-data DispositionPolicyData.
 *  Centralizes defaults so callers don't duplicate them. */
export function toPolicyData(policy: {
  isEnabled?: boolean;
  categoryLimits?: unknown;
  allowBudgetOverride?: boolean;
  requireNote?: boolean;
  alertThreshold?: number;
} | null | undefined): DispositionPolicyData {
  return {
    isEnabled: policy?.isEnabled ?? true,
    categoryLimits: parseCategoryLimits(policy?.categoryLimits),
    allowBudgetOverride: policy?.allowBudgetOverride ?? false,
    requireNote: policy?.requireNote ?? true,
    alertThreshold: policy?.alertThreshold ?? 0.85,
  };
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/** Compute monthly usage from disposition records for a given month. */
export function computeMonthlyUsage(
  records: DispositionRecordData[],
  month: string, // YYYY-MM
): Record<DispositionCategory, MonthlyUsage> {
  const result: Record<DispositionCategory, MonthlyUsage> = {
    sample: { units: 0, value: 0, count: 0 },
    vendor_day: { units: 0, value: 0, count: 0 },
    promo: { units: 0, value: 0, count: 0 },
    damage: { units: 0, value: 0, count: 0 },
    waste: { units: 0, value: 0, count: 0 },
  };

  for (const r of records) {
    const recordMonth = `${r.createdAt.getFullYear()}-${String(r.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (recordMonth !== month) continue;
    if (!DISPOSITION_CATEGORIES.includes(r.category as DispositionCategory)) continue;

    const cat = r.category as DispositionCategory;
    result[cat].units += r.quantity;
    result[cat].value += r.estimatedValue;
    result[cat].count += 1;
  }

  return result;
}

/** Compute budget status for each category. */
export function computeBudgetStatuses(
  usage: Record<DispositionCategory, MonthlyUsage>,
  limits: Partial<Record<DispositionCategory, CategoryLimit>>,
  alertThreshold: number,
): BudgetStatus[] {
  return DISPOSITION_CATEGORIES.map((cat) => {
    const monthlyUsage = usage[cat];
    const limit = limits[cat] ?? { units: null, value: null };

    const unitsRemaining = limit.units != null ? Math.max(0, limit.units - monthlyUsage.units) : null;
    const valueRemaining = limit.value != null ? Math.max(0, limit.value - monthlyUsage.value) : null;
    const unitsFraction = limit.units != null && limit.units > 0 ? monthlyUsage.units / limit.units : null;
    const valueFraction = limit.value != null && limit.value > 0 ? monthlyUsage.value / limit.value : null;

    const maxFraction = Math.max(unitsFraction ?? 0, valueFraction ?? 0);
    let status: BudgetStatus['status'] = 'ok';
    if (maxFraction > 1) status = 'exceeded';
    else if (maxFraction >= alertThreshold) status = 'warning';

    return {
      category: cat,
      label: DISPOSITION_CATEGORY_LABELS[cat],
      monthlyUsage,
      limit,
      unitsRemaining,
      valueRemaining,
      unitsFraction,
      valueFraction,
      status,
    };
  });
}

/** Build a full disposition summary for a given month. */
export function buildDispositionSummary(
  records: DispositionRecordData[],
  policy: DispositionPolicyData,
  month?: string, // defaults to current month (server UTC)
): DispositionSummary {
  const now = new Date();
  const m = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const byCategory = computeMonthlyUsage(records, m);

  let totalUnits = 0;
  let totalValue = 0;
  let totalCount = 0;
  for (const cat of DISPOSITION_CATEGORIES) {
    totalUnits += byCategory[cat].units;
    totalValue += byCategory[cat].value;
    totalCount += byCategory[cat].count;
  }

  const budgets = computeBudgetStatuses(byCategory, policy.categoryLimits, policy.alertThreshold);

  return { month: m, totalUnits, totalValue, totalCount, byCategory, budgets };
}

/** Validate a proposed disposition against policy limits. */
export function validateDisposition(
  category: DispositionCategory,
  quantity: number,
  estimatedValue: number,
  currentUsage: Record<DispositionCategory, MonthlyUsage>,
  policy: DispositionPolicyData,
): ValidationResult {
  if (!policy.isEnabled) {
    return { allowed: false, reason: 'Disposition tracking is disabled for this facility.' };
  }

  const limit = policy.categoryLimits[category];
  if (!limit) {
    // No limit configured for this category — allowed
    return { allowed: true };
  }

  const usage = currentUsage[category];
  const newUnits = usage.units + quantity;
  const newValue = usage.value + estimatedValue;

  if (limit.units != null && newUnits > limit.units) {
    return {
      allowed: false,
      reason: `Monthly ${DISPOSITION_CATEGORY_LABELS[category]} unit limit would be exceeded (${newUnits.toFixed(1)} / ${limit.units} units).`,
    };
  }

  if (limit.value != null && newValue > limit.value) {
    return {
      allowed: false,
      reason: `Monthly ${DISPOSITION_CATEGORY_LABELS[category]} value limit would be exceeded ($${newValue.toFixed(2)} / $${limit.value.toFixed(2)}).`,
    };
  }

  return { allowed: true };
}

/** Generate compliance alert descriptions for categories approaching or exceeding limits. */
export function checkDispositionBudgets(
  summary: DispositionSummary,
): Array<{ category: DispositionCategory; severity: 'WARNING' | 'CRITICAL'; title: string; description: string }> {
  const alerts: Array<{ category: DispositionCategory; severity: 'WARNING' | 'CRITICAL'; title: string; description: string }> = [];

  for (const budget of summary.budgets) {
    if (budget.status === 'exceeded') {
      alerts.push({
        category: budget.category,
        severity: 'CRITICAL',
        title: `${budget.label} disposition limit exceeded`,
        description: `${budget.label} dispositions have exceeded the monthly limit: ${budget.monthlyUsage.units.toFixed(1)} units used` +
          (budget.limit.units != null ? ` (limit: ${budget.limit.units})` : '') +
          `, $${budget.monthlyUsage.value.toFixed(2)} value` +
          (budget.limit.value != null ? ` (limit: $${budget.limit.value.toFixed(2)})` : '') + '.',
      });
    } else if (budget.status === 'warning') {
      const pct = Math.round(Math.max(budget.unitsFraction ?? 0, budget.valueFraction ?? 0) * 100);
      alerts.push({
        category: budget.category,
        severity: 'WARNING',
        title: `${budget.label} disposition budget ${pct}% consumed`,
        description: `${budget.label} dispositions are at ${pct}% of the monthly limit: ${budget.monthlyUsage.units.toFixed(1)} units, $${budget.monthlyUsage.value.toFixed(2)} value.`,
      });
    }
  }

  return alerts;
}
