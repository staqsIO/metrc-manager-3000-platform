import { z } from 'zod';
import { createTRPCRouter, platformProcedure } from '@/lib/trpc';
import { dashboardPrisma } from '@/lib/prisma';
import { getUserOrgIds } from '@/lib/auth-helpers';
import {
  getActivePackagesFromDb,
  getAllHarvestsFromDb,
  getLabTestResultsFromDb,
} from '@/services/metrc/snapshot-utils';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { computeRunRates, normalizeCategory, type RunRateStatus } from '@/services/engines/run-rate-engine';
import { computeProductionRates, type CategoryProductionRate } from '@/services/engines/production-rate-engine';
import { computeLabTurnaround, type LabTurnaroundResult } from '@/services/engines/lab-turnaround-engine';
import {
  aggregateProcessingYield,
  gramsToPounds,
  type FacilityProcessingMetrics,
} from '@/services/engines/processing-yield-engine';
import { getCanixClient } from '@/services/canix/canix-factory';
import {
  getSearchIndex,
  setSearchIndex,
  searchAcrossFacilities,
} from '@/services/metrc/search-index';
import { compareAcrossFacilities, normalizeStrainName } from '@/services/analytics/strain-comparison';
import type { PerFacilityStrainMetrics, CrossFacilityStrainComparison } from '@/services/analytics/strain-comparison';
import {
  STAGE_ROOM_MAPPINGS,
  buildStageRoomLookup,
  isStageMapped,
  type PipelineStageKey,
} from '@/services/engines/pipeline-stages';
import { computeBriefingMetrics } from './copilot';
import type { MetrcFacility } from '@prisma/client';
import type { MetrcHarvest, MetrcPackage, MetrcLabTest } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Constants — aligned with classifySupply() in run-rate-engine.ts
// ---------------------------------------------------------------------------

const EXCESS_THRESHOLD_WEEKS = 12;
const LOW_THRESHOLD_WEEKS = 4;
const TARGET_WEEKS_AFTER_TRANSFER = 8;
const CRITICAL_THRESHOLD_WEEKS = 1;
const API_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Strain comparison cache — module-level, 5-min TTL, follows search-index.ts pattern
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-facility result cache — expensive queries cached server-side.
// Snapshot data changes daily via cron, so 5-min TTL is safe.
// ---------------------------------------------------------------------------

const RESULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const resultCache = new Map<string, { data: unknown; expiresAt: number }>();

function getCachedResult<T>(key: string): T | null {
  const entry = resultCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) resultCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCachedResult(key: string, data: unknown): void {
  resultCache.set(key, { data, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });
  // Evict stale entries if over 50
  if (resultCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of Array.from(resultCache.entries())) {
      if (now > v.expiresAt) resultCache.delete(k);
    }
  }
}

const STRAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_STRAIN_CACHE_SIZE = 200;

interface StrainCacheEntry {
  metrics: PerFacilityStrainMetrics;
  expiresAt: number;
}

const strainCache = new Map<string, StrainCacheEntry>();

function getStrainCacheEntry(facilityId: string): PerFacilityStrainMetrics | null {
  const entry = strainCache.get(facilityId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    strainCache.delete(facilityId);
    return null;
  }
  return entry.metrics;
}

function setStrainCacheEntry(facilityId: string, metrics: PerFacilityStrainMetrics): void {
  // Evict oldest entry if at capacity (and we're not updating an existing key)
  if (!strainCache.has(facilityId) && strainCache.size >= MAX_STRAIN_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    Array.from(strainCache.entries()).forEach(function ([key, entry]: [string, StrainCacheEntry]) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    });
    if (oldestKey) strainCache.delete(oldestKey);
  }

  strainCache.set(facilityId, {
    metrics,
    expiresAt: Date.now() + STRAIN_CACHE_TTL_MS,
  });
}

/** Returns cached strain metrics only for the specified facility IDs (org-scoped). */
export function getStrainCacheForFacilities(facilityIds: string[]): PerFacilityStrainMetrics[] {
  const now = Date.now();
  const result: PerFacilityStrainMetrics[] = [];
  for (let i = 0; i < facilityIds.length; i++) {
    const entry = strainCache.get(facilityIds[i]);
    if (entry && now <= entry.expiresAt) {
      result.push(entry.metrics);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: compute per-facility strain metrics from raw Metrc data
// ---------------------------------------------------------------------------

function computeStrainMetrics(
  facilityId: string,
  facilityName: string,
  stateCode: string,
  harvests: MetrcHarvest[],
  packages: MetrcPackage[],
  labTests: MetrcLabTest[],
): PerFacilityStrainMetrics {
  // Build yield & harvest count per strain from harvests
  const yieldByStrain = new Map<string, { totalYield: number; harvestCount: number }>();
  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi];
    if (!harvest.SourceStrainNames) continue;
    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean);
    const totalWeight = harvest.CurrentWeight + harvest.TotalPackagedWeight;
    const weightPerStrain = names.length > 1 ? totalWeight / names.length : totalWeight;
    for (let ni = 0; ni < names.length; ni++) {
      const existing = yieldByStrain.get(names[ni]) ?? { totalYield: 0, harvestCount: 0 };
      existing.totalYield += weightPerStrain;
      existing.harvestCount += 1;
      yieldByStrain.set(names[ni], existing);
    }
  }

  // Build growth days per strain from finished harvests
  const growthByStrain = new Map<string, number[]>();
  for (let hi = 0; hi < harvests.length; hi++) {
    const harvest = harvests[hi];
    if (!harvest.FinishedDate || !harvest.SourceStrainNames) continue;
    const start = new Date(harvest.HarvestStartDate);
    const end = new Date(harvest.FinishedDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    if (days <= 0) continue;
    const names = harvest.SourceStrainNames.split(',').map(function (s: string) { return s.trim() }).filter(Boolean);
    for (let ni = 0; ni < names.length; ni++) {
      const list = growthByStrain.get(names[ni]) ?? [];
      list.push(days);
      growthByStrain.set(names[ni], list);
    }
  }

  // Build lab pass rate per strain: map package label -> strain, then count pass/fail
  const packageStrainMap = new Map<string, string>();
  for (let pi = 0; pi < packages.length; pi++) {
    const pkg = packages[pi];
    if (pkg.ItemStrainName && pkg.Label) {
      packageStrainMap.set(pkg.Label, pkg.ItemStrainName);
    }
  }

  const labByStrain = new Map<string, { passed: number; total: number }>();
  for (let li = 0; li < labTests.length; li++) {
    const test = labTests[li];
    const strain = packageStrainMap.get(test.PackageLabel);
    if (!strain) continue;
    const existing = labByStrain.get(strain) ?? { passed: 0, total: 0 };
    existing.total += 1;
    if (test.OverallPassed) existing.passed += 1;
    labByStrain.set(strain, existing);
  }

  // Merge all strain names (union of yield + growth + lab data)
  const allStrainNames = new Set<string>();
  Array.from(yieldByStrain.keys()).forEach(function (k: string) { allStrainNames.add(k); });
  Array.from(growthByStrain.keys()).forEach(function (k: string) { allStrainNames.add(k); });
  Array.from(labByStrain.keys()).forEach(function (k: string) { allStrainNames.add(k); });

  const strainMetrics: PerFacilityStrainMetrics['strains'] = [];
  const strainNamesArr = Array.from(allStrainNames);
  for (let sni = 0; sni < strainNamesArr.length; sni++) {
    const rawName = strainNamesArr[sni];
    const yieldData = yieldByStrain.get(rawName) ?? { totalYield: 0, harvestCount: 0 };
    const avgYieldEfficiency = yieldData.harvestCount > 0
      ? Math.round((yieldData.totalYield / yieldData.harvestCount) * 100) / 100
      : 0;

    const growthDaysList = growthByStrain.get(rawName) ?? [];
    let avgGrowthDays = 0;
    if (growthDaysList.length > 0) {
      let sum = 0;
      for (let gi = 0; gi < growthDaysList.length; gi++) sum += growthDaysList[gi];
      avgGrowthDays = Math.round(sum / growthDaysList.length);
    }

    const labData = labByStrain.get(rawName) ?? { passed: 0, total: 0 };
    const labPassRate = labData.total > 0
      ? Math.round((labData.passed / labData.total) * 1000) / 1000
      : 0;

    strainMetrics.push({
      rawName,
      avgYieldEfficiency,
      labPassRate,
      avgGrowthDays,
      harvestCount: yieldData.harvestCount,
      labTestCount: labData.total,
    });
  }

  return {
    facilityId,
    facilityName,
    stateCode,
    strains: strainMetrics,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellData {
  weeksOfSupply: number | null;
  status: RunRateStatus;
  currentInventory: number;
  weeklySalesRate: number;
}

interface FacilityRunRateEntry {
  facility: MetrcFacility;
  result: Awaited<ReturnType<typeof computeRunRates>>;
}

interface TransferOpportunity {
  category: string;
  fromFacility: { id: string; name: string; stateCode: string; weeksOfSupply: number; currentInventory: number };
  toFacility: { id: string; name: string; stateCode: string; weeksOfSupply: number; currentInventory: number };
  suggestedUnits: number;
  urgency: 'high' | 'medium';
}

interface FacilityInfo {
  id: string;
  name: string;
  stateCode: string;
  facilityType: string | null;
  overallWeeksOfSupply: number | null;
  /**
   * - 'pos' — Dutchie POS sales data
   * - 'retail_sales' — Metrc retail receipts (DB)
   * - 'transfers' — outgoing transfer manifests (live Metrc)
   * - 'historical_transfers' — imported CSV data
   * - 'none' — facility call failed; row is included for visibility with an empty matrix and a skipReason
   */
  dataSource: 'pos' | 'retail_sales' | 'transfers' | 'historical_transfers' | 'none';
  /** Populated only when dataSource === 'none'. Human-readable API/auth error. */
  skipReason?: string;
}

interface SkippedFacility {
  id: string;
  name: string;
  reason: string;
}

interface FacilityGroup {
  key: string;
  label: string;
  facilityIds: string[];
}

interface ComparisonSummary {
  totalFacilities: number;
  activeFacilities: number;
  categoriesWithCritical: number;
  totalTransferOpportunities: number;
}

// ---------------------------------------------------------------------------
// Operations Summary types & constants
// ---------------------------------------------------------------------------

const GRAMS_PER_LB = 453.592;

/** Normalize Metrc weight to grams regardless of UnitOfWeightName. */
function toGrams(weight: number, unit: string): number {
  switch (unit) {
    case 'Ounces': return weight * 28.3495;
    case 'Pounds': return weight * GRAMS_PER_LB;
    case 'Grams':
    default: return weight;
  }
}

interface OpsFacilityMetrics {
  id: string;
  name: string;
  stateCode: string;
  facilityType: string | null;
  /** Wet weight harvested (sum of TotalWetWeight for harvests finished in window). */
  harvestIntakeLbsInWindow: number;
  /** Normalized rate — useful for indoor perpetual cadences; noise for outdoor/long-cycle operators. */
  harvestIntakeLbsPerWeek: number;
  /** Packaged output from harvests finished in window. */
  throughputLbsInWindow: number;
  throughputLbsPerWeek: number;
  wasteRatePercent: number;
  activeHarvestCount: number;
  /** Count of harvests that finished in the window — used by UI to decide whether to show per-week rate. */
  finishedHarvestCount: number;
}

// ---------------------------------------------------------------------------
// Briefing Rollup types
// ---------------------------------------------------------------------------

interface FacilityRollupRow {
  id: string;
  name: string;
  stateCode: string;
  facilityType: string | null;
  metrcEnvironment: string;
  totalPackages: number;
  auditScore: number;
  averageAgeDays: number;
  weeksOfSupply: number | null;
  criticalCount: number;
  warningCount: number;
  /** Up to 2 short labels surfacing the most-pressing issues for inline display.
   *  `action` is a stable discriminator the frontend maps to a deep-link path —
   *  decouples backend issue detection from frontend routing. */
  topIssues: Array<{
    severity: 'critical' | 'warning';
    label: string;
    action: 'audit' | 'aging' | 'fifo' | 'deadstock' | 'onhold';
  }>;
}

interface BriefingRollupResult {
  totals: {
    totalPackages: number;
    /** Weighted by package count across facilities. */
    avgAuditScore: number;
    /** Weighted by package count across facilities. */
    avgAgeDays: number;
    /** Weighted by package count, only across facilities reporting a number. */
    avgWeeksOfSupply: number | null;
    activeFacilities: number;
    /** Sum of critical issue counts across all facilities. */
    totalCriticalCount: number;
    /** Sum of warning issue counts across all facilities. */
    totalWarningCount: number;
  };
  facilities: FacilityRollupRow[];
  skipped: SkippedFacility[];
}

interface OperationsSummaryResult {
  summary: {
    harvestIntakeLbsInWindow: number;
    harvestIntakeLbsPerWeek: number;
    throughputLbsInWindow: number;
    throughputLbsPerWeek: number;
    wasteRatePercent: number;
    activeFacilities: number;
    daysLookback: number;
    /** Per-day lbs intake across the lookback (oldest → newest). Length = daysLookback. */
    dailyHarvestIntakeLbs: number[];
    /** Per-day lbs throughput across the lookback (oldest → newest). */
    dailyThroughputLbs: number[];
    /** Prior-period totals (same length window, immediately preceding) for trend deltas. */
    prior: {
      harvestIntakeLbsInWindow: number;
      throughputLbsInWindow: number;
      wasteRatePercent: number;
    };
  };
  facilities: OpsFacilityMetrics[];
  skipped: SkippedFacility[];
}

// ---------------------------------------------------------------------------
// Quality Summary types
// ---------------------------------------------------------------------------

interface QualityFacilityEntry {
  facility: MetrcFacility;
  packages: MetrcPackage[];
  labTests: MetrcLabTest[];
}

interface QualityFacilityMetrics {
  id: string;
  name: string;
  stateCode: string;
  facilityType: string | null;
  totalPackages: number;
  passedCount: number;
  failedCount: number;
  pendingCount: number;
  submittedCount: number;
  passRate: number;
}

interface QualityStrainRisk {
  strain: string;
  passRate: number;
  testCount: number;
  failCount: number;
}

interface QualitySummaryResult {
  summary: {
    totalPackages: number;
    passedCount: number;
    failedCount: number;
    pendingCount: number;
    submittedCount: number;
    passRate: number;
    activeFacilities: number;
  };
  facilities: QualityFacilityMetrics[];
  topRiskyStrains: QualityStrainRisk[];
  skipped: SkippedFacility[];
}

// ---------------------------------------------------------------------------
// Yield Analytics types
// ---------------------------------------------------------------------------

interface YieldFacilityEntry {
  facility: MetrcFacility;
  active: MetrcHarvest[];
  inactive: MetrcHarvest[];
}

interface YieldFacilityMetrics {
  id: string;
  name: string;
  stateCode: string;
  facilityType: string | null;
  yieldEfficiency: number;
  wasteRate: number;
  harvestCount: number;
  activeHarvestCount: number;
  avgDaysToFinish: number;
}

interface YieldStrainMetrics {
  strain: string;
  yieldEfficiency: number;
  harvestCount: number;
  facilityCount: number;
  avgDaysToFinish: number;
}

interface YieldAnalyticsResult {
  summary: {
    yieldEfficiency: number;
    wasteRate: number;
    totalHarvests: number;
    avgDaysToFinish: number;
    activeFacilities: number;
  };
  facilities: YieldFacilityMetrics[];
  topStrains: YieldStrainMetrics[];
  skipped: SkippedFacility[];
}

interface ComparisonResult {
  facilities: FacilityInfo[];
  categories: string[];
  matrix: Record<string, Record<string, CellData>>;
  transferOpportunities: TransferOpportunity[];
  groups: FacilityGroup[];
  skipped: SkippedFacility[];
  summary: ComparisonSummary;
}

// ---------------------------------------------------------------------------
// Shared helper: resolve user's accessible facilities (auth + org scoping + FOR-1172 ACL)
// ---------------------------------------------------------------------------

export async function getAccessibleFacilities(ctx: {
  session: { user: { id: string; facilityAccess?: Record<string, string> } };
  activeOrgId: string | null;
  prisma: typeof import('@/lib/prisma').prisma;
}): Promise<MetrcFacility[]> {
  let orgIds: string[];
  try {
    orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
  } catch {
    return [];
  }
  const scopedOrgIds =
    ctx.activeOrgId && orgIds.includes(ctx.activeOrgId)
      ? [ctx.activeOrgId]
      : orgIds;

  let facilities = await ctx.prisma.metrcFacility.findMany({
    where: { organizationId: { in: scopedOrgIds }, isActive: true },
  });

  // Filter by facility-level access grants (FOR-1172)
  const facilityAccess: Record<string, string> = ctx.session.user?.facilityAccess ?? {};
  if (Object.keys(facilityAccess).length > 0) {
    const allowedIds = new Set(Object.keys(facilityAccess));
    facilities = facilities.filter(f => allowedIds.has(f.id));
  }

  return facilities;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const crossFacilityRouter = createTRPCRouter({
  getRunRateComparison: platformProcedure
    .input(z.object({
      groupBy: z.enum(['none', 'state', 'facilityType']).optional().default('none'),
      daysLookback: z.number().min(1).max(365).optional().default(30),
    }).optional())
    .query(async ({ ctx, input }): Promise<ComparisonResult> => {
      const groupBy = input?.groupBy ?? 'none';
      const daysLookback = input?.daysLookback ?? 30;

      // Server-side cache: snapshot data changes daily, no need to recompute per request
      // Cache key MUST use ctx.activeOrgId (cookie-derived, updates on org
      // switch) — ctx.session.user.activeOrgId comes from the JWT and only
      // refreshes on re-auth, which made the cache return the previous org's
      // data after switching. getAccessibleFacilities reads the same field.
      const cacheKey = `runrate:${ctx.session.user.id}:${ctx.activeOrgId ?? 'all'}:${groupBy}:${daysLookback}`;
      const cached = getCachedResult<ComparisonResult>(cacheKey);
      if (cached) return cached;

      // 1. Get all user's org IDs, scope to active org if set
      let orgIds: string[];
      try {
        orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
      } catch {
        return emptyResult();
      }
      const scopedOrgIds =
        ctx.activeOrgId && orgIds.includes(ctx.activeOrgId)
          ? [ctx.activeOrgId]
          : orgIds;

      // 2. Get all active facilities across scoped orgs.
      //    Exclude Cultivators — they're B2B and have no consumer sales velocity,
      //    so weeks-of-supply math is always ∞ / meaningless. Cultivators get a
      //    dedicated harvest→transfer view separately (out of scope here).
      const facilities = await ctx.prisma.metrcFacility.findMany({
        where: {
          organizationId: { in: scopedOrgIds },
          isActive: true,
          facilityType: { not: 'Cultivator' },
        },
      });

      if (facilities.length === 0) return emptyResult();

      // 3. Fetch run-rates with bounded concurrency to avoid API rate limits.
      //    Each facility requires both Metrc + Dutchie API calls.
      const successful: FacilityRunRateEntry[] = [];
      const skipped: SkippedFacility[] = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const packages = await getActivePackagesFromDb(ctx.prisma, facility.id);

            // Only call Dutchie if credentials are configured — otherwise DB-only fallback
            const hasDutchie = facility.dutchieEnvironment && facility.dutchieEnvironment !== 'none';
            const dutchieClient = hasDutchie ? getDutchieClient(facility) : getDutchieClient({ ...facility, dutchieEnvironment: 'none' } as typeof facility);

            // Only call Canix if credentials are configured
            let openPOQuantities: Map<string, number> | undefined;
            const hasCanix = facility.canixEnvironment && facility.canixEnvironment !== 'none';
            if (hasCanix) {
              try {
                const canixClient = getCanixClient(facility);
                const purchaseOrders = await canixClient.getPurchaseOrders();
                const openPOs = purchaseOrders.filter(po => ['submitted', 'confirmed', 'in_transit'].includes(po.status));
                if (openPOs.length > 0) {
                  openPOQuantities = new Map();
                  const contents = await Promise.all(openPOs.slice(0, 10).map(po => canixClient.getPurchaseOrderContents(po.id)));
                  for (const items of contents) {
                    for (const li of items) {
                      const cat = normalizeCategory(li.itemName);
                      openPOQuantities.set(cat, (openPOQuantities.get(cat) ?? 0) + li.quantity);
                    }
                  }
                }
              } catch { /* Canix unavailable — proceed without PO data */ }
            }

            const result = await computeRunRates(packages, dutchieClient, { daysLookback, openPOQuantities, prisma: ctx.prisma, facilityId: facility.id });
            return { facility, result };
          })
        );

        // settled results align 1:1 with the batch array
        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          const facility = batch[j]!;
          if (outcome.status === 'fulfilled') {
            successful.push(outcome.value);
          } else {
            skipped.push({
              id: facility.id,
              name: facility.name,
              reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      }

      // 4. Build category union and facility list
      const categorySet = new Set<string>();
      for (const { result } of successful) {
        for (const cat of result.byCategory) {
          categorySet.add(cat.category);
        }
      }
      const categories = Array.from(categorySet).sort();

      const facilityList: FacilityInfo[] = successful.map(({ facility, result }) => ({
        id: facility.id,
        name: facility.name,
        stateCode: facility.stateCode,
        facilityType: facility.facilityType,
        overallWeeksOfSupply: result.overallWeeksOfSupply,
        dataSource: result.dataSource,
      }));

      // Append skipped facilities as visible rows with dataSource: 'none' so the
      // UI can render them inline with a "No data" badge instead of a separate
      // Skipped list. The original facility lookup is by name/id from the skipped
      // array — re-hydrate stateCode/facilityType from the facilities batch.
      const facilityById = new Map(facilities.map((f) => [f.id, f]));
      for (const s of skipped) {
        const f = facilityById.get(s.id);
        if (!f) continue;
        facilityList.push({
          id: f.id,
          name: f.name,
          stateCode: f.stateCode,
          facilityType: f.facilityType,
          overallWeeksOfSupply: null,
          dataSource: 'none',
          skipReason: s.reason,
        });
      }

      // 5. Build heatmap matrix: [facilityId][category] -> CellData
      //    Skipped facilities get an empty row so the grid still iterates them.
      const matrix: Record<string, Record<string, CellData>> = {};
      for (const { facility, result } of successful) {
        const row: Record<string, CellData> = {};
        for (const cat of result.byCategory) {
          row[cat.category] = {
            weeksOfSupply: cat.weeksOfSupply,
            status: cat.status,
            currentInventory: cat.currentInventory,
            weeklySalesRate: cat.weeklySalesRate,
          };
        }
        matrix[facility.id] = row;
      }
      for (const s of skipped) {
        if (!matrix[s.id]) matrix[s.id] = {};
      }

      // 6. Detect transfer opportunities (same-state only — cannabis cannot cross state lines)
      const transferOpportunities = detectTransferOpportunities(successful, categories);

      // 7. Build groups
      let groups: FacilityGroup[] = [];
      if (groupBy !== 'none') {
        const groupMap = new Map<string, string[]>();
        for (const { facility } of successful) {
          const key = groupBy === 'state' ? facility.stateCode : (facility.facilityType || 'Unknown');
          const arr = groupMap.get(key);
          if (arr) arr.push(facility.id);
          else groupMap.set(key, [facility.id]);
        }
        groups = Array.from(groupMap.entries())
          .map(([key, facilityIds]) => ({ key, label: key, facilityIds }))
          .sort((a, b) => a.key.localeCompare(b.key));
      }

      // 8. Summary
      const categoriesWithCritical = categories.filter(cat =>
        successful.some(({ facility }) => matrix[facility.id]?.[cat]?.status === 'critical')
      ).length;

      const result = {
        facilities: facilityList,
        categories,
        matrix,
        transferOpportunities,
        groups,
        skipped,
        summary: {
          totalFacilities: facilities.length,
          activeFacilities: successful.length,
          categoriesWithCritical,
          totalTransferOpportunities: transferOpportunities.length,
        },
      };
      setCachedResult(cacheKey, result);
      return result;
    }),

  globalSearch: platformProcedure
    .input(z.object({
      query: z.string().min(2).max(100),
      limit: z.number().min(1).max(50).optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return [];

      // Search only what's already warm — the warm mutation handles background warming.
      // Partial results are OK; once warm completes, subsequent queries see all facilities.
      const facilityIds = facilities.map(f => f.id);
      return searchAcrossFacilities(facilityIds, input.query, input.limit);
    }),

  warmSearchIndex: platformProcedure
    .mutation(async ({ ctx }) => {
      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return { warmed: 0, cached: 0, failed: 0 };

      // Identify cold/expired facilities
      const coldFacilities = facilities.filter(f => getSearchIndex(f.id) === null);
      const cached = facilities.length - coldFacilities.length;

      // Warm cold facilities with bounded concurrency (max 5)
      let warmed = 0;
      let failed = 0;

      for (let i = 0; i < coldFacilities.length; i += API_CONCURRENCY) {
        const batch = coldFacilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const packages = await getActivePackagesFromDb(ctx.prisma, facility.id);
            setSearchIndex(facility.id, facility.name, facility.stateCode, packages);
          })
        );

        for (const outcome of settled) {
          if (outcome.status === 'fulfilled') {
            warmed++;
          } else {
            failed++;
          }
        }
      }

      return { warmed, cached, failed };
    }),

  crossFacilityStrainComparison: platformProcedure
    .input(z.object({
      strainNames: z.array(z.string().max(200)).max(50).optional(),
      facilityIds: z.array(z.string()).max(30).optional(),
    }).optional())
    .query(async ({ ctx, input }): Promise<CrossFacilityStrainComparison> => {
      // 1. Get accessible facilities, filter by input.facilityIds if provided
      const allFacilities = await getAccessibleFacilities(ctx);
      let facilities = allFacilities;
      if (input?.facilityIds && input.facilityIds.length > 0) {
        const allowedSet = new Set(allFacilities.map(function (f: MetrcFacility) { return f.id; }));
        facilities = allFacilities.filter(function (f: MetrcFacility) {
          return input.facilityIds!.includes(f.id) && allowedSet.has(f.id);
        });
      }
      if (facilities.length < 2) {
        return emptyStrainComparison();
      }

      // 2. Identify cached vs cold facilities
      const cachedMetrics: PerFacilityStrainMetrics[] = [];
      const coldFacilities: MetrcFacility[] = [];

      for (let i = 0; i < facilities.length; i++) {
        const cached = getStrainCacheEntry(facilities[i].id);
        if (cached) {
          cachedMetrics.push(cached);
        } else {
          coldFacilities.push(facilities[i]);
        }
      }

      // 3. Fetch uncached facilities with bounded concurrency
      //    Only 3 API calls per facility (NO plants or strains — comparison needs
      //    harvests for yield/growth, packages+labTests for pass rate):
      //    harvests, packages, labTests
      const skippedFacilities: string[] = [];

      for (let i = 0; i < coldFacilities.length; i += API_CONCURRENCY) {
        const batch = coldFacilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async function (facility: MetrcFacility) {
            const results = await Promise.allSettled([
              getAllHarvestsFromDb(ctx.prisma, facility.id).then(r => r.active),
              getActivePackagesFromDb(ctx.prisma, facility.id),
              getLabTestResultsFromDb(ctx.prisma, facility.id),
            ]);

            function getValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
              if (result.status === 'fulfilled') return result.value;
              return fallback;
            }

            const harvests = getValue(results[0], [] as MetrcHarvest[]);
            const packages = getValue(results[1], [] as MetrcPackage[]);
            const labTests = getValue(results[2], [] as MetrcLabTest[]);

            return computeStrainMetrics(
              facility.id,
              facility.name,
              facility.stateCode,
              harvests,
              packages,
              labTests,
            );
          })
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j];
          if (outcome.status === 'fulfilled') {
            setStrainCacheEntry(outcome.value.facilityId, outcome.value);
            cachedMetrics.push(outcome.value);
          } else {
            skippedFacilities.push(batch[j].name);
          }
        }
      }

      // 4. Call compareAcrossFacilities from strain-comparison.ts
      if (cachedMetrics.length < 2) {
        return emptyStrainComparison();
      }

      const comparison = compareAcrossFacilities(cachedMetrics);

      // 5. Filter by input.strainNames if provided (post-normalization)
      if (input?.strainNames && input.strainNames.length > 0) {
        const normalizedFilter = new Set(
          input.strainNames.map(function (n: string) { return normalizeStrainName(n); }),
        );
        comparison.strains = comparison.strains.filter(function (s) {
          return normalizedFilter.has(s.normalizedName);
        });
        comparison.significantDifferences = comparison.significantDifferences.filter(function (d) {
          return normalizedFilter.has(normalizeStrainName(d.strainName));
        });
      }

      // Add skip warnings
      for (let si = 0; si < skippedFacilities.length; si++) {
        comparison.warnings.push(`Skipped facility "${skippedFacilities[si]}" due to API error.`);
      }

      return comparison;
    }),

  getOperationsSummary: platformProcedure
    .input(z.object({
      // 400 instead of 365 so YTD on a leap year doesn't fail validation.
      daysLookback: z.number().min(1).max(400).optional().default(30),
    }).optional())
    .query(async ({ ctx, input }): Promise<OperationsSummaryResult> => {
      const daysLookback = input?.daysLookback ?? 30;

      // Server-side cache
      const opsCacheKey = `ops:${ctx.session.user.id}:${ctx.activeOrgId ?? 'all'}:${daysLookback}`;
      const cachedOps = getCachedResult<OperationsSummaryResult>(opsCacheKey);
      if (cachedOps) return cachedOps;

      const weeksInWindow = daysLookback / 7;
      const now = new Date();
      const lookbackStart = new Date(now);
      lookbackStart.setDate(lookbackStart.getDate() - daysLookback);
      // Prior window ends where the current one starts; spans the same length.
      const priorStart = new Date(lookbackStart);
      priorStart.setDate(priorStart.getDate() - daysLookback);
      const startMs = lookbackStart.getTime();
      const dayMs = 86_400_000;
      const dailyIntakeGrams = new Array(daysLookback).fill(0) as number[];
      const dailyPackagedGrams = new Array(daysLookback).fill(0) as number[];

      // 1. Auth — scope to active org if set
      let orgIds: string[];
      try {
        orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
      } catch {
        return emptyOpsSummary(daysLookback);
      }
      const scopedOrgIds =
        ctx.activeOrgId && orgIds.includes(ctx.activeOrgId)
          ? [ctx.activeOrgId]
          : orgIds;

      // 2. Fetch active facilities
      const facilities = await ctx.prisma.metrcFacility.findMany({
        where: { organizationId: { in: scopedOrgIds }, isActive: true },
      });
      if (facilities.length === 0) return emptyOpsSummary();

      // 3. Fetch harvests with bounded concurrency.
      const successful: { facility: MetrcFacility; active: MetrcHarvest[]; inactive: MetrcHarvest[] }[] = [];
      const skipped: SkippedFacility[] = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        // Pull harvests covering both current AND prior window so we can
        // compute period-over-period totals from a single fetch.
        const priorStartISO = priorStart.toISOString();
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const all = await getAllHarvestsFromDb(ctx.prisma, facility.id);
            const active = all.active;
            const inactive = all.inactive.filter(h => !h.LastModified || h.LastModified >= priorStartISO);
            return { facility, active, inactive };
          })
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          const facility = batch[j]!;
          if (outcome.status === 'fulfilled') {
            successful.push(outcome.value);
          } else {
            skipped.push({
              id: facility.id,
              name: facility.name,
              reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      }

      // 4. Compute per-facility metrics.
      //    Intake and Throughput both derive from *finished* harvests (FinishedDate ∈ window).
      //    Metrc doesn't expose an explicit TotalWetWeight, so we reconstruct the
      //    original wet weight as:
      //      CurrentWeight + TotalPackagedWeight + TotalWasteWeight + TotalRestoredWeight
      //    For a finished harvest CurrentWeight is typically ~0, and the sum equals
      //    what was originally registered off the plant.
      //      Intake     = reconstructed original wet weight
      //      Throughput = sum of TotalPackagedWeight (what made it into packages)
      //      Waste      = sum of TotalWasteWeight
      //    We return both an absolute "in window" number and a normalized "per week"
      //    rate. For outdoor operators running 1-2 harvests/year, the per-week rate
      //    is noise; the UI decides which to surface based on finishedHarvestCount
      //    and the selected lookback window.
      let totalIntakeGrams = 0;
      let totalPackagedGrams = 0;
      let totalWasteGrams = 0;
      // Prior-period totals (same window length, immediately preceding).
      let priorIntakeGrams = 0;
      let priorPackagedGrams = 0;
      let priorWasteGrams = 0;

      const facilityMetrics: OpsFacilityMetrics[] = successful.map(({ facility, active, inactive }) => {
        const finished = inactive.filter(h => h.FinishedDate);
        const recentCompleted = finished.filter(h => new Date(h.FinishedDate!) >= lookbackStart);
        const priorCompleted = finished.filter(h => {
          const t = new Date(h.FinishedDate!);
          return t >= priorStart && t < lookbackStart;
        });

        const intakeGramsFor = (h: typeof finished[number]) => toGrams(
          h.CurrentWeight + h.TotalPackagedWeight + h.TotalWasteWeight + h.TotalRestoredWeight,
          h.UnitOfWeightName,
        );

        const intakeGrams = recentCompleted.reduce((s, h) => s + intakeGramsFor(h), 0);
        const packagedGrams = recentCompleted.reduce(
          (s, h) => s + toGrams(h.TotalPackagedWeight, h.UnitOfWeightName), 0,
        );
        const wasteGrams = recentCompleted.reduce(
          (s, h) => s + toGrams(h.TotalWasteWeight, h.UnitOfWeightName), 0,
        );

        // Bucket the current-window harvests by day for the sparkline.
        for (const h of recentCompleted) {
          const t = new Date(h.FinishedDate!).getTime();
          const idx = Math.min(daysLookback - 1, Math.max(0, Math.floor((t - startMs) / dayMs)));
          dailyIntakeGrams[idx] += intakeGramsFor(h);
          dailyPackagedGrams[idx] += toGrams(h.TotalPackagedWeight, h.UnitOfWeightName);
        }

        priorIntakeGrams += priorCompleted.reduce((s, h) => s + intakeGramsFor(h), 0);
        priorPackagedGrams += priorCompleted.reduce(
          (s, h) => s + toGrams(h.TotalPackagedWeight, h.UnitOfWeightName), 0,
        );
        priorWasteGrams += priorCompleted.reduce(
          (s, h) => s + toGrams(h.TotalWasteWeight, h.UnitOfWeightName), 0,
        );

        totalIntakeGrams += intakeGrams;
        totalPackagedGrams += packagedGrams;
        totalWasteGrams += wasteGrams;

        const totalOutput = packagedGrams + wasteGrams;
        const intakeLbs = intakeGrams / GRAMS_PER_LB;
        const throughputLbs = packagedGrams / GRAMS_PER_LB;

        return {
          id: facility.id,
          name: facility.name,
          stateCode: facility.stateCode,
          facilityType: facility.facilityType,
          harvestIntakeLbsInWindow: round2(intakeLbs),
          harvestIntakeLbsPerWeek: round2(intakeLbs / weeksInWindow),
          throughputLbsInWindow: round2(throughputLbs),
          throughputLbsPerWeek: round2(throughputLbs / weeksInWindow),
          wasteRatePercent: totalOutput > 0 ? round2((wasteGrams / totalOutput) * 100) : 0,
          activeHarvestCount: active.length,
          finishedHarvestCount: recentCompleted.length,
        };
      });

      facilityMetrics.sort((a, b) => a.name.localeCompare(b.name));

      // 5. Aggregate totals
      const totalOutputGrams = totalPackagedGrams + totalWasteGrams;
      const totalIntakeLbs = totalIntakeGrams / GRAMS_PER_LB;
      const totalThroughputLbs = totalPackagedGrams / GRAMS_PER_LB;
      const priorOutputGrams = priorPackagedGrams + priorWasteGrams;

      const opsResult = {
        summary: {
          harvestIntakeLbsInWindow: round2(totalIntakeLbs),
          harvestIntakeLbsPerWeek: round2(totalIntakeLbs / weeksInWindow),
          throughputLbsInWindow: round2(totalThroughputLbs),
          throughputLbsPerWeek: round2(totalThroughputLbs / weeksInWindow),
          wasteRatePercent: totalOutputGrams > 0 ? round2((totalWasteGrams / totalOutputGrams) * 100) : 0,
          activeFacilities: successful.length,
          daysLookback,
          dailyHarvestIntakeLbs: dailyIntakeGrams.map(g => round2(g / GRAMS_PER_LB)),
          dailyThroughputLbs: dailyPackagedGrams.map(g => round2(g / GRAMS_PER_LB)),
          prior: {
            harvestIntakeLbsInWindow: round2(priorIntakeGrams / GRAMS_PER_LB),
            throughputLbsInWindow: round2(priorPackagedGrams / GRAMS_PER_LB),
            wasteRatePercent: priorOutputGrams > 0 ? round2((priorWasteGrams / priorOutputGrams) * 100) : 0,
          },
        },
        facilities: facilityMetrics,
        skipped,
      };
      setCachedResult(opsCacheKey, opsResult);
      return opsResult;
    }),

  // -------------------------------------------------------------------------
  // Briefing Rollup — multi-facility AI Briefing summary
  //
  // Runs computeBriefingMetrics() for every accessible facility, aggregates
  // org-wide KPIs, and returns a list of facilities ranked by criticality.
  // Replaces the old single-facility AI Briefing as the lead element on the
  // /executive page so the rollup view is genuinely multi-state.
  //
  // Cost: N briefing computations per request (each touches local DB + a few
  // engines). Bounded concurrency (API_CONCURRENCY=5) and a 5-min server-side
  // cache (RESULT_CACHE_TTL_MS) keep this tractable for MSOs with 50+ sites.
  // -------------------------------------------------------------------------

  getBriefingRollup: platformProcedure
    .query(async ({ ctx }): Promise<BriefingRollupResult> => {
      const cacheKey = `briefingRollup:${ctx.session.user.id}:${ctx.activeOrgId ?? 'all'}`;
      const cached = getCachedResult<BriefingRollupResult>(cacheKey);
      if (cached) return cached;

      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) {
        return {
          totals: {
            totalPackages: 0,
            avgAuditScore: 0,
            avgAgeDays: 0,
            avgWeeksOfSupply: null,
            activeFacilities: 0,
            totalCriticalCount: 0,
            totalWarningCount: 0,
          },
          facilities: [],
          skipped: [],
        };
      }

      const successful: Array<{
        facility: MetrcFacility;
        metrics: Awaited<ReturnType<typeof computeBriefingMetrics>>;
      }> = [];
      const skipped: SkippedFacility[] = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (f) => ({ facility: f, metrics: await computeBriefingMetrics(f) })),
        );
        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          const facility = batch[j]!;
          if (outcome.status === 'fulfilled') {
            successful.push(outcome.value);
          } else {
            skipped.push({
              id: facility.id,
              name: facility.name,
              reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      }

      // Build per-facility rollup rows. Issue counts use the same threshold
      // logic that getBriefing applies when building its insights array — but
      // we derive directly from metrics rather than rebuilding the insight
      // strings, so we don't depend on the exact wording.
      const rows: FacilityRollupRow[] = successful.map(({ facility, metrics }) => {
        const allIssues: FacilityRollupRow['topIssues'] = [];
        let criticalCount = 0;
        let warningCount = 0;

        if (metrics.audit.overallScore < 60) {
          criticalCount++;
          allIssues.push({ severity: 'critical', label: `Audit ${metrics.audit.overallScore}/100`, action: 'audit' });
        } else if (metrics.audit.overallScore < 80) {
          warningCount++;
          allIssues.push({ severity: 'warning', label: `Audit ${metrics.audit.overallScore}/100`, action: 'audit' });
        }

        if (metrics.aging.critical.count > 0) {
          criticalCount++;
          allIssues.push({ severity: 'critical', label: `${metrics.aging.critical.count} aging`, action: 'aging' });
        }

        if (metrics.fifoViolations.length > 0) {
          warningCount++;
          allIssues.push({ severity: 'warning', label: `${metrics.fifoViolations.length} FIFO`, action: 'fifo' });
        }

        if (metrics.deadStockCount > 0) {
          warningCount++;
          allIssues.push({ severity: 'warning', label: `${metrics.deadStockCount} dead stock`, action: 'deadstock' });
        }

        if (metrics.onHoldCount > 0) {
          const pct = metrics.totalPackages > 0 ? metrics.onHoldCount / metrics.totalPackages : 0;
          if (pct > 0.10) {
            criticalCount++;
            allIssues.push({ severity: 'critical', label: `${metrics.onHoldCount} on hold`, action: 'onhold' });
          } else {
            warningCount++;
            allIssues.push({ severity: 'warning', label: `${metrics.onHoldCount} on hold`, action: 'onhold' });
          }
        }

        // Top 2 issues, criticals first (stable order within each severity).
        const topIssues = allIssues
          .slice()
          .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))
          .slice(0, 2);

        return {
          id: facility.id,
          name: facility.name,
          stateCode: facility.stateCode,
          facilityType: facility.facilityType,
          metrcEnvironment: facility.metrcEnvironment,
          totalPackages: metrics.totalPackages,
          auditScore: metrics.audit.overallScore,
          averageAgeDays: metrics.averageAgeDays,
          weeksOfSupply: metrics.weeksOfSupply,
          criticalCount,
          warningCount,
          topIssues,
        };
      });

      // Rank by criticality: criticals first, then warnings, then alpha by name.
      rows.sort((a, b) =>
        b.criticalCount - a.criticalCount ||
        b.warningCount - a.warningCount ||
        a.name.localeCompare(b.name),
      );

      // Aggregate totals. Audit/age weighted by package count so a small
      // facility with one stale package doesn't drag the average. Supply
      // weighted only over facilities that actually return a number.
      const totalPackages = rows.reduce((s, r) => s + r.totalPackages, 0);
      const weightedAuditSum = rows.reduce((s, r) => s + r.auditScore * r.totalPackages, 0);
      const weightedAgeSum = rows.reduce((s, r) => s + r.averageAgeDays * r.totalPackages, 0);
      const supplyValid = rows.filter((r) => r.weeksOfSupply !== null);
      const weightedSupplySum = supplyValid.reduce(
        (s, r) => s + (r.weeksOfSupply ?? 0) * r.totalPackages, 0,
      );
      const weightedSupplyDenom = supplyValid.reduce((s, r) => s + r.totalPackages, 0);
      const totalCriticalCount = rows.reduce((s, r) => s + r.criticalCount, 0);
      const totalWarningCount = rows.reduce((s, r) => s + r.warningCount, 0);

      const result: BriefingRollupResult = {
        totals: {
          totalPackages,
          avgAuditScore: totalPackages > 0 ? Math.round(weightedAuditSum / totalPackages) : 0,
          avgAgeDays: totalPackages > 0 ? Math.round(weightedAgeSum / totalPackages) : 0,
          avgWeeksOfSupply: weightedSupplyDenom > 0 ? round2(weightedSupplySum / weightedSupplyDenom) : null,
          activeFacilities: successful.length,
          totalCriticalCount,
          totalWarningCount,
        },
        facilities: rows,
        skipped,
      };

      setCachedResult(cacheKey, result);
      return result;
    }),

  // -------------------------------------------------------------------------
  // Quality Summary — lab test pass/fail across all facilities
  // -------------------------------------------------------------------------

  getQualitySummary: platformProcedure
    .input(z.object({
      daysLookback: z.number().min(1).max(365).optional().default(30),
    }).optional())
    .query(async ({ ctx }): Promise<QualitySummaryResult> => {
      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return emptyQualitySummary();

      const successful: QualityFacilityEntry[] = [];
      const skipped: SkippedFacility[] = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const [packages, labTests] = await Promise.all([
              getActivePackagesFromDb(ctx.prisma, facility.id),
              getLabTestResultsFromDb(ctx.prisma, facility.id),
            ]);
            return { facility, packages, labTests };
          }),
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          const facility = batch[j]!;
          if (outcome.status === 'fulfilled') {
            successful.push(outcome.value);
          } else {
            skipped.push({
              id: facility.id,
              name: facility.name,
              reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      }

      // Aggregate lab test states from packages
      let totalPassed = 0;
      let totalFailed = 0;
      let totalPending = 0;
      let totalSubmitted = 0;
      let totalPackages = 0;

      // Track per-strain pass/fail from lab test results
      const strainStats = new Map<string, { passed: number; failed: number; total: number }>();

      const facilityMetrics: QualityFacilityMetrics[] = successful.map(({ facility, packages, labTests }) => {
        let passed = 0;
        let failed = 0;
        let pending = 0;
        let submitted = 0;

        for (let pi = 0; pi < packages.length; pi++) {
          const state = packages[pi].LabTestingState;
          if (state === 'TestPassed') passed++;
          else if (state === 'TestFailed') failed++;
          else if (state === 'SubmittedForTesting') submitted++;
          else pending++; // NotSubmitted or other
        }

        totalPassed += passed;
        totalFailed += failed;
        totalPending += pending;
        totalSubmitted += submitted;
        totalPackages += packages.length;

        // Build strain -> label map for this facility
        const labelToStrain = new Map<string, string>();
        for (let pi = 0; pi < packages.length; pi++) {
          const pkg = packages[pi];
          if (pkg.ItemStrainName && pkg.Label) {
            labelToStrain.set(pkg.Label, pkg.ItemStrainName);
          }
        }

        // Accumulate strain-level pass/fail from lab tests
        for (let li = 0; li < labTests.length; li++) {
          const test = labTests[li];
          const strain = labelToStrain.get(test.PackageLabel);
          if (!strain) continue;
          const existing = strainStats.get(strain) ?? { passed: 0, failed: 0, total: 0 };
          existing.total++;
          if (test.OverallPassed) existing.passed++;
          else existing.failed++;
          strainStats.set(strain, existing);
        }

        const tested = passed + failed;
        return {
          id: facility.id,
          name: facility.name,
          stateCode: facility.stateCode,
          facilityType: facility.facilityType,
          totalPackages: packages.length,
          passedCount: passed,
          failedCount: failed,
          pendingCount: pending,
          submittedCount: submitted,
          passRate: tested > 0 ? round2((passed / tested) * 100) : 0,
        };
      });

      facilityMetrics.sort((a, b) => a.passRate - b.passRate); // worst-first

      // Top risky strains — sorted by fail rate descending, min 3 tests
      const topRiskyStrains: QualityStrainRisk[] = [];
      strainStats.forEach((stats, strain) => {
        if (stats.total >= 3) {
          topRiskyStrains.push({
            strain,
            passRate: round2((stats.passed / stats.total) * 100),
            testCount: stats.total,
            failCount: stats.failed,
          });
        }
      });
      topRiskyStrains.sort((a, b) => a.passRate - b.passRate);

      const totalTested = totalPassed + totalFailed;

      return {
        summary: {
          totalPackages,
          passedCount: totalPassed,
          failedCount: totalFailed,
          pendingCount: totalPending,
          submittedCount: totalSubmitted,
          passRate: totalTested > 0 ? round2((totalPassed / totalTested) * 100) : 0,
          activeFacilities: successful.length,
        },
        facilities: facilityMetrics,
        topRiskyStrains: topRiskyStrains.slice(0, 10),
        skipped,
      };
    }),

  // -------------------------------------------------------------------------
  // Yield Analytics — harvest cycle time, yield efficiency across facilities
  // -------------------------------------------------------------------------

  getYieldAnalytics: platformProcedure
    .input(z.object({
      daysLookback: z.number().min(1).max(365).optional().default(90),
    }).optional())
    .query(async ({ ctx, input }): Promise<YieldAnalyticsResult> => {
      const daysLookback = input?.daysLookback ?? 90;
      const lookbackStart = new Date();
      lookbackStart.setDate(lookbackStart.getDate() - daysLookback);

      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return emptyYieldAnalytics();

      const successful: YieldFacilityEntry[] = [];
      const skipped: SkippedFacility[] = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const all = await getAllHarvestsFromDb(ctx.prisma, facility.id);
            const active = all.active;
            const lookbackISO2 = lookbackStart.toISOString();
            const inactive = all.inactive.filter(h => !h.LastModified || h.LastModified >= lookbackISO2);
            return { facility, active, inactive };
          }),
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          const facility = batch[j]!;
          if (outcome.status === 'fulfilled') {
            successful.push(outcome.value);
          } else {
            skipped.push({
              id: facility.id,
              name: facility.name,
              reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
          }
        }
      }

      // Per-strain yield tracking
      const strainYields = new Map<string, { totalPackaged: number; totalWaste: number; harvestCount: number; facilitySet: Set<string>; daysToFinish: number[] }>();

      let totalPackagedGrams = 0;
      let totalWasteGrams = 0;
      let totalHarvests = 0;
      let totalDaysToFinish: number[] = [];

      const facilityMetrics: YieldFacilityMetrics[] = successful.map(({ facility, active, inactive }) => {
        // Use completed harvests from the lookback window for yield metrics
        const completed = inactive.filter(h => h.FinishedDate && new Date(h.FinishedDate) >= lookbackStart);
        let facPackaged = 0;
        let facWaste = 0;
        const facDays: number[] = [];

        for (let hi = 0; hi < completed.length; hi++) {
          const h = completed[hi];
          const pkgG = toGrams(h.TotalPackagedWeight, h.UnitOfWeightName);
          const wasteG = toGrams(h.TotalWasteWeight, h.UnitOfWeightName);
          facPackaged += pkgG;
          facWaste += wasteG;

          if (h.FinishedDate && h.HarvestStartDate) {
            const start = new Date(h.HarvestStartDate);
            const end = new Date(h.FinishedDate);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
              const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
              if (days > 0) facDays.push(days);
            }
          }

          // Track per-strain
          if (h.SourceStrainNames) {
            const names = h.SourceStrainNames.split(',').map((s: string) => s.trim()).filter(Boolean);
            for (let ni = 0; ni < names.length; ni++) {
              const existing = strainYields.get(names[ni]) ?? { totalPackaged: 0, totalWaste: 0, harvestCount: 0, facilitySet: new Set<string>(), daysToFinish: [] };
              existing.totalPackaged += pkgG / names.length;
              existing.totalWaste += wasteG / names.length;
              existing.harvestCount++;
              existing.facilitySet.add(facility.id);
              if (facDays.length > 0) existing.daysToFinish.push(facDays[facDays.length - 1]);
              strainYields.set(names[ni], existing);
            }
          }
        }

        totalPackagedGrams += facPackaged;
        totalWasteGrams += facWaste;
        totalHarvests += completed.length;
        totalDaysToFinish = totalDaysToFinish.concat(facDays);

        const facTotal = facPackaged + facWaste;
        const avgDays = facDays.length > 0
          ? Math.round(facDays.reduce((s, d) => s + d, 0) / facDays.length)
          : 0;

        return {
          id: facility.id,
          name: facility.name,
          stateCode: facility.stateCode,
          facilityType: facility.facilityType,
          yieldEfficiency: facTotal > 0 ? round2((facPackaged / facTotal) * 100) : 0,
          wasteRate: facTotal > 0 ? round2((facWaste / facTotal) * 100) : 0,
          harvestCount: completed.length,
          activeHarvestCount: active.length,
          avgDaysToFinish: avgDays,
        };
      });

      facilityMetrics.sort((a, b) => b.yieldEfficiency - a.yieldEfficiency); // best-first

      // Top strains by yield
      const topStrains: YieldStrainMetrics[] = [];
      strainYields.forEach((stats, strain) => {
        if (stats.harvestCount >= 2) {
          const total = stats.totalPackaged + stats.totalWaste;
          const avgDays = stats.daysToFinish.length > 0
            ? Math.round(stats.daysToFinish.reduce((s, d) => s + d, 0) / stats.daysToFinish.length)
            : 0;
          topStrains.push({
            strain,
            yieldEfficiency: total > 0 ? round2((stats.totalPackaged / total) * 100) : 0,
            harvestCount: stats.harvestCount,
            facilityCount: stats.facilitySet.size,
            avgDaysToFinish: avgDays,
          });
        }
      });
      topStrains.sort((a, b) => b.yieldEfficiency - a.yieldEfficiency);

      const totalOutput = totalPackagedGrams + totalWasteGrams;
      const avgDaysOverall = totalDaysToFinish.length > 0
        ? Math.round(totalDaysToFinish.reduce((s, d) => s + d, 0) / totalDaysToFinish.length)
        : 0;

      return {
        summary: {
          yieldEfficiency: totalOutput > 0 ? round2((totalPackagedGrams / totalOutput) * 100) : 0,
          wasteRate: totalOutput > 0 ? round2((totalWasteGrams / totalOutput) * 100) : 0,
          totalHarvests,
          avgDaysToFinish: avgDaysOverall,
          activeFacilities: successful.length,
        },
        facilities: facilityMetrics,
        topStrains: topStrains.slice(0, 15),
        skipped,
      };
    }),

  // -------------------------------------------------------------------------
  // Processing Yield — Manufacturer-side companion to getYieldAnalytics.
  // For each facility that runs processing actions, aggregates ActionLog
  // entries (PROCESSING_CREATE, COMPLETED) into per-facility input/output
  // weight totals + yield %. Skips Dispensary types entirely.
  // -------------------------------------------------------------------------

  getProcessingYield: platformProcedure
    .input(
      z
        .object({
          daysLookback: z.number().min(1).max(365).optional().default(90),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const daysLookback = input?.daysLookback ?? 90;
      const lookbackStart = new Date();
      lookbackStart.setDate(lookbackStart.getDate() - daysLookback);

      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) {
        return { facilities: [], daysLookback, totalRunCount: 0 };
      }

      // Processing only happens at Cultivator / Manufacturer / Microbusiness
      // facility types. Filter the rest out at the router boundary so we
      // don't query ActionLog for surfaces that can't have processing.
      const processingTypes = new Set(['Cultivator', 'Manufacturer', 'Microbusiness']);
      const eligible = facilities.filter(f =>
        f.facilityType ? processingTypes.has(f.facilityType) : false,
      );
      if (eligible.length === 0) {
        return { facilities: [], daysLookback, totalRunCount: 0 };
      }

      // Pull all relevant ActionLogs in one query, scoped to eligible
      // facilities + the lookback window. Then group in memory.
      const eligibleIds = eligible.map(f => f.id);
      const logs = await ctx.prisma.actionLog.findMany({
        where: {
          facilityId: { in: eligibleIds },
          actionType: 'PROCESSING_CREATE',
          status: 'COMPLETED',
          executedAt: { gte: lookbackStart },
        },
        select: {
          facilityId: true,
          actionType: true,
          status: true,
          previewData: true,
        },
      });

      const byFacility = new Map<string, typeof logs>();
      for (const log of logs) {
        const list = byFacility.get(log.facilityId) ?? [];
        list.push(log);
        byFacility.set(log.facilityId, list);
      }

      const result: Array<{
        id: string;
        name: string;
        stateCode: string;
        facilityType: string | null;
        metrics: FacilityProcessingMetrics;
        inputLbs: number;
        outputLbs: number;
      }> = [];

      let totalRunCount = 0;
      for (const facility of eligible) {
        const facilityLogs = byFacility.get(facility.id) ?? [];
        if (facilityLogs.length === 0) continue;
        const metrics = aggregateProcessingYield(facilityLogs);
        if (metrics.runCount === 0) continue;
        totalRunCount += metrics.runCount;
        result.push({
          id: facility.id,
          name: facility.name,
          stateCode: facility.stateCode,
          facilityType: facility.facilityType,
          metrics,
          inputLbs: Math.round(gramsToPounds(metrics.totalInputGrams) * 10) / 10,
          outputLbs: Math.round(gramsToPounds(metrics.totalOutputGrams) * 10) / 10,
        });
      }

      // Sort by run count descending — the most active processors lead.
      result.sort((a, b) => b.metrics.runCount - a.metrics.runCount);

      return { facilities: result, daysLookback, totalRunCount };
    }),

  // -------------------------------------------------------------------------
  // Open PO Categories — returns normalized categories with active purchase
  // orders per facility, used to suppress runout alerts on the executive page.
  // -------------------------------------------------------------------------

  getOpenPOCategories: platformProcedure
    .query(async ({ ctx }): Promise<Record<string, string[]>> => {
      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return {};

      // Only facilities with Canix enabled
      const canixFacilities = facilities.filter(
        f => f.canixEnvironment && f.canixEnvironment !== 'none',
      );
      if (canixFacilities.length === 0) return {};

      const OPEN_PO_STATUSES = new Set(['submitted', 'confirmed', 'in_transit']);
      const result: Record<string, string[]> = {};

      // Bounded concurrency — max 5 parallel Canix API calls
      for (let i = 0; i < canixFacilities.length; i += API_CONCURRENCY) {
        const batch = canixFacilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const canixClient = getCanixClient(facility);
            const [purchaseOrders, items] = await Promise.all([
              canixClient.getPurchaseOrders(),
              canixClient.getItems(),
            ]);

            // Build itemId -> normalized category lookup
            const itemCategoryMap = new Map<string, string>();
            for (const item of items) {
              if (item.category) {
                itemCategoryMap.set(item.id, normalizeCategory(item.category));
              }
            }

            // Collect categories from open PO line items (parallel, capped at 10)
            const openPOs = purchaseOrders.filter(po => OPEN_PO_STATUSES.has(po.status));
            const categories = new Set<string>();
            const contentsResults = await Promise.all(
              openPOs.slice(0, 10).map(po => canixClient.getPurchaseOrderContents(po.id))
            );
            for (const lineItems of contentsResults) {
              for (const li of lineItems) {
                const cat = itemCategoryMap.get(li.itemId);
                if (cat) categories.add(cat);
              }
            }

            return { facilityId: facility.id, categories: Array.from(categories) };
          }),
        );

        for (const outcome of settled) {
          if (outcome.status === 'fulfilled' && outcome.value.categories.length > 0) {
            result[outcome.value.facilityId] = outcome.value.categories;
          }
          // Silently skip failed facilities — PO suppression is best-effort
        }
      }

      return result;
    }),

  // -------------------------------------------------------------------------
  // Category → Strain Breakdown
  // -------------------------------------------------------------------------

  /**
   * Drill-down: given a facility + category, returns strain-level inventory
   * breakdown. Used by the heatmap cell click dialog on /operations.
   *
   * No new Metrc API call — reads from the run-rate matrix's underlying
   * packages (already fetched for the heatmap). The caller passes the
   * category-level `weeklySalesRate` from the matrix so we can estimate
   * per-strain velocity proportionally.
   */
  getCategoryStrainBreakdown: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string(),
      /** Category-level weekly sales rate from the run-rate matrix (used for proportional strain velocity). */
      categoryWeeklySalesRate: z.number().optional().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: { id: input.facilityId },
      });
      if (!facility) return { strains: [], totalQuantity: 0 };

      const packages = await getActivePackagesFromDb(ctx.prisma, facility.id);

      // Group by strain within the target category
      const strainMap = new Map<string, { quantity: number; packageCount: number }>();
      let totalQuantity = 0;

      for (const pkg of packages) {
        if (normalizeCategory(pkg.ItemCategory) !== normalizeCategory(input.category)) continue;
        const strain = pkg.ItemStrainName || 'Unknown';
        const entry = strainMap.get(strain) ?? { quantity: 0, packageCount: 0 };
        entry.quantity += pkg.Quantity;
        entry.packageCount++;
        strainMap.set(strain, entry);
        totalQuantity += pkg.Quantity;
      }

      const categoryRate = input.categoryWeeklySalesRate;
      const strains = Array.from(strainMap.entries())
        .map(([name, { quantity, packageCount }]) => {
          const pctOfCategory = totalQuantity > 0 ? quantity / totalQuantity : 0;
          // Proportional velocity estimate: if this strain is 40% of inventory,
          // assume ~40% of sales velocity. Rough but useful for relative comparison.
          const estimatedWeeklyRate = categoryRate * pctOfCategory;
          const weeksOfSupply = estimatedWeeklyRate > 0 ? quantity / estimatedWeeklyRate : null;
          return {
            name,
            quantity: Math.round(quantity * 100) / 100,
            packageCount,
            pctOfCategory: Math.round(pctOfCategory * 1000) / 10,
            estimatedWeeklyRate: Math.round(estimatedWeeklyRate * 10) / 10,
            weeksOfSupply: weeksOfSupply !== null ? Math.round(weeksOfSupply * 10) / 10 : null,
          };
        })
        .sort((a, b) => b.quantity - a.quantity);

      return { strains, totalQuantity: Math.round(totalQuantity * 100) / 100 };
    }),

  // -------------------------------------------------------------------------
  // Production Rates — daily package creation velocity per category per facility
  // -------------------------------------------------------------------------

  getProductionRates: platformProcedure
    .input(z.object({
      daysLookback: z.number().min(1).max(400).optional().default(30),
    }).optional())
    .query(async ({ ctx, input }) => {
      const daysLookback = input?.daysLookback ?? 30;
      const facilities = await getAccessibleFacilities(ctx);
      // Only manufacturing-type facilities produce packages (exclude dispensaries — they only sell)
      const PRODUCER_TYPES = new Set(['Cultivator', 'Manufacturer', 'Microbusiness']);
      const producers = facilities.filter(f => !f.facilityType || PRODUCER_TYPES.has(f.facilityType));
      if (producers.length === 0) return { facilities: [], daysLookback };

      const results: Array<{
        id: string;
        name: string;
        stateCode: string;
        facilityType: string | null;
        production: { byCategory: CategoryProductionRate[]; totalPackagesCreated: number; totalActiveDays: number };
      }> = [];

      for (let i = 0; i < producers.length; i += API_CONCURRENCY) {
        const batch = producers.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const packages = await getActivePackagesFromDb(ctx.prisma, facility.id);
            const production = computeProductionRates(packages, daysLookback);
            return { facility, production };
          }),
        );
        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          if (outcome.status === 'fulfilled') {
            const { facility, production } = outcome.value;
            results.push({
              id: facility.id,
              name: facility.name,
              stateCode: facility.stateCode,
              facilityType: facility.facilityType,
              production: {
                byCategory: production.byCategory,
                totalPackagesCreated: production.totalPackagesCreated,
                totalActiveDays: production.totalActiveDays,
              },
            });
          }
          // Silently skip failed facilities
        }
      }

      return { facilities: results, daysLookback };
    }),

  // -------------------------------------------------------------------------
  // Lab Testing Turnaround — days from package creation to lab test completion
  // -------------------------------------------------------------------------

  getLabTurnaround: platformProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return { facilities: [] };

      const results: Array<{
        id: string;
        name: string;
        stateCode: string;
        facilityType: string | null;
        turnaround: LabTurnaroundResult;
      }> = [];

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (facility) => {
            const [packages, labTests] = await Promise.all([
              getActivePackagesFromDb(ctx.prisma, facility.id),
              getLabTestResultsFromDb(ctx.prisma, facility.id),
            ]);
            const turnaround = computeLabTurnaround(packages, labTests);
            return { facility, turnaround };
          }),
        );
        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          if (outcome.status === 'fulfilled') {
            const { facility, turnaround } = outcome.value;
            if (turnaround.totalTested > 0 || turnaround.awaitingTestCount > 0) {
              results.push({
                id: facility.id,
                name: facility.name,
                stateCode: facility.stateCode,
                facilityType: facility.facilityType,
                turnaround,
              });
            }
          }
        }
      }

      return { facilities: results };
    }),

  // Cross-facility pipeline status pills (Curing / Decon / Copack / Q Status).
  // Counts active packages whose LocationName matches a configured Metrc room
  // for each stage. Stage→room mapping lives in pipeline-stages.ts.
  getStagePackageCounts: platformProcedure
    .query(async ({ ctx }): Promise<{
      stages: Array<{
        stage: PipelineStageKey;
        label: string;
        packageCount: number;
        isMapped: boolean;
        rooms: readonly string[];
      }>;
    }> => {
      const buildResult = (counts: Map<PipelineStageKey, number>) =>
        STAGE_ROOM_MAPPINGS.map(m => ({
          stage: m.stage,
          label: m.label,
          packageCount: counts.get(m.stage) ?? 0,
          isMapped: isStageMapped(m),
          rooms: m.rooms,
        }));

      const counts = new Map<PipelineStageKey, number>();
      for (const m of STAGE_ROOM_MAPPINGS) counts.set(m.stage, 0);

      const facilities = await getAccessibleFacilities(ctx);
      if (facilities.length === 0) return { stages: buildResult(counts) };

      const roomLookup = buildStageRoomLookup();

      for (let i = 0; i < facilities.length; i += API_CONCURRENCY) {
        const batch = facilities.slice(i, i + API_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(facility => getActivePackagesFromDb(ctx.prisma, facility.id)),
        );
        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j]!;
          if (outcome.status !== 'fulfilled') {
            const facility = batch[j]!;
            console.error(
              `[getStagePackageCounts] failed to fetch packages for facility ${facility.id} (${facility.name}):`,
              outcome.reason instanceof Error ? outcome.reason.message : outcome.reason,
            );
            continue;
          }
          for (const pkg of outcome.value) {
            const loc = (pkg.LocationName ?? '').toLowerCase();
            if (!loc) continue;
            const stage = roomLookup.get(loc);
            if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
          }
        }
      }

      return { stages: buildResult(counts) };
    }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyStrainComparison(): CrossFacilityStrainComparison {
  return {
    strains: [],
    facilities: [],
    significantDifferences: [],
    warnings: [],
  };
}

function emptyOpsSummary(daysLookback = 30): OperationsSummaryResult {
  return {
    summary: {
      harvestIntakeLbsInWindow: 0,
      harvestIntakeLbsPerWeek: 0,
      throughputLbsInWindow: 0,
      throughputLbsPerWeek: 0,
      wasteRatePercent: 0,
      activeFacilities: 0,
      daysLookback,
      dailyHarvestIntakeLbs: new Array(daysLookback).fill(0),
      dailyThroughputLbs: new Array(daysLookback).fill(0),
      prior: { harvestIntakeLbsInWindow: 0, throughputLbsInWindow: 0, wasteRatePercent: 0 },
    },
    facilities: [],
    skipped: [],
  };
}

function emptyQualitySummary(): QualitySummaryResult {
  return {
    summary: { totalPackages: 0, passedCount: 0, failedCount: 0, pendingCount: 0, submittedCount: 0, passRate: 0, activeFacilities: 0 },
    facilities: [],
    topRiskyStrains: [],
    skipped: [],
  };
}

function emptyYieldAnalytics(): YieldAnalyticsResult {
  return {
    summary: { yieldEfficiency: 0, wasteRate: 0, totalHarvests: 0, avgDaysToFinish: 0, activeFacilities: 0 },
    facilities: [],
    topStrains: [],
    skipped: [],
  };
}

function emptyResult(): ComparisonResult {
  return {
    facilities: [],
    categories: [],
    matrix: {},
    transferOpportunities: [],
    groups: [],
    skipped: [],
    summary: { totalFacilities: 0, activeFacilities: 0, categoriesWithCritical: 0, totalTransferOpportunities: 0 },
  };
}

function detectTransferOpportunities(
  successful: FacilityRunRateEntry[],
  categories: string[],
): TransferOpportunity[] {
  const opportunities: TransferOpportunity[] = [];

  for (const category of categories) {
    // Collect facilities that have this category with known sales velocity
    const withCategory: { facility: MetrcFacility; wos: number; inventory: number; weeklyRate: number }[] = [];
    for (const { facility, result } of successful) {
      const cat = result.byCategory.find(c => c.category === category);
      if (cat && cat.weeksOfSupply !== null) {
        withCategory.push({
          facility,
          wos: cat.weeksOfSupply,
          inventory: cat.currentInventory,
          weeklyRate: cat.weeklySalesRate,
        });
      }
    }

    if (withCategory.length < 2) continue;

    const excess = withCategory.filter(f => f.wos > EXCESS_THRESHOLD_WEEKS);
    const needy = withCategory.filter(f => f.wos < LOW_THRESHOLD_WEEKS);

    for (const sender of excess) {
      for (const receiver of needy) {
        // Cannabis cannot legally cross state lines
        if (sender.facility.stateCode !== receiver.facility.stateCode) continue;

        // Surplus = inventory above TARGET_WEEKS of the sender's sales rate
        const senderSurplus = sender.inventory - (sender.weeklyRate * TARGET_WEEKS_AFTER_TRANSFER);
        // Receiver need = units to bring them up to LOW_THRESHOLD weeks
        const receiverNeed = receiver.weeklyRate > 0
          ? (LOW_THRESHOLD_WEEKS - receiver.wos) * receiver.weeklyRate
          : 0;

        if (senderSurplus <= 0 || receiverNeed <= 0) continue;

        const suggestedUnits = Math.round(Math.min(senderSurplus, receiverNeed));
        if (suggestedUnits <= 0) continue;

        opportunities.push({
          category,
          fromFacility: {
            id: sender.facility.id,
            name: sender.facility.name,
            stateCode: sender.facility.stateCode,
            weeksOfSupply: sender.wos,
            currentInventory: sender.inventory,
          },
          toFacility: {
            id: receiver.facility.id,
            name: receiver.facility.name,
            stateCode: receiver.facility.stateCode,
            weeksOfSupply: receiver.wos,
            currentInventory: receiver.inventory,
          },
          suggestedUnits,
          urgency: receiver.wos < CRITICAL_THRESHOLD_WEEKS ? 'high' : 'medium',
        });
      }
    }
  }

  // Sort: high urgency first, then by suggestedUnits descending
  opportunities.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === 'high' ? -1 : 1;
    return b.suggestedUnits - a.suggestedUnits;
  });

  return opportunities;
}
