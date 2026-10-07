/**
 * Margin Engine
 *
 * Joins per-package wholesale cost (PackageCostSnapshot, hydrated by
 * wholesale-cost-sync) with per-package retail sales (RetailSale, hydrated
 * by retail-sales-sync) to compute farm-to-cash margin without requiring
 * Dutchie/Swede integration.
 *
 * Pure functions on the inputs — no Prisma/tRPC. Callers fetch the rows
 * and pass projected DTOs in. This keeps the engine testable in isolation
 * and lets it compose with other data sources (e.g., Canix purchase orders
 * could feed CostInput[] alongside SWP snapshots).
 *
 * Intra-org transfer rule: cost is
 * cost. When the same org owns the shipper and receiver, the wholesale
 * price is STILL legitimate cost at the receiver. Do NOT net out intra-org
 * transfers from margin computation. Margin = saleUnitPrice - costUnitPrice
 * regardless of upstream ownership.
 */

export interface CostInput {
  packageLabel: string;
  unitCost: number;
  /** ISO date when the cost was captured (used for temporal ordering). */
  capturedAt: string;
  /** Optional source label for provenance display. */
  source?: string;
}

export interface SaleInput {
  packageLabel: string;
  receiptId: number;
  receiptNumber: string;
  productName: string;
  productCategory: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  /** ISO date when the sale happened. */
  soldAt: string;
}

export interface PackageMargin {
  packageLabel: string;
  productName: string;
  productCategory: string | null;
  unitCost: number;
  unitPrice: number;
  marginPerUnit: number;
  marginPct: number;
  quantitySold: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  daysToSell: number | null;
  costSource: string | null;
}

export interface MarginRollup {
  groupKey: string;
  groupLabel: string;
  packageCount: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  marginPct: number;
  unitsSold: number;
}

export interface SellThroughEntry {
  productCategory: string;
  packageCount: number;
  medianDaysToSell: number | null;
  p90DaysToSell: number | null;
  totalRevenue: number;
}

/**
 * Build a per-package cost lookup. When multiple snapshots exist for the
 * same package, the most recent one wins.
 */
export function buildCostLookup(costs: CostInput[]): Map<string, CostInput> {
  const map = new Map<string, CostInput>();
  for (const cost of costs) {
    if (!cost.packageLabel || !(cost.unitCost > 0)) continue;
    const existing = map.get(cost.packageLabel);
    if (!existing) {
      map.set(cost.packageLabel, cost);
      continue;
    }
    const existingDate = Date.parse(existing.capturedAt) || 0;
    const newDate = Date.parse(cost.capturedAt) || 0;
    if (newDate >= existingDate) {
      map.set(cost.packageLabel, cost);
    }
  }
  return map;
}

/**
 * Compute per-package margin by joining sales to costs. Returns one entry
 * per UNIQUE packageLabel — if a package was sold across multiple receipts,
 * its margin row aggregates all those sales.
 */
export function computePackageMargins(
  costs: CostInput[],
  sales: SaleInput[],
): PackageMargin[] {
  const costMap = buildCostLookup(costs);

  // Group sales by packageLabel
  const salesByPackage = new Map<string, SaleInput[]>();
  for (const sale of sales) {
    if (!sale.packageLabel) continue;
    const existing = salesByPackage.get(sale.packageLabel);
    if (existing) existing.push(sale);
    else salesByPackage.set(sale.packageLabel, [sale]);
  }

  const margins: PackageMargin[] = [];
  for (const [packageLabel, packageSales] of Array.from(salesByPackage.entries())) {
    const cost = costMap.get(packageLabel);
    if (!cost) continue; // unmatched — skip rather than report a misleading 100% margin

    let quantitySold = 0;
    let totalRevenue = 0;
    let earliestCostDate: number | null = null;
    let latestSaleDate: number | null = null;
    let productName = '';
    let productCategory: string | null = null;

    for (const sale of packageSales) {
      quantitySold += sale.quantity;
      totalRevenue += sale.totalPrice;
      if (!productName) productName = sale.productName;
      if (!productCategory) productCategory = sale.productCategory;
      const sd = Date.parse(sale.soldAt);
      if (!isNaN(sd) && (latestSaleDate === null || sd > latestSaleDate)) {
        latestSaleDate = sd;
      }
    }

    const cd = Date.parse(cost.capturedAt);
    if (!isNaN(cd)) earliestCostDate = cd;

    if (quantitySold <= 0) continue;
    const unitPrice = totalRevenue / quantitySold;
    const totalCost = cost.unitCost * quantitySold;
    const totalMargin = totalRevenue - totalCost;
    const marginPerUnit = unitPrice - cost.unitCost;
    const marginPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;
    const daysToSell =
      earliestCostDate !== null && latestSaleDate !== null
        ? Math.max(0, Math.round((latestSaleDate - earliestCostDate) / (1000 * 60 * 60 * 24)))
        : null;

    margins.push({
      packageLabel,
      productName,
      productCategory,
      unitCost: round2(cost.unitCost),
      unitPrice: round2(unitPrice),
      marginPerUnit: round2(marginPerUnit),
      marginPct: round4(marginPct),
      quantitySold: round2(quantitySold),
      totalRevenue: round2(totalRevenue),
      totalCost: round2(totalCost),
      totalMargin: round2(totalMargin),
      daysToSell,
      costSource: cost.source ?? null,
    });
  }

  return margins;
}

/**
 * Roll margins up by category (or any string key projection function).
 * Returns groups sorted by totalRevenue descending.
 */
export function rollupMargins(
  margins: PackageMargin[],
  groupBy: 'category' | ((m: PackageMargin) => { key: string; label: string }),
): MarginRollup[] {
  const projector =
    typeof groupBy === 'function'
      ? groupBy
      : (m: PackageMargin) => ({
          key: (m.productCategory ?? 'Uncategorized').toLowerCase(),
          label: m.productCategory ?? 'Uncategorized',
        });

  const groups = new Map<string, MarginRollup>();
  for (const m of margins) {
    const proj = projector(m);
    const existing = groups.get(proj.key);
    if (existing) {
      existing.packageCount++;
      existing.totalRevenue += m.totalRevenue;
      existing.totalCost += m.totalCost;
      existing.totalMargin += m.totalMargin;
      existing.unitsSold += m.quantitySold;
    } else {
      groups.set(proj.key, {
        groupKey: proj.key,
        groupLabel: proj.label,
        packageCount: 1,
        totalRevenue: m.totalRevenue,
        totalCost: m.totalCost,
        totalMargin: m.totalMargin,
        marginPct: 0,
        unitsSold: m.quantitySold,
      });
    }
  }

  const out = Array.from(groups.values()).map(g => ({
    ...g,
    totalRevenue: round2(g.totalRevenue),
    totalCost: round2(g.totalCost),
    totalMargin: round2(g.totalMargin),
    unitsSold: round2(g.unitsSold),
    marginPct: round4(g.totalRevenue > 0 ? g.totalMargin / g.totalRevenue : 0),
  }));
  out.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return out;
}

/**
 * Compute median + p90 days-to-sell per category.
 */
export function computeSellThrough(margins: PackageMargin[]): SellThroughEntry[] {
  const byCategory = new Map<string, { days: number[]; revenue: number; count: number }>();
  for (const m of margins) {
    const cat = m.productCategory ?? 'Uncategorized';
    const bucket = byCategory.get(cat) ?? { days: [], revenue: 0, count: 0 };
    bucket.revenue += m.totalRevenue;
    bucket.count++;
    if (m.daysToSell !== null) bucket.days.push(m.daysToSell);
    byCategory.set(cat, bucket);
  }

  const entries: SellThroughEntry[] = [];
  for (const [category, b] of Array.from(byCategory.entries())) {
    const sorted = b.days.slice().sort((a: number, c: number) => a - c);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? null : null;
    const p90Idx = Math.max(0, Math.floor(sorted.length * 0.9) - 1);
    const p90 = sorted.length > 0 ? sorted[p90Idx] ?? null : null;
    entries.push({
      productCategory: category,
      packageCount: b.count,
      medianDaysToSell: median,
      p90DaysToSell: p90,
      totalRevenue: round2(b.revenue),
    });
  }
  entries.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return entries;
}

/**
 * Top sellers by total revenue (across all matched packages).
 */
export function getTopSellers(margins: PackageMargin[], limit = 10): PackageMargin[] {
  return margins
    .slice()
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// WS6.6 — Provenance-aware margin join
// ---------------------------------------------------------------------------

/**
 * Ancestor-resolution result for a single sale's package label. The margin
 * engine stores this alongside each `PackageMargin` as `resolvedCost` so
 * downstream UIs can show the user WHERE the cost came from (direct match,
 * grandparent, great-grandparent, etc.) or WHY it's null.
 */
export type ResolvedCostReason =
  | 'direct'
  | 'provenance_ancestor'
  | 'multi_parent_ambiguous'
  | 'unit_mismatch'
  | 'no_ancestor';

export interface ResolvedCost {
  reason: ResolvedCostReason;
  unitCost: number | null;
  /** 0 = direct, 1 = immediate parent, etc. Null when no ancestor matched. */
  provenanceDepth: number | null;
  /** Cost's source label (from CostInput.source), if any. */
  costSource: string | null;
}

/**
 * Provenance-aware package summary. Extends `PackageMargin` with fields
 * that describe how the cost was resolved. Used by the Copilot margin tool
 * and the UI so operators can see the cost trail explicitly.
 */
export interface ProvenanceAwarePackageMargin extends PackageMargin {
  /** How the cost was resolved: direct, ancestor, ambiguous, unit mismatch. */
  costReason: ResolvedCostReason;
  provenanceDepth: number | null;
}

/**
 * Unresolved sale: package sold but no cost could be attributed even
 * after walking the provenance DAG. The Copilot response lists these
 * explicitly so operators can drill into lineage gaps.
 */
export interface UnresolvedSale {
  packageLabel: string;
  productName: string;
  productCategory: string | null;
  quantitySold: number;
  totalRevenue: number;
  reason: Exclude<ResolvedCostReason, 'direct' | 'provenance_ancestor'>;
}

export interface ProvenanceMarginResult {
  margins: ProvenanceAwarePackageMargin[];
  unresolved: UnresolvedSale[];
  /** Counts per resolution bucket — surfaces at the top of Copilot answers. */
  resolutionCounts: {
    direct: number;
    ancestor: number;
    unitMismatch: number;
    multiParent: number;
    noAncestor: number;
  };
}

/**
 * Minimal subset of `ProvenanceIndex` this engine needs — accepts a
 * structurally-typed index so consumers in tests can hand-roll a tiny
 * mock without importing the full engine.
 */
export interface ProvenanceLookup {
  backwardEdges: Map<string, Set<string>>;
  /**
   * Minimal package-shape lookup. Only needs the fields we use for
   * unit-mismatch checks — keeps the contract narrow so the engine
   * doesn't depend on the full MetrcPackage interface.
   */
  packageMap: Map<string, { UnitOfMeasureName?: string }>;
}

/** Maximum depth to walk the provenance DAG when resolving a cost. */
const PROVENANCE_MAX_DEPTH = 6;

/**
 * Walk backward through `provenance.backwardEdges` from a sale's package
 * label until the first ancestor with a cost in `costMap` is found.
 *
 * Linus's blockers:
 *   - Multi-parent ambiguity: when BFS finds multiple parent ancestors at
 *     the same depth with different costs, return `null` + reason
 *     `multi_parent_ambiguous`. NEVER pass a guessed average downstream.
 *   - Unit mismatch: when the ancestor package's UoM does not match the
 *     sale's UoM (e.g., gram flower → each pre-roll), return `null` +
 *     reason `unit_mismatch`. Unit conversion is a v2 feature.
 *   - Cycle safety: visited set + depth cap prevents infinite loops.
 *   - Depth cap: PROVENANCE_MAX_DEPTH = 6 (practical lineage length in
 *     cannabis manufacturing, based on Southgate's typical chain).
 */
export function resolveCostViaProvenance(
  saleLabel: string,
  saleUnitOfMeasure: string | null | undefined,
  costMap: Map<string, CostInput>,
  provenance: ProvenanceLookup,
  maxDepth: number = PROVENANCE_MAX_DEPTH,
): ResolvedCost {
  // Direct match — no walk needed.
  const direct = costMap.get(saleLabel);
  if (direct && direct.unitCost > 0) {
    return {
      reason: 'direct',
      unitCost: direct.unitCost,
      provenanceDepth: 0,
      costSource: direct.source ?? null,
    };
  }

  // BFS backward through the DAG.
  type Frame = { label: string; depth: number };
  const queue: Frame[] = [{ label: saleLabel, depth: 0 }];
  const visited = new Set<string>([saleLabel]);
  /** Frames at the same depth where we found a cost, grouped for ambiguity check. */
  let foundDepth: number | null = null;
  const foundAncestors: Array<{ label: string; cost: CostInput }> = [];

  while (queue.length > 0) {
    const frame = queue.shift()!;
    if (frame.depth >= maxDepth) continue;
    if (foundDepth !== null && frame.depth > foundDepth) break;

    const parents = provenance.backwardEdges.get(frame.label);
    if (!parents) continue;

    for (const parentLabel of Array.from(parents)) {
      if (visited.has(parentLabel)) continue;
      visited.add(parentLabel);

      const ancestorCost = costMap.get(parentLabel);
      if (ancestorCost && ancestorCost.unitCost > 0) {
        // Stop descending below this depth, but collect all matches at
        // the same depth to detect multi-parent ambiguity.
        if (foundDepth === null) foundDepth = frame.depth + 1;
        if (frame.depth + 1 === foundDepth) {
          foundAncestors.push({ label: parentLabel, cost: ancestorCost });
        }
      } else {
        // Keep walking up through parents that have no cost.
        queue.push({ label: parentLabel, depth: frame.depth + 1 });
      }
    }
  }

  if (foundAncestors.length === 0) {
    return {
      reason: 'no_ancestor',
      unitCost: null,
      provenanceDepth: null,
      costSource: null,
    };
  }

  // Multi-parent ambiguity: multiple ancestors at the same depth with
  // different costs. Do NOT average — return null + reason so the caller
  // can flag this explicitly instead of passing a guessed number.
  if (foundAncestors.length > 1) {
    const distinctCosts = new Set(foundAncestors.map(a => Math.round(a.cost.unitCost * 10000)));
    if (distinctCosts.size > 1) {
      return {
        reason: 'multi_parent_ambiguous',
        unitCost: null,
        provenanceDepth: foundDepth,
        costSource: null,
      };
    }
    // All ancestors at this depth report the same cost — it's safe.
  }

  const winner = foundAncestors[0]!;

  // Unit mismatch check — ancestor's package UoM vs sale's UoM. When the
  // sale's UoM is missing we let it through (the caller is responsible
  // for stripping UoM-sensitive math; preserving the historical behavior
  // where costs attributed via lineage still show up in rollups).
  const ancestorPkg = provenance.packageMap.get(winner.label);
  if (
    saleUnitOfMeasure &&
    ancestorPkg?.UnitOfMeasureName &&
    ancestorPkg.UnitOfMeasureName !== saleUnitOfMeasure
  ) {
    return {
      reason: 'unit_mismatch',
      unitCost: null,
      provenanceDepth: foundDepth,
      costSource: winner.cost.source ?? null,
    };
  }

  return {
    reason: 'provenance_ancestor',
    unitCost: winner.cost.unitCost,
    provenanceDepth: foundDepth,
    costSource: winner.cost.source ?? null,
  };
}

/**
 * Per-sale unit-of-measure hint. Callers populate this map from the
 * `RetailSale.unitOfMeasure` column (or equivalent) so the engine can
 * detect unit mismatches when walking ancestors without loading the
 * full MetrcPackage catalog.
 */
export type SaleUomMap = Map<string, string | null>;

/**
 * Provenance-aware margin computation. Same shape as
 * `computePackageMargins` but with a provenance fallback when direct
 * cost lookup misses.
 *
 * For each sale's package label:
 *   1. Try direct cost lookup → costReason='direct'
 *   2. Walk backwardEdges up to PROVENANCE_MAX_DEPTH → 'provenance_ancestor'
 *   3. Multi-parent ambiguity → 'multi_parent_ambiguous' + null cost
 *   4. Unit mismatch → 'unit_mismatch' + null cost
 *   5. Nothing found → 'no_ancestor' + null cost
 *
 * Resolution buckets with `null` cost produce `UnresolvedSale` entries
 * instead of polluting the margins list with fake numbers (Linus blocker:
 * null is correct when the answer is unknown, never a best-guess).
 */
export function computeProvenanceAwareMargins(
  costs: CostInput[],
  sales: SaleInput[],
  provenance: ProvenanceLookup,
  saleUoms?: SaleUomMap,
): ProvenanceMarginResult {
  const costMap = buildCostLookup(costs);

  // Group sales by packageLabel — same as computePackageMargins.
  const salesByPackage = new Map<string, SaleInput[]>();
  for (const sale of sales) {
    if (!sale.packageLabel) continue;
    const existing = salesByPackage.get(sale.packageLabel);
    if (existing) existing.push(sale);
    else salesByPackage.set(sale.packageLabel, [sale]);
  }

  const margins: ProvenanceAwarePackageMargin[] = [];
  const unresolved: UnresolvedSale[] = [];
  const counts = {
    direct: 0,
    ancestor: 0,
    unitMismatch: 0,
    multiParent: 0,
    noAncestor: 0,
  };

  for (const [packageLabel, packageSales] of Array.from(salesByPackage.entries())) {
    const saleUom = saleUoms?.get(packageLabel) ?? null;
    const resolved = resolveCostViaProvenance(
      packageLabel,
      saleUom,
      costMap,
      provenance,
    );

    // Aggregate the sale-side numbers once per package (same as legacy).
    let quantitySold = 0;
    let totalRevenue = 0;
    let latestSaleDate: number | null = null;
    let productName = '';
    let productCategory: string | null = null;

    for (const sale of packageSales) {
      quantitySold += sale.quantity;
      totalRevenue += sale.totalPrice;
      if (!productName) productName = sale.productName;
      if (!productCategory) productCategory = sale.productCategory;
      const sd = Date.parse(sale.soldAt);
      if (!isNaN(sd) && (latestSaleDate === null || sd > latestSaleDate)) {
        latestSaleDate = sd;
      }
    }
    if (quantitySold <= 0) continue;

    // Unresolved bucket: cost is null — do NOT compute a margin number.
    if (resolved.unitCost === null) {
      const reason =
        resolved.reason === 'direct' || resolved.reason === 'provenance_ancestor'
          ? 'no_ancestor' // defensive — shouldn't hit, but narrow the type
          : resolved.reason;
      unresolved.push({
        packageLabel,
        productName,
        productCategory,
        quantitySold: round2(quantitySold),
        totalRevenue: round2(totalRevenue),
        reason,
      });
      if (reason === 'unit_mismatch') counts.unitMismatch++;
      else if (reason === 'multi_parent_ambiguous') counts.multiParent++;
      else counts.noAncestor++;
      continue;
    }

    // Resolved: direct or ancestor.
    if (resolved.reason === 'direct') counts.direct++;
    else counts.ancestor++;

    const unitPrice = totalRevenue / quantitySold;
    const unitCost = resolved.unitCost;
    const totalCost = unitCost * quantitySold;
    const totalMargin = totalRevenue - totalCost;
    const marginPerUnit = unitPrice - unitCost;
    const marginPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;

    // Days-to-sell requires an earliest-cost timestamp, which we don't
    // track for provenance ancestors. Return null rather than mislead.
    const daysToSell = null;

    margins.push({
      packageLabel,
      productName,
      productCategory,
      unitCost: round2(unitCost),
      unitPrice: round2(unitPrice),
      marginPerUnit: round2(marginPerUnit),
      marginPct: round4(marginPct),
      quantitySold: round2(quantitySold),
      totalRevenue: round2(totalRevenue),
      totalCost: round2(totalCost),
      totalMargin: round2(totalMargin),
      daysToSell,
      costSource: resolved.costSource,
      costReason: resolved.reason,
      provenanceDepth: resolved.provenanceDepth,
    });
  }

  return { margins, unresolved, resolutionCounts: counts };
}

// ----- helpers -----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
