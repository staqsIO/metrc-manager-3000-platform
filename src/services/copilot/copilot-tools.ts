// Tool definitions and executor for the Copilot
// Maps OpenAI-compatible tool schemas to local engine functions

import { COPILOT_TOOLS, COPILOT_ACTION_TOOLS, ALL_COPILOT_TOOLS, CORE_COPILOT_TOOLS } from './copilot-tool-defs';
import { requireFacilityRole } from '@/lib/trpc';
import type { MetrcPackage, MetrcTransfer, MetrcHarvest, MetrcPlantBatch, MetrcPlant, MetrcLabTest, MetrcStrain, MetrcItem, MetrcSaleReceipt, IMetrcClient } from '@/services/metrc/types';
import type { RuleDefinition } from '@/services/engines/rules-engine';
import type { PrismaClient, MetrcFacility, Prisma } from '@prisma/client';

import { detectFIFOViolations, analyzeAgingDistribution, generateAgingRecommendations, detectSlowMoving } from '@/services/engines/fifo-engine';
import { evaluateRulesAgainstPackages } from '@/services/engines/rules-engine';
import { generateAuditSnapshot } from '@/services/engines/audit-engine';
import { detectFragmentation, generateConsolidationRecommendations, findSampleOutCandidates, analyzeBiomassUtilization, detectShortCounts } from '@/services/engines/package-intelligence';
import { analyzeBiomassRecommendations } from '@/services/engines/biomass-recommendation-engine';
import { inferBOMsFromHistory } from '@/services/engines/bom-inference';
import { analyzeYieldTrends } from '@/services/analytics/strain-intelligence';
import { compareAcrossFacilities, normalizeStrainName } from '@/services/analytics/strain-comparison';
import { getStrainCacheForFacilities } from '@/server/api/routers/cross-facility';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { assessFulfillmentRisk } from '@/services/engines/fulfillment-risk';
import { analyzeEmployeePatterns, identifyTrainingNeeds } from '@/services/engines/operations-analysis';
import { calculateTolling, calculateFees, comparePartners } from '@/services/engines/tolling-engine';
import type { FeeDefinition } from '@/services/engines/tolling-engine';
import { checkFeasibility, findLowStockItems } from '@/services/engines/supply-engine';
import type { BOMLine } from '@/services/engines/supply-engine';
import { buildProvenanceIndex, getProvenance } from '@/services/engines/provenance-engine';
import { correlateTransfers, type TransferLink } from '@/services/engines/transfer-correlation';
import { buildSalesIndex, type SalesMatch } from '@/services/engines/sales-reconciliation';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import { DEFAULT_RULES } from '@/services/engines/default-rules';
import { assessTestingRisk } from '@/services/engines/testing-risk-engine';
import { analyzePotencyTrends } from '@/services/engines/potency-trending-engine';
import type { AtRiskPackage, StrainTestRisk } from '@/services/engines/testing-risk-engine';
import { generateReconciliationStatement } from '@/services/engines/tolling-reconciliation-engine';
import { generateAuditReadinessReport } from '@/services/engines/audit-readiness-engine';
import type { ActionLogSummary, LastReconciliation } from '@/services/engines/audit-readiness-engine';
import { computeAutoDiscountPlan, buildPackageProductMap } from '@/services/engines/auto-discount-engine';
import type { AutoDiscountConfigData, DiscountTier } from '@/services/engines/auto-discount-engine';
import { scorePackagesForDiscounts } from '@/services/engines/discount-scoring-engine';
import {
  type DispositionCategory,
  type DispositionRecordData,
  toPolicyData,
  computeMonthlyUsage,
  buildDispositionSummary,
  validateDisposition,
  checkDispositionBudgets,
  DISPOSITION_CATEGORY_LABELS,
} from '@/services/engines/disposition-engine';
import {
  computeFullPipeline,
  traceHarvestToCash,
  buildSoldLabelsFromReceipts,
  buildTransitLabels,
  buildSalesRevenueMap,
  buildHarvestToFirstGenIndex,
  buildLocationOverrides,
  PIPELINE_STAGE_LABELS,
  type PipelineData,
  type PipelineLocationOverrides,
  type PipelineStatusConfig,
  type PipelineStage,
} from '@/services/engines/pipeline-stage-engine';
import {
  aggregateWasteSources,
  computeWasteAnalysis,
} from '@/services/engines/waste-analysis-engine';

// ---------------------------------------------------------------------------
// Tool Definitions — re-exported from copilot-tool-defs.ts (client-safe)
// ---------------------------------------------------------------------------

export { COPILOT_TOOLS, COPILOT_ACTION_TOOLS, ALL_COPILOT_TOOLS, CORE_COPILOT_TOOLS };

// ---------------------------------------------------------------------------
// Tool Executor
// ---------------------------------------------------------------------------

interface ActionLogInput {
  facilityId: string;
  userId: string;
  actionType: string;
  status: string;
  targetType: string;
  targetIds: string[];
  targetCount: number;
  executedAt?: Date;
}

interface ToolExecutorContext {
  packages: MetrcPackage[];
  client?: IMetrcClient; // undefined in org mode — only cross-facility tools are exposed
  rules?: RuleDefinition[];
  facilityId?: string;
  userId?: string;
  /** FOR-1491: user's role on this facility. When set and below OPERATOR,
   *  action tools refuse to dispatch. Undefined disables the check (org mode). */
  userFacilityRole?: string;
  createActionLog?: (data: ActionLogInput) => Promise<void>;
  prisma?: PrismaClient;
  dashboardPrisma?: PrismaClient;
  facility?: MetrcFacility;
  accessibleFacilityIds?: string[]; // Org-scoped facility IDs for cross-facility cache reads
}

/** Resolve org facilities scoped by FOR-1172 access control.
 *  In org mode (ctx.facility undefined), falls back to accessibleFacilityIds. */
async function getAccessibleOrgFacilities(ctx: ToolExecutorContext) {
  // Org mode: facility is undefined — use accessibleFacilityIds directly
  if (!ctx.facility && ctx.accessibleFacilityIds && ctx.accessibleFacilityIds.length > 0) {
    return ctx.prisma!.metrcFacility.findMany({
      where: { id: { in: ctx.accessibleFacilityIds }, isActive: true },
    });
  }
  // Facility mode: resolve from organization
  const fac = ctx.facility as MetrcFacility;
  let facilities = await ctx.prisma!.metrcFacility.findMany({
    where: { organizationId: fac.organizationId, isActive: true },
  });
  if (ctx.accessibleFacilityIds && ctx.accessibleFacilityIds.length > 0) {
    const allowed = new Set(ctx.accessibleFacilityIds);
    facilities = facilities.filter(f => allowed.has(f.id));
  }
  return facilities;
}

/**
 * Snapshot-first read of active packages with live-Metrc fallback.
 * Falls to live only when the snapshot returns zero rows (uninitialized facility),
 * the read throws, or prisma/facilityId aren't in scope. See parity plan AD2.
 */
export async function getActivePackagesWithFallback(
  prisma: PrismaClient | undefined,
  facilityId: string | undefined,
  liveClient: IMetrcClient,
): Promise<MetrcPackage[]> {
  if (prisma && facilityId) {
    try {
      const snapshot = await getActivePackagesFromDb(prisma, facilityId);
      if (snapshot.length > 0) return snapshot;
    } catch {
      // fall through to live
    }
  }
  return liveClient.getActivePackages();
}

/** Tools that work in org mode (no facility required). Exported for tool-list filtering. */
export const ORG_COMPATIBLE_TOOLS = new Set([
  'get_consolidated_pnl',
  'get_operations_summary',
  'get_run_rate_comparison',
  'get_cross_facility_inventory_summary',
  'compare_strains',
  'ask_knowledge_base',
]);

/** Bounded concurrency for cross-facility Metrc API calls. */
const API_CONCURRENCY = 5;

function truncateResults(data: unknown, maxItems: number = 25): string {
  const json = JSON.stringify(data);
  // If the result is small enough, return as-is
  if (json.length < 8000) return json;

  // Try to truncate arrays in the result
  if (Array.isArray(data)) {
    const truncated = data.slice(0, maxItems);
    return JSON.stringify({
      results: truncated,
      totalCount: data.length,
      truncated: data.length > maxItems,
    });
  }

  // For objects, try to truncate array values
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > maxItems) {
        result[key] = value.slice(0, maxItems);
        result[key + '_totalCount'] = value.length;
        result[key + '_truncated'] = true;
      } else {
        result[key] = value;
      }
    }
    return JSON.stringify(result);
  }

  // Last resort: truncate the string
  return json.slice(0, 8000) + '...(truncated)';
}

/** Resolve a possibly-truncated label to a full package label via suffix matching. */
function resolveLabel(label: string, packages: MetrcPackage[]): MetrcPackage | undefined {
  const trimmed = label.trim();
  // Exact match first
  const exact = packages.find(p => p.Label === trimmed);
  if (exact) return exact;
  // Strip leading non-alphanumeric (ellipsis, dots, underscores, etc.)
  const suffix = trimmed.replace(/^[^A-Za-z0-9]+/, '');
  if (suffix.length >= 6) {
    const match = packages.find(p => p.Label.endsWith(suffix));
    if (match) return match;
    const matchCI = packages.find(p => p.Label.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matchCI) return matchCI;
  }
  // Last resort: extract digits and suffix-match
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 6) {
    const digitMatch = packages.find(p => p.Label.endsWith(digitsOnly));
    if (digitMatch) return digitMatch;
  }
  return undefined;
}

/** Validate labels against the loaded packages array. Returns valid and invalid lists.
 *  Supports suffix matching for truncated labels (e.g., "…00000077", "...00000077", "_00000077")
 *  that the LLM may pass despite being told to use full labels in tool calls. */
function validateLabels(labels: string[], packages: MetrcPackage[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const rawLabel of labels) {
    const label = typeof rawLabel === 'string' ? rawLabel : String(rawLabel);
    const resolved = resolveLabel(label, packages);
    if (resolved) {
      valid.push(resolved.Label);
    } else {
      console.warn(`[validateLabels] Could not resolve label (${label.length} chars)`);
      invalid.push(label.trim());
    }
  }
  return { valid, invalid };
}

const ACTION_TOOL_NAMES = new Set(COPILOT_ACTION_TOOLS.map(t => t.function.name));

/** Load pipeline location overrides for copilot tools. */
async function loadCopilotPipelineOverrides(ctx: ToolExecutorContext): Promise<PipelineLocationOverrides | undefined> {
  if (!ctx.prisma || !ctx.facilityId) return undefined;
  const config = await ctx.prisma.pipelineConfig.findUnique({
    where: { facilityId: ctx.facilityId },
    include: { statuses: true },
  });
  if (!config || !config.isEnabled || !config.statuses?.length) return undefined;
  const statusConfigs: PipelineStatusConfig[] = config.statuses.map((s) => ({
    phase: s.phase as PipelineStage,
    name: s.name,
    color: s.color ?? undefined,
    locationNames: Array.isArray(s.locationNames) ? (s.locationNames as string[]) : [],
  }));
  return buildLocationOverrides(statusConfigs);
}

/** Builds PipelineData from snapshot DB — same source as dashboard routers.
 *  Falls back to live API if prisma/facilityId not available. */
async function buildCopilotPipelineData(client: IMetrcClient, prisma?: PrismaClient, facilityId?: string): Promise<PipelineData> {
  const logErr = (endpoint: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[copilot-pipeline] ${endpoint} failed: ${msg}`);
    return [] as never[];
  };

  let packages: MetrcPackage[];
  let activeHarvests: MetrcHarvest[];
  let inactiveHarvests: MetrcHarvest[];
  let receipts: MetrcSaleReceipt[];
  let outgoing: MetrcTransfer[];

  if (prisma && facilityId) {
    // Snapshot-first: read from DB — same source as dashboard
    const {
      getActivePackagesFromDb,
      getActiveHarvestsFromDb,
      getInactiveHarvestsFromDb,
      getOutgoingTransfersFromDb,
    } = await import('@/services/metrc/snapshot-utils');

    [packages, activeHarvests, inactiveHarvests, outgoing] = await Promise.all([
      getActivePackagesFromDb(prisma, facilityId).catch(logErr('getActivePackagesFromDb')),
      getActiveHarvestsFromDb(prisma, facilityId).catch(logErr('getActiveHarvestsFromDb')),
      getInactiveHarvestsFromDb(prisma, facilityId).catch(logErr('getInactiveHarvestsFromDb')),
      getOutgoingTransfersFromDb(prisma, facilityId).catch(logErr('getOutgoingTransfersFromDb')),
    ]);
    // Sales receipts still from live API (no snapshot equivalent for active receipts)
    receipts = await client.getSalesReceipts().catch(logErr('getSalesReceipts'));
  } else {
    // Fallback: live API (org mode or missing context)
    [packages, activeHarvests, inactiveHarvests, receipts, outgoing] = await Promise.all([
      client.getActivePackages().catch(logErr('getActivePackages')),
      client.getActiveHarvests().catch(logErr('getActiveHarvests')),
      client.getInactiveHarvests().catch(logErr('getInactiveHarvests')),
      client.getSalesReceipts().catch(logErr('getSalesReceipts')),
      client.getOutgoingTransfers().catch(logErr('getOutgoingTransfers')),
    ]);
  }

  console.log(`[copilot-pipeline] ${packages.length} pkgs, ${activeHarvests.length} active harvests, ${inactiveHarvests.length} inactive harvests`);

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentInactive = inactiveHarvests.filter((h: MetrcHarvest) => {
    const d = new Date(h.FinishedDate || h.HarvestStartDate);
    return d >= ninetyDaysAgo;
  });
  const harvests = [...activeHarvests, ...recentInactive];

  const provenanceIndex = buildProvenanceIndex(packages, harvests);
  const soldLabels = buildSoldLabelsFromReceipts(receipts as Array<{ Transactions?: Array<{ PackageLabel?: string }> }>);
  const transitLabels = buildTransitLabels(outgoing as Array<{ DeliveryPackages?: Array<{ PackageLabel?: string }> }>);
  const salesRevenue = buildSalesRevenueMap(receipts as Array<{ Transactions?: Array<{ PackageLabel?: string; TotalPrice?: number }> }>);
  const harvestToFirstGen = buildHarvestToFirstGenIndex(packages);

  return { packages, harvests, provenanceIndex, soldLabels, transitLabels, salesRevenue, harvestToFirstGen };
}

export function createToolExecutor(ctx: ToolExecutorContext) {
  const { packages, rules } = ctx;

  return async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Org mode guard: facility-specific tools require a facility context
    if (!ctx.facility && !ORG_COMPATIBLE_TOOLS.has(name)) {
      return JSON.stringify({
        note: 'This tool requires a specific facility. Try asking a cross-facility question like "How is the business doing across all facilities?" or "Compare operations across my facilities."',
      });
    }
    // Facility-specific tools are guarded above; client is always available for them.
    // Org-compatible tools use per-facility clients via getMetrcClient(), never ctx.client.
    const client = ctx.client as IMetrcClient;
    // Check if this is an action tool that needs facilityId/userId
    const isActionTool = ACTION_TOOL_NAMES.has(name);
    if (isActionTool && (!ctx.facilityId || !ctx.userId)) {
      return JSON.stringify({ error: 'Action tools require facility context. Please try again.' });
    }
    // FOR-1491: refuse action tools for users below OPERATOR on this facility.
    // userFacilityRole is set by sendMessage in facility mode; in org mode it's
    // undefined (and action tools are blocked earlier by the !ctx.facility guard).
    if (isActionTool && ctx.userFacilityRole && !requireFacilityRole(ctx.userFacilityRole, 'OPERATOR')) {
      return JSON.stringify({
        error: 'This action requires Operator or Admin facility access. Your role does not permit changes.',
      });
    }
    switch (name) {
      case 'get_inventory_overview': {
        const categoryMap = new Map<string, { count: number; totalQty: number; unit: string; packages: Array<{ label: string; itemName: string; quantity: number }> }>();
        let totalQty = 0;
        let onHold = 0;
        const labStates = new Map<string, number>();

        for (const pkg of packages) {
          totalQty += pkg.Quantity;
          if (pkg.IsOnHold) onHold++;
          const cat = pkg.ItemCategory || 'Unknown';
          const existing = categoryMap.get(cat);
          if (existing) {
            existing.count++;
            existing.totalQty += pkg.Quantity;
            if (existing.packages.length < 5) {
              existing.packages.push({ label: pkg.Label, itemName: pkg.ItemName, quantity: pkg.Quantity });
            }
          } else {
            categoryMap.set(cat, { count: 1, totalQty: pkg.Quantity, unit: pkg.UnitOfMeasureName, packages: [{ label: pkg.Label, itemName: pkg.ItemName, quantity: pkg.Quantity }] });
          }
          const lab = pkg.LabTestingState || 'Unknown';
          labStates.set(lab, (labStates.get(lab) || 0) + 1);
        }

        return JSON.stringify({
          totalPackages: packages.length,
          totalQuantity: Math.round(totalQty * 100) / 100,
          onHoldCount: onHold,
          categories: Array.from(categoryMap.entries()).map(([cat, d]) => ({
            category: cat, count: d.count, totalQuantity: Math.round(d.totalQty * 100) / 100, unit: d.unit,
            topPackages: d.packages,
          })).sort((a, b) => b.count - a.count),
          labTestingStates: Array.from(labStates.entries()).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
        });
      }

      case 'analyze_aging': {
        const distribution = analyzeAgingDistribution(packages);
        // Strip full package arrays to save tokens, keep counts
        return JSON.stringify({
          fresh: { ...distribution.fresh, packages: distribution.fresh.packages.slice(0, 5) },
          normal: { ...distribution.normal, packages: distribution.normal.packages.slice(0, 5) },
          aging: { ...distribution.aging, packages: distribution.aging.packages.slice(0, 5) },
          critical: { ...distribution.critical, packages: distribution.critical.packages.slice(0, 5) },
          totalPackages: distribution.totalPackages,
          totalQuantityByUnit: distribution.totalQuantityByUnit,
          averageAgeDays: distribution.averageAgeDays,
          medianAgeDays: distribution.medianAgeDays,
        });
      }

      case 'get_aging_recommendations': {
        const recs = generateAgingRecommendations(packages);
        return truncateResults(recs, 30);
      }

      case 'detect_fifo_violations': {
        const violations = detectFIFOViolations(packages);
        return truncateResults(violations, 20);
      }

      case 'detect_slow_moving': {
        const thresholds = {
          slow: (args.slow_days as number) || 45,
          stagnant: (args.stagnant_days as number) || 75,
          dead: (args.dead_days as number) || 120,
        };
        const slowMoving = detectSlowMoving(packages, thresholds);
        const summary = {
          total: slowMoving.length,
          byTier: {
            slow: slowMoving.filter(p => p.tier === 'slow').length,
            stagnant: slowMoving.filter(p => p.tier === 'stagnant').length,
            dead: slowMoving.filter(p => p.tier === 'dead').length,
          },
          packages: slowMoving.slice(0, 25),
        };
        return JSON.stringify(summary);
      }

      case 'run_compliance_audit': {
        const audit = generateAuditSnapshot(packages, ctx.facility?.facilityType);
        return JSON.stringify(audit);
      }

      case 'evaluate_business_rules': {
        const activeRules: RuleDefinition[] = rules && rules.length > 0
          ? rules
          : DEFAULT_RULES.map((r, i) => ({ ...r, id: `default-${i}`, isActive: true }));
        const violations = evaluateRulesAgainstPackages(activeRules, packages);
        const summary = {
          totalViolations: violations.length,
          bySeverity: {
            CRITICAL: violations.filter(v => v.severity === 'CRITICAL').length,
            WARNING: violations.filter(v => v.severity === 'WARNING').length,
            INFO: violations.filter(v => v.severity === 'INFO').length,
          },
          byCategory: {} as Record<string, number>,
          violations: violations.slice(0, 25),
        };
        for (const v of violations) {
          summary.byCategory[v.category] = (summary.byCategory[v.category] || 0) + 1;
        }
        return JSON.stringify(summary);
      }

      case 'detect_fragmentation': {
        const fragmented = detectFragmentation(packages);
        return truncateResults(fragmented, 15);
      }

      case 'get_consolidation_recommendations': {
        const recs = generateConsolidationRecommendations(packages);
        return truncateResults(recs, 15);
      }

      case 'find_sample_out_candidates': {
        const candidates = findSampleOutCandidates(packages);
        return truncateResults(candidates, 25);
      }

      case 'detect_short_counts': {
        const threshold = (args.mode_threshold as number) || 3;
        const shortFindings = detectShortCounts(packages, threshold);
        return truncateResults({
          findings: shortFindings.slice(0, 20),
          totalFindings: shortFindings.length,
          totalShortPackages: shortFindings.reduce((sum, f) => sum + f.shortCountPackages.length, 0),
          summary: `Found ${shortFindings.length} items with potential short counts across ${shortFindings.reduce((s, f) => s + f.shortCountPackages.length, 0)} packages`,
        }, 20);
      }

      case 'analyze_biomass': {
        // Load operator-configured biomass exclusion patterns (e.g., "mids", "pre-ground")
        let excludedPatterns: string[] = [];
        if (ctx.prisma && ctx.facilityId) {
          const bm = await ctx.prisma.operatorBenchmark.findUnique({
            where: { facilityId_category_key: { facilityId: ctx.facilityId, category: 'biomass', key: 'excluded_item_patterns' } },
          });
          excludedPatterns = bm?.notes?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
        }
        const biomass = analyzeBiomassUtilization(packages, excludedPatterns);
        return JSON.stringify(biomass);
      }

      case 'recommend_biomass_usage': {
        let excludedPatterns: string[] = [];
        if (ctx.prisma && ctx.facilityId) {
          const bm = await ctx.prisma.operatorBenchmark.findUnique({
            where: { facilityId_category_key: { facilityId: ctx.facilityId, category: 'biomass', key: 'excluded_item_patterns' } },
          });
          excludedPatterns = bm?.notes?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
        }
        const biomass = analyzeBiomassUtilization(packages, excludedPatterns);
        if (biomass.totalBiomassPackages === 0) {
          return JSON.stringify({ message: 'No biomass packages found in current inventory.', recommendations: [] });
        }

        // Gather strain yield data from harvests
        let strainYieldTrends: import('@/services/analytics/strain-intelligence').StrainYieldTrend[] = []
        try {
          const harvests = await client.getActiveHarvests();
          const yieldResult = analyzeYieldTrends(harvests);
          strainYieldTrends = yieldResult.trends;
        } catch {
          // Continue without yield data
        }

        // Gather BOM inference data from ActionLog
        let bomSuggestions: import('@/services/engines/bom-inference').BOMSuggestion[] = []
        if (ctx.prisma && ctx.facilityId) {
          try {
            const logs = await ctx.prisma.actionLog.findMany({
              where: { facilityId: ctx.facilityId, actionType: 'PROCESSING_CREATE', status: 'COMPLETED' },
              select: { previewData: true, status: true, actionType: true },
              orderBy: { createdAt: 'desc' },
              take: 200,
            });
            const result = inferBOMsFromHistory(
              logs.map(l => ({ previewData: l.previewData, status: l.status, actionType: l.actionType })),
              [],
            );
            bomSuggestions = result.suggestions;
          } catch {
            // Continue without BOM data
          }
        }

        const result = analyzeBiomassRecommendations(biomass, strainYieldTrends, bomSuggestions);
        return truncateResults({
          summary: result.summary,
          strainInsights: result.strainInsights,
          recommendations: result.recommendations.slice(0, 30),
          warnings: result.warnings,
          totalRecommendations: result.recommendations.length,
        }, 30);
      }

      case 'assess_fulfillment_risk': {
        let outgoing: MetrcTransfer[] = [];
        let incoming: MetrcTransfer[] = [];
        try {
          [outgoing, incoming] = await Promise.all([
            client.getOutgoingTransfers(),
            client.getIncomingTransfers(),
          ]);
        } catch {
          // If transfers fail, continue with empty arrays
        }
        const assessment = assessFulfillmentRisk(packages, outgoing, incoming);
        return JSON.stringify({
          overallRisk: assessment.overallRisk,
          summary: assessment.summary,
          risks: assessment.risks.slice(0, 15),
          categoryStock: assessment.categoryStock.slice(0, 10),
          transferVelocity: assessment.transferVelocity,
        });
      }

      case 'analyze_employee_patterns': {
        let transfers: MetrcTransfer[] = [];
        try {
          const [outgoing, incoming] = await Promise.all([
            client.getOutgoingTransfers(),
            client.getIncomingTransfers(),
          ]);
          transfers = [...outgoing, ...incoming];
        } catch {
          return JSON.stringify({ error: 'Unable to fetch transfer data for employee analysis' });
        }
        const patterns = analyzeEmployeePatterns(transfers);
        return JSON.stringify(patterns);
      }

      case 'identify_training_needs': {
        let transfers: MetrcTransfer[] = [];
        try {
          const [outgoing, incoming] = await Promise.all([
            client.getOutgoingTransfers(),
            client.getIncomingTransfers(),
          ]);
          transfers = [...outgoing, ...incoming];
        } catch {
          return JSON.stringify({ error: 'Unable to fetch transfer data for training analysis' });
        }
        const needs = identifyTrainingNeeds(packages, transfers);
        return truncateResults(needs, 20);
      }

      case 'calculate_tolling': {
        const inputWeight = args.input_weight as number;
        const outputWeight = args.output_weight as number;
        const processingFee = args.processing_fee as number;
        if (!inputWeight || !outputWeight || !processingFee) {
          return JSON.stringify({ error: 'Missing required parameters: input_weight, output_weight, processing_fee' });
        }
        const result = calculateTolling(inputWeight, outputWeight, processingFee);
        return JSON.stringify(result);
      }

      case 'search_packages': {
        const { calculateAgeDays } = await import('@/services/metrc/types');
        const { normSearch, multiWordMatch } = await import('@/shared/utils/search');
        const query = normSearch((args.query as string) || '');
        const category = (args.category as string) || '';
        const strain = (args.strain as string) || '';
        const onHoldFilter = args.on_hold as boolean | undefined;
        const labTestingState = (args.lab_testing_state as string) || '';
        const minAge = (args.min_age_days as number) || 0;
        const maxAge = (args.max_age_days as number) || Infinity;
        const limit = Math.min((args.limit as number) || 30, 50);

        const matched = packages.filter(pkg => {
          if (query && !multiWordMatch([
            normSearch(pkg.Label),
            normSearch(pkg.ItemName),
            normSearch(pkg.ItemCategory),
            normSearch(pkg.ItemStrainName || ''),
            normSearch(pkg.LocationName || ''),
            String(pkg.Quantity),
          ], query)) return false;
          if (category && !pkg.ItemCategory.toLowerCase().includes(category.toLowerCase())) return false;
          if (strain && !(pkg.ItemStrainName || '').toLowerCase().includes(strain.toLowerCase())) return false;
          if (onHoldFilter !== undefined && pkg.IsOnHold !== onHoldFilter) return false;
          if (labTestingState && (pkg.LabTestingState || '').toLowerCase() !== labTestingState.toLowerCase()) return false;
          const age = calculateAgeDays(pkg.PackagedDate);
          if (age < minAge || age > maxAge) return false;
          return true;
        });

        const totalMatches = matched.length;
        const results = matched.slice(0, limit).map(pkg => ({
          label: pkg.Label,
          itemName: pkg.ItemName,
          category: pkg.ItemCategory,
          strain: pkg.ItemStrainName,
          quantity: pkg.Quantity,
          unit: pkg.UnitOfMeasureName,
          ageDays: calculateAgeDays(pkg.PackagedDate),
          location: pkg.LocationName,
          isOnHold: pkg.IsOnHold,
          labTesting: pkg.LabTestingState,
        }));

        if (results.length === 0) {
          return JSON.stringify({ totalMatches: 0, packages: [], message: 'No packages matched the search criteria. Do not fabricate or guess package labels — report that no matches were found.' });
        }

        // Compute summary: total quantity and category breakdown for all matches (not just the returned page)
        const totalQuantity = Math.round(matched.reduce((sum, p) => sum + p.Quantity, 0) * 100) / 100;
        const catCounts = new Map<string, number>();
        for (const p of matched) {
          catCounts.set(p.ItemCategory, (catCounts.get(p.ItemCategory) || 0) + 1);
        }

        return JSON.stringify({
          totalMatches,
          returnedCount: results.length,
          totalQuantity,
          categoryBreakdown: Array.from(catCounts.entries()).map(([cat, count]) => ({ category: cat, count })),
          packages: results,
        });
      }

      // -----------------------------------------------------------------------
      // ACTION TOOLS — execute Metrc operations
      // -----------------------------------------------------------------------

      case 'flag_packages_for_discount': {
        const labels = (args.labels as string[]) || [];
        console.log(`[Copilot] flag_packages_for_discount called with ${labels.length} labels`);
        if (labels.length === 0) return JSON.stringify({ error: 'No package labels provided' });
        if (labels.length > 50) return JSON.stringify({ error: 'Max 50 packages per action. Got ' + labels.length });
        const { valid, invalid } = validateLabels(labels, packages);
        if (valid.length === 0) return JSON.stringify({ error: 'None of the provided labels match active packages', invalidLabels: invalid });
        try {
          await client.changePackageNote(valid.map(l => ({ Label: l, Note: 'Flagged: Discount - aging inventory' })));
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_DISCOUNT', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'flag_for_discount', count: valid.length, labels: valid, ...(invalid.length > 0 ? { skippedInvalid: invalid } : {}) });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_DISCOUNT', status: 'FAILED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)), labels: valid });
        }
      }

      case 'flag_packages_for_testing': {
        const labels = (args.labels as string[]) || [];
        if (labels.length === 0) return JSON.stringify({ error: 'No package labels provided' });
        if (labels.length > 50) return JSON.stringify({ error: 'Max 50 packages per action. Got ' + labels.length });
        const { valid, invalid } = validateLabels(labels, packages);
        if (valid.length === 0) return JSON.stringify({ error: 'None of the provided labels match active packages', invalidLabels: invalid });

        // Filter to only NotSubmitted packages — skip those already submitted or tested
        const notYetSubmitted = valid.filter(label => {
          const pkg = packages.find(p => p.Label === label);
          return pkg && pkg.LabTestingState === 'NotSubmitted';
        });
        const alreadySubmitted = valid.filter(l => !notYetSubmitted.includes(l));

        if (notYetSubmitted.length === 0) {
          return JSON.stringify({ success: true, action: 'submit_for_testing', count: 0, note: 'All packages are already submitted or tested', alreadySubmitted });
        }

        // Try to submit via POST /packages/v2/testing (creates lab sample, transitions to SubmittedForTesting)
        try {
          // Fetch available tags for the sample packages
          const availableTags = await client.getAvailableTags();
          if (availableTags.length < notYetSubmitted.length) {
            // Not enough tags — fall back to note change
            console.warn(`[Copilot] Only ${availableTags.length} tags available for ${notYetSubmitted.length} packages. Falling back to note change.`);
            throw new Error('Not enough available tags for testing samples');
          }

          const today = new Date().toISOString().split('T')[0];
          const payload = notYetSubmitted.map((label, i) => {
            const pkg = packages.find(p => p.Label === label);
            return {
              Tag: availableTags[i]!.Label,
              Location: null,
              Item: pkg?.ItemName ?? 'Unknown Item',
              Quantity: (pkg?.UnitOfMeasureName === 'Each') ? 1 : 1.0,
              UnitOfMeasure: pkg?.UnitOfMeasureName ?? 'Grams',
              PackagedDate: today,
              IsProductionBatch: false,
              ProductionBatchNumber: null,
              ProductRequiresRemediation: false,
              SourcePackageLabels: label,
              Note: '',
            };
          });

          await client.submitPackagesForTesting(payload as unknown as Record<string, unknown>[]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_SUBMIT_FOR_TESTING', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: notYetSubmitted, targetCount: notYetSubmitted.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'submit_for_testing', count: notYetSubmitted.length, labels: notYetSubmitted, ...(alreadySubmitted.length > 0 ? { alreadySubmitted } : {}), ...(invalid.length > 0 ? { skippedInvalid: invalid } : {}) });
        } catch {
          // Fallback: change package note (original behavior for CO or when API call fails)
          console.warn(`[Copilot] submitPackagesForTesting failed (${valid.length} labels). Falling back to note change.`);
          try {
            await client.changePackageNote(valid.map(l => ({ Label: l, Note: 'Flagged: Expedite lab testing' })));
            if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
              await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_EXPEDITE_TESTING', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length, executedAt: new Date() });
            }
            return JSON.stringify({ success: true, action: 'flag_for_testing_note', count: valid.length, labels: valid, note: 'Fell back to note change — submit-for-testing API call failed', ...(invalid.length > 0 ? { skippedInvalid: invalid } : {}) });
          } catch (noteErr) {
            if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
              await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_EXPEDITE_TESTING', status: 'FAILED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length });
            }
            return JSON.stringify({ error: 'Both submit-for-testing and note fallback failed: ' + (noteErr instanceof Error ? noteErr.message : String(noteErr)), labels: valid });
          }
        }
      }

      case 'remediate_packages_action': {
        const labels = (args.labels as string[]) || [];
        if (labels.length === 0) return JSON.stringify({ error: 'No package labels provided' });
        if (labels.length > 50) return JSON.stringify({ error: 'Max 50 packages per action. Got ' + labels.length });
        const { valid, invalid } = validateLabels(labels, packages);
        if (valid.length === 0) return JSON.stringify({ error: 'None of the provided labels match active packages', invalidLabels: invalid });
        try {
          await client.remediatePackages(valid.map(l => ({ Label: l })));
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_REMEDIATE', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'remediate', count: valid.length, labels: valid, ...(invalid.length > 0 ? { skippedInvalid: invalid } : {}) });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_REMEDIATE', status: 'FAILED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)), labels: valid });
        }
      }

      case 'finish_packages_action': {
        const labels = (args.labels as string[]) || [];
        const confirmed = args.confirmed === true;
        if (labels.length === 0) return JSON.stringify({ error: 'No package labels provided' });
        if (labels.length > 50) return JSON.stringify({ error: 'Max 50 packages per action. Got ' + labels.length });
        const { valid, invalid } = validateLabels(labels, packages);
        if (valid.length === 0) return JSON.stringify({ error: 'None of the provided labels match active packages', invalidLabels: invalid });

        // Server-side confirmation gate: must call with confirmed=true to execute
        if (!confirmed) {
          const pkgDetails = valid.map(l => {
            const p = packages.find(pkg => pkg.Label === l);
            return { label: l, itemName: p?.ItemName, quantity: p?.Quantity, unit: p?.UnitOfMeasureName };
          });
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'finish_packages',
            message: `This will PERMANENTLY destroy ${valid.length} package(s). This cannot be undone. Please confirm with the user before calling again with confirmed=true.`,
            packages: pkgDetails,
            ...(invalid.length > 0 ? { skippedInvalid: invalid } : {}),
          });
        }

        try {
          await client.finishPackages(valid.map(l => ({ Label: l })));
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_FINISH', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'finish', count: valid.length, labels: valid, warning: 'These packages have been permanently removed from active inventory.' });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_FINISH', status: 'FAILED', targetType: 'PACKAGE', targetIds: valid, targetCount: valid.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)), labels: valid });
        }
      }

      case 'adjust_package_quantity': {
        const label = args.label as string;
        const newQuantity = args.new_quantity as number;
        const reason = (args.reason as string) || 'Adjusted via Copilot';
        if (!label || newQuantity == null) return JSON.stringify({ error: 'Missing required parameters: label, new_quantity' });
        if (newQuantity < 0) return JSON.stringify({ error: 'Quantity cannot be negative' });
        const pkg = resolveLabel(label, packages);
        if (!pkg) return JSON.stringify({ error: `Package ${label} not found in active inventory. Cannot adjust a package that doesn't exist.` });
        const resolvedLabel = pkg.Label;
        if (newQuantity === 0) return JSON.stringify({ error: 'Cannot set quantity to 0 via adjust. Use finish_packages_action to remove a package.' });
        try {
          await client.adjustPackages([{ Label: resolvedLabel, Quantity: newQuantity, UnitOfMeasureName: pkg.UnitOfMeasureName, AdjustmentReason: reason }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_ADJUST', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: [label], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'adjust_quantity', label, previousQuantity: pkg.Quantity, newQuantity, unit: pkg.UnitOfMeasureName, reason });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_ADJUST', status: 'FAILED', targetType: 'PACKAGE', targetIds: [label], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)), label });
        }
      }

      // -----------------------------------------------------------------------
      // HARVEST TOOLS
      // -----------------------------------------------------------------------

      case 'get_harvest_summary': {
        let active: MetrcHarvest[] = [];
        let onHold: MetrcHarvest[] = [];
        let inactive: MetrcHarvest[] = [];
        try {
          [active, onHold, inactive] = await Promise.all([
            client.getActiveHarvests(),
            client.getOnHoldHarvests(),
            client.getInactiveHarvests(),
          ]);
        } catch {
          return JSON.stringify({ error: 'Unable to fetch harvest data' });
        }

        const totalActiveWeight = active.reduce((s, h) => s + h.CurrentWeight, 0);
        const totalWasteWeight = [...active, ...inactive].reduce((s, h) => s + h.TotalWasteWeight, 0);
        const strainMap = new Map<string, number>();
        const locationMap = new Map<string, number>();
        for (const h of active) {
          strainMap.set(h.SourceStrainNames, (strainMap.get(h.SourceStrainNames) || 0) + 1);
          locationMap.set(h.DryingLocationName, (locationMap.get(h.DryingLocationName) || 0) + 1);
        }

        return JSON.stringify({
          activeCount: active.length,
          onHoldCount: onHold.length,
          finishedCount: inactive.length,
          totalActiveWeightGrams: Math.round(totalActiveWeight * 100) / 100,
          totalWasteWeightGrams: Math.round(totalWasteWeight * 100) / 100,
          strainBreakdown: Array.from(strainMap.entries()).map(([strain, count]) => ({ strain, count })).sort((a, b) => b.count - a.count),
          dryingLocations: Array.from(locationMap.entries()).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count),
        });
      }

      case 'get_active_harvests': {
        let harvests: MetrcHarvest[] = [];
        try {
          harvests = await client.getActiveHarvests();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active harvests' });
        }

        const strainFilter = (args.strain as string) || '';
        const limit = (args.limit as number) || 25;

        let filtered = harvests;
        if (strainFilter) {
          filtered = filtered.filter(h => h.SourceStrainNames.toLowerCase().includes(strainFilter.toLowerCase()));
        }

        const results = filtered.slice(0, limit).map(h => {
          const startDate = new Date(h.HarvestStartDate);
          const ageDays = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: h.Id,
            name: h.Name,
            strain: h.SourceStrainNames,
            harvestType: h.HarvestType,
            currentWeight: h.CurrentWeight,
            wasteWeight: h.TotalWasteWeight,
            packageCount: h.PackageCount,
            packagedWeight: h.TotalPackagedWeight,
            unit: h.UnitOfWeightName,
            dryingLocation: h.DryingLocationName,
            labTestingState: h.LabTestingState,
            isOnHold: h.IsOnHold,
            ageDays,
            harvestStartDate: h.HarvestStartDate,
          };
        });

        return JSON.stringify({ matchCount: results.length, totalActive: harvests.length, harvests: results });
      }

      case 'finish_harvests_action': {
        const harvestIds = (args.harvest_ids as number[]) || [];
        const confirmed = args.confirmed === true;
        if (harvestIds.length === 0) return JSON.stringify({ error: 'No harvest IDs provided' });
        if (harvestIds.length > 50) return JSON.stringify({ error: 'Max 50 harvests per action. Got ' + harvestIds.length });

        let activeHarvests: MetrcHarvest[] = [];
        try {
          activeHarvests = await client.getActiveHarvests();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active harvests' });
        }

        const validIds: number[] = [];
        const invalidIds: number[] = [];
        for (const id of harvestIds) {
          if (activeHarvests.find(h => h.Id === id)) {
            validIds.push(id);
          } else {
            invalidIds.push(id);
          }
        }
        if (validIds.length === 0) return JSON.stringify({ error: 'None of the provided IDs match active harvests', invalidIds });

        if (!confirmed) {
          const details = validIds.map(id => {
            const h = activeHarvests.find(h => h.Id === id);
            return { id, name: h?.Name, strain: h?.SourceStrainNames, currentWeight: h?.CurrentWeight, unit: h?.UnitOfWeightName };
          });
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'finish_harvests',
            message: `This will PERMANENTLY finish ${validIds.length} harvest(s). Please confirm.`,
            harvests: details,
            ...(invalidIds.length > 0 ? { skippedInvalid: invalidIds } : {}),
          });
        }

        try {
          await client.finishHarvests(validIds.map(id => ({ Id: id })));
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_FINISH', status: 'COMPLETED', targetType: 'HARVEST', targetIds: validIds.map(String), targetCount: validIds.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'finish_harvests', count: validIds.length, harvestIds: validIds, ...(invalidIds.length > 0 ? { skippedInvalid: invalidIds } : {}) });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_FINISH', status: 'FAILED', targetType: 'HARVEST', targetIds: validIds.map(String), targetCount: validIds.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_packages_from_harvest': {
        const harvestId = args.harvest_id as number;
        const itemName = args.item_name as string;
        const quantity = args.quantity as number;
        const unit = (args.unit as string) || 'Grams';
        const packageCount = (args.package_count as number) || 1;
        const harvestConfirmed = args.confirmed === true;

        if (!harvestId || !itemName || quantity == null) {
          return JSON.stringify({ error: 'Missing required parameters: harvest_id, item_name, quantity' });
        }
        if (quantity <= 0) {
          return JSON.stringify({ error: 'Quantity must be a positive number' });
        }
        if (packageCount <= 0) {
          return JSON.stringify({ error: 'Package count must be a positive number' });
        }

        let activeHarvestList: MetrcHarvest[] = [];
        try {
          activeHarvestList = await client.getActiveHarvests();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active harvests' });
        }
        const harvest = activeHarvestList.find(h => h.Id === harvestId);
        if (!harvest) return JSON.stringify({ error: `Harvest ${harvestId} not found in active harvests` });

        if (!harvestConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_PACKAGE', status: 'PREVIEWING', targetType: 'HARVEST', targetIds: [String(harvestId)], targetCount: packageCount });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_packages_from_harvest',
            message: `This will create ${packageCount} package(s) of "${itemName}" (${quantity} ${unit} each) from harvest "${harvest.Name}" (${harvest.SourceStrainNames}). Current harvest weight: ${harvest.CurrentWeight} ${harvest.UnitOfWeightName}. Please confirm.`,
            harvest: { id: harvest.Id, name: harvest.Name, strain: harvest.SourceStrainNames, currentWeight: harvest.CurrentWeight, unit: harvest.UnitOfWeightName },
          });
        }

        try {
          const pkgData = Array.from({ length: packageCount }, () => ({
            HarvestId: harvestId,
            ItemName: itemName,
            Quantity: quantity,
            UnitOfMeasureName: unit,
            ActualDate: new Date().toISOString().split('T')[0],
          }));
          await client.createPackagesFromHarvest(pkgData);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_PACKAGE', status: 'COMPLETED', targetType: 'HARVEST', targetIds: [String(harvestId)], targetCount: packageCount, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'create_packages_from_harvest', harvestId, itemName, quantity, unit, packageCount });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_PACKAGE', status: 'FAILED', targetType: 'HARVEST', targetIds: [String(harvestId)], targetCount: packageCount });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'record_harvest_waste': {
        const wasteHarvestId = args.harvest_id as number;
        const wasteType = args.waste_type as string;
        const wasteWeight = args.waste_weight as number;
        const wasteUnit = (args.unit as string) || 'Grams';
        const wasteConfirmed = args.confirmed === true;

        if (!wasteHarvestId || !wasteType || wasteWeight == null) {
          return JSON.stringify({ error: 'Missing required parameters: harvest_id, waste_type, waste_weight' });
        }
        if (wasteWeight <= 0) {
          return JSON.stringify({ error: 'Waste weight must be a positive number' });
        }

        let wasteHarvestList: MetrcHarvest[] = [];
        try {
          wasteHarvestList = await client.getActiveHarvests();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active harvests' });
        }
        const wasteHarvest = wasteHarvestList.find(h => h.Id === wasteHarvestId);
        if (!wasteHarvest) return JSON.stringify({ error: `Harvest ${wasteHarvestId} not found in active harvests` });

        if (!wasteConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_WASTE', status: 'PREVIEWING', targetType: 'HARVEST', targetIds: [String(wasteHarvestId)], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'record_harvest_waste',
            message: `This will record ${wasteWeight} ${wasteUnit} of "${wasteType}" waste from harvest "${wasteHarvest.Name}". Current waste total: ${wasteHarvest.TotalWasteWeight} ${wasteHarvest.UnitOfWeightName}. Please confirm.`,
            harvest: { id: wasteHarvest.Id, name: wasteHarvest.Name, currentWaste: wasteHarvest.TotalWasteWeight },
          });
        }

        try {
          await client.recordHarvestWaste([{
            Id: wasteHarvestId,
            WasteType: wasteType,
            WasteWeight: wasteWeight,
            UnitOfWeight: wasteUnit,
            ActualDate: new Date().toISOString().split('T')[0],
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_WASTE', status: 'COMPLETED', targetType: 'HARVEST', targetIds: [String(wasteHarvestId)], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'record_harvest_waste', harvestId: wasteHarvestId, wasteType, wasteWeight, unit: wasteUnit });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_HARVEST_WASTE', status: 'FAILED', targetType: 'HARVEST', targetIds: [String(wasteHarvestId)], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'destroy_plant_batches_action': {
        const batchIds = (args.plant_batch_ids as number[]) || [];
        const destroyReason = (args.reason as string) || 'Destroyed via Copilot';
        const destroyConfirmed = args.confirmed === true;
        if (batchIds.length === 0) return JSON.stringify({ error: 'No plant batch IDs provided' });
        if (batchIds.length > 50) return JSON.stringify({ error: 'Max 50 batches per action. Got ' + batchIds.length });

        let activeBatches: MetrcPlantBatch[] = [];
        try {
          activeBatches = await client.getActivePlantBatches();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active plant batches' });
        }

        const validBatchIds: number[] = [];
        const invalidBatchIds: number[] = [];
        for (const id of batchIds) {
          if (activeBatches.find(b => b.Id === id)) {
            validBatchIds.push(id);
          } else {
            invalidBatchIds.push(id);
          }
        }
        if (validBatchIds.length === 0) return JSON.stringify({ error: 'None of the provided IDs match active plant batches', invalidIds: invalidBatchIds });

        if (!destroyConfirmed) {
          const details = validBatchIds.map(id => {
            const b = activeBatches.find(b => b.Id === id);
            return { id, name: b?.Name, strain: b?.StrainName, count: b?.Count, type: b?.Type };
          });
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_DESTROY_PLANTS', status: 'PREVIEWING', targetType: 'PLANT_BATCH', targetIds: validBatchIds.map(String), targetCount: validBatchIds.length });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'destroy_plant_batches',
            message: `This will PERMANENTLY destroy ${validBatchIds.length} plant batch(es). This cannot be undone. Please confirm.`,
            batches: details,
            ...(invalidBatchIds.length > 0 ? { skippedInvalid: invalidBatchIds } : {}),
          });
        }

        try {
          await client.destroyPlantBatches(validBatchIds.map(id => ({
            Id: id,
            DestroyedNote: destroyReason,
            ActualDate: new Date().toISOString().split('T')[0],
          })));
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_DESTROY_PLANTS', status: 'COMPLETED', targetType: 'PLANT_BATCH', targetIds: validBatchIds.map(String), targetCount: validBatchIds.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'destroy_plant_batches', count: validBatchIds.length, batchIds: validBatchIds, warning: 'These plant batches have been permanently destroyed.' });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_DESTROY_PLANTS', status: 'FAILED', targetType: 'PLANT_BATCH', targetIds: validBatchIds.map(String), targetCount: validBatchIds.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_plant_batches_action': {
        const batchName = args.name as string;
        const batchType = args.type as string;
        const batchStrain = args.strain as string;
        const batchCount = args.count as number;
        const batchLocation = (args.location as string) || '';
        const createConfirmed = args.confirmed === true;

        if (!batchName || !batchType || !batchStrain || batchCount == null) {
          return JSON.stringify({ error: 'Missing required parameters: name, type, strain, count' });
        }
        if (batchCount <= 0) {
          return JSON.stringify({ error: 'Plant count must be a positive number' });
        }

        if (!createConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PLANTS', status: 'PREVIEWING', targetType: 'PLANT_BATCH', targetIds: [batchName], targetCount: batchCount });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_plant_batches',
            message: `This will create a new ${batchType} batch "${batchName}" with ${batchCount} plants of strain "${batchStrain}"${batchLocation ? ' at location "' + batchLocation + '"' : ''}. Please confirm.`,
            batch: { name: batchName, type: batchType, strain: batchStrain, count: batchCount, location: batchLocation },
          });
        }

        try {
          await client.createPlantBatches([{
            Name: batchName,
            Type: batchType,
            StrainName: batchStrain,
            Count: batchCount,
            LocationName: batchLocation,
            ActualDate: new Date().toISOString().split('T')[0],
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PLANTS', status: 'COMPLETED', targetType: 'PLANT_BATCH', targetIds: [batchName], targetCount: batchCount, executedAt: new Date() });
          }
          return JSON.stringify({
            success: true, action: 'create_plant_batches', name: batchName, type: batchType, strain: batchStrain, count: batchCount, location: batchLocation,
            note: 'Plant batch created successfully. It should now appear under Plant Batches. If the user does not see it, advise them to refresh the page.',
          });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PLANTS', status: 'FAILED', targetType: 'PLANT_BATCH', targetIds: [batchName], targetCount: batchCount });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // PLANT BATCH TOOLS
      // -----------------------------------------------------------------------

      case 'get_plant_batch_summary': {
        let active: MetrcPlantBatch[] = [];
        let inactive: MetrcPlantBatch[] = [];
        try {
          [active, inactive] = await Promise.all([
            client.getActivePlantBatches(),
            client.getInactivePlantBatches(),
          ]);
        } catch {
          return JSON.stringify({ error: 'Unable to fetch plant batch data' });
        }

        const totalPlants = active.reduce((s, b) => s + b.Count, 0);
        const totalTracked = active.reduce((s, b) => s + b.TrackedCount, 0);
        const strainMap = new Map<string, number>();
        const typeMap = new Map<string, number>();
        for (const b of active) {
          strainMap.set(b.StrainName, (strainMap.get(b.StrainName) || 0) + b.Count);
          typeMap.set(b.Type, (typeMap.get(b.Type) || 0) + 1);
        }

        return JSON.stringify({
          activeBatches: active.length,
          inactiveBatches: inactive.length,
          totalPlants,
          totalTracked,
          totalUntracked: totalPlants - totalTracked,
          byType: Array.from(typeMap.entries()).map(([type, count]) => ({ type, batchCount: count })),
          strainBreakdown: Array.from(strainMap.entries()).map(([strain, plantCount]) => ({ strain, plantCount })).sort((a, b) => b.plantCount - a.plantCount).slice(0, 10),
        });
      }

      case 'get_active_plant_batches': {
        let batches: MetrcPlantBatch[] = [];
        try {
          batches = await client.getActivePlantBatches();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active plant batches' });
        }

        const strainFilter = (args.strain as string) || '';
        const typeFilter = (args.type as string) || '';
        const limit = (args.limit as number) || 25;

        let filtered = batches;
        if (strainFilter) filtered = filtered.filter(b => b.StrainName.toLowerCase().includes(strainFilter.toLowerCase()));
        if (typeFilter) filtered = filtered.filter(b => b.Type.toLowerCase() === typeFilter.toLowerCase());

        const results = filtered.slice(0, limit).map(b => {
          const planted = new Date(b.PlantedDate);
          const ageDays = Math.floor((Date.now() - planted.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: b.Id,
            name: b.Name,
            type: b.Type,
            strain: b.StrainName,
            totalCount: b.Count,
            trackedCount: b.TrackedCount,
            untrackedCount: b.UntrackedCount,
            harvestedCount: b.HarvestedCount,
            destroyedCount: b.DestroyedCount,
            location: b.LocationName,
            plantedDate: b.PlantedDate,
            ageDays,
          };
        });

        return JSON.stringify({ matchCount: results.length, totalActive: batches.length, batches: results });
      }

      // -----------------------------------------------------------------------
      // NEW READ TOOLS — Plants, Transfers, Lab Tests, Strains, Items
      // -----------------------------------------------------------------------

      case 'get_active_plants': {
        let plants: MetrcPlant[] = [];
        try {
          plants = await client.getActivePlants();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active plants' });
        }

        const plantStrainFilter = (args.strain as string) || '';
        const phaseFilter = (args.growth_phase as string) || '';
        const plantLimit = (args.limit as number) || 25;

        let filteredPlants = plants;
        if (plantStrainFilter) filteredPlants = filteredPlants.filter(p => p.StrainName.toLowerCase().includes(plantStrainFilter.toLowerCase()));
        if (phaseFilter) filteredPlants = filteredPlants.filter(p => p.GrowthPhase.toLowerCase().includes(phaseFilter.toLowerCase()));

        const plantResults = filteredPlants.slice(0, plantLimit).map(p => {
          const planted = new Date(p.PlantedDate);
          const ageDays = Math.floor((Date.now() - planted.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: p.Id,
            label: p.Label,
            strain: p.StrainName,
            growthPhase: p.GrowthPhase,
            location: p.LocationName,
            room: p.RoomName,
            isOnHold: p.IsOnHold,
            plantedDate: p.PlantedDate,
            ageDays,
          };
        });

        return JSON.stringify({ matchCount: plantResults.length, totalActive: plants.length, plants: plantResults });
      }

      case 'get_transfer_summary': {
        let incoming: MetrcTransfer[] = [];
        let outgoing: MetrcTransfer[] = [];
        try {
          [incoming, outgoing] = await Promise.all([
            client.getIncomingTransfers(),
            client.getOutgoingTransfers(),
          ]);
        } catch {
          return JSON.stringify({ error: 'Unable to fetch transfer data' });
        }

        const pendingIncoming = incoming.filter(t => !t.ReceivedDateTime);
        const receivedIncoming = incoming.filter(t => t.ReceivedDateTime);
        const incomingPkgTotal = incoming.reduce((s, t) => s + t.PackageCount, 0);
        const outgoingPkgTotal = outgoing.reduce((s, t) => s + t.PackageCount, 0);

        return JSON.stringify({
          incoming: {
            total: incoming.length,
            pending: pendingIncoming.length,
            received: receivedIncoming.length,
            totalPackages: incomingPkgTotal,
            recent: incoming.slice(0, 10).map(t => ({
              id: t.Id,
              manifest: t.ManifestNumber,
              from: t.ShipperFacilityName,
              packages: t.PackageCount,
              received: !!t.ReceivedDateTime,
              created: t.CreatedDateTime,
            })),
          },
          outgoing: {
            total: outgoing.length,
            totalPackages: outgoingPkgTotal,
            recent: outgoing.slice(0, 10).map(t => ({
              id: t.Id,
              manifest: t.ManifestNumber,
              to: t.ReceiverFacilityName,
              packages: t.PackageCount,
              created: t.CreatedDateTime,
            })),
          },
        });
      }

      case 'get_lab_test_results': {
        let labResults: MetrcLabTest[] = [];
        try {
          labResults = await client.getLabTestResults();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch lab test results' });
        }

        const labLimit = (args.limit as number) || 25;
        const passed = labResults.filter(r => r.OverallPassed).length;
        const failed = labResults.length - passed;
        const byType = new Map<string, { pass: number; fail: number }>();
        for (const r of labResults) {
          const type = r.TestTypeName || 'Unknown';
          const entry = byType.get(type) || { pass: 0, fail: 0 };
          if (r.OverallPassed) entry.pass++;
          else entry.fail++;
          byType.set(type, entry);
        }

        return JSON.stringify({
          totalTests: labResults.length,
          passed,
          failed,
          passRate: labResults.length > 0 ? Math.round((passed / labResults.length) * 100) + '%' : 'N/A',
          byTestType: Array.from(byType.entries()).map(([type, counts]) => ({ type, ...counts })),
          results: labResults.slice(0, labLimit).map(r => ({
            packageLabel: r.PackageLabel,
            testType: r.TestTypeName,
            passed: r.OverallPassed,
            resultLevel: r.TestResultLevel,
            resultUnit: r.TestResultUnit,
            labFacility: r.LabFacilityName,
            testDate: r.TestPerformedDate,
          })),
        });
      }

      case 'get_active_strains': {
        let strains: MetrcStrain[] = [];
        try {
          strains = await client.getActiveStrains();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active strains' });
        }

        return JSON.stringify({
          totalStrains: strains.length,
          strains: strains.map(s => ({
            id: s.Id,
            name: s.Name,
            testingStatus: s.TestingStatus,
            thcLevel: s.ThcLevel,
            cbdLevel: s.CbdLevel,
            indicaPct: s.IndicaPercentage,
            sativaPct: s.SativaPercentage,
          })),
        });
      }

      case 'get_active_items': {
        let items: MetrcItem[] = [];
        try {
          items = await client.getActiveItems();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active items' });
        }

        const itemCategoryFilter = (args.category as string) || '';
        const itemLimit = (args.limit as number) || 50;

        let filteredItems = items;
        if (itemCategoryFilter) {
          filteredItems = filteredItems.filter(i => i.ProductCategoryName.toLowerCase().includes(itemCategoryFilter.toLowerCase()));
        }

        return JSON.stringify({
          totalItems: items.length,
          matchCount: filteredItems.length,
          items: filteredItems.slice(0, itemLimit).map(i => ({
            id: i.Id,
            name: i.Name,
            category: i.ProductCategoryName,
            categoryType: i.ProductCategoryType,
            unit: i.UnitOfMeasureName,
            strain: i.StrainName,
            defaultLabState: i.DefaultLabTestingState,
          })),
        });
      }

      // -----------------------------------------------------------------------
      // OPEX TOOLS
      // -----------------------------------------------------------------------

      case 'get_opex_models': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'OpEx tools require facility context' });
        }
        try {
          const models = await ctx.prisma.opExModel.findMany({
            where: { facilityId: ctx.facilityId },
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              name: true,
              status: true,
              annualRevenue: true,
              annualCost: true,
              costPerPound: true,
              grossMargin: true,
              grossProfit: true,
              taxableProfit: true,
              sourceFile: true,
              updatedAt: true,
            },
          });
          return JSON.stringify({
            totalModels: models.length,
            models: models.map((m) => ({
              id: m.id,
              name: m.name,
              status: m.status,
              kpis: {
                annualRevenue: m.annualRevenue,
                annualCost: m.annualCost,
                costPerPound: m.costPerPound,
                grossMargin: m.grossMargin,
                grossProfit: m.grossProfit,
                taxableProfit: m.taxableProfit,
              },
              sourceFile: m.sourceFile,
              lastUpdated: m.updatedAt,
            })),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch OpEx models: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_opex_model_detail': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'OpEx tools require facility context' });
        }
        const modelId = args.model_id as string;
        if (!modelId) return JSON.stringify({ error: 'model_id is required' });

        try {
          const cells = await ctx.prisma.opExCell.findMany({
            where: { modelId },
            select: {
              key: true,
              label: true,
              cellType: true,
              dataType: true,
              value: true,
              unit: true,
              formula: true,
              group: {
                select: {
                  label: true,
                  section: {
                    select: { name: true, slug: true },
                  },
                },
              },
            },
            orderBy: { sortOrder: 'asc' },
          });

          // Group by section for readability
          const sectionMap = new Map<string, Array<{ key: string; label: string; value: number | null; unit: string | null; type: string }>>();
          for (const cell of cells) {
            const sectionName = cell.group.section.name;
            if (!sectionMap.has(sectionName)) sectionMap.set(sectionName, []);
            sectionMap.get(sectionName)!.push({
              key: cell.key,
              label: cell.label,
              value: cell.value,
              unit: cell.unit,
              type: cell.cellType,
            });
          }

          return truncateResults({
            modelId,
            totalCells: cells.length,
            sections: Object.fromEntries(sectionMap),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch model detail: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'simulate_opex_change': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'OpEx tools require facility context' });
        }
        const simModelId = args.model_id as string;
        const changes = args.changes as Array<{ cell_key: string; new_value: number }>;
        if (!simModelId) return JSON.stringify({ error: 'model_id is required' });
        if (!changes || changes.length === 0) return JSON.stringify({ error: 'At least one change is required' });

        try {
          const allCells = await ctx.prisma.opExCell.findMany({
            where: { modelId: simModelId },
          });

          const { createOpExEngine } = await import('@/services/engines/opex-engine');
          type CellDef = { key: string; cellType: 'INPUT' | 'COMPUTED' | 'CONSTANT'; formula: string | null; value: number | null };

          const changeMap = new Map(changes.map((c: { cell_key: string; new_value: number }) => [c.cell_key, c.new_value]));
          const cellDefs: CellDef[] = allCells.map((c) => ({
            key: c.key,
            cellType: c.cellType as 'INPUT' | 'COMPUTED' | 'CONSTANT',
            formula: c.formula,
            value: changeMap.has(c.key) ? changeMap.get(c.key)! : c.value,
          }));

          const engine = createOpExEngine();
          engine.buildGraph(cellDefs);
          engine.setKPICells([
            'pnl.annual_revenue', 'pnl.total_annual_cost', 'pnl.cost_per_pound',
            'pnl.gross_margin_pct', 'pnl.gross_profit', 'pnl.taxable_profit',
          ]);

          const result = engine.evaluateAll();

          // Also get the original KPIs for comparison
          const model = await ctx.prisma.opExModel.findFirst({
            where: { id: simModelId },
            select: { annualRevenue: true, annualCost: true, costPerPound: true, grossMargin: true, grossProfit: true, taxableProfit: true },
          });

          const originalKPIs: Record<string, number | null> = model ? {
            'pnl.annual_revenue': model.annualRevenue,
            'pnl.total_annual_cost': model.annualCost,
            'pnl.cost_per_pound': model.costPerPound,
            'pnl.gross_margin_pct': model.grossMargin,
            'pnl.gross_profit': model.grossProfit,
            'pnl.taxable_profit': model.taxableProfit,
          } : {};

          return JSON.stringify({
            simulation: true,
            changesApplied: changes,
            currentKPIs: originalKPIs,
            simulatedKPIs: result.kpis,
            delta: {
              annualRevenue: (result.kpis['pnl.annual_revenue'] ?? 0) - (originalKPIs['pnl.annual_revenue'] ?? 0),
              annualCost: (result.kpis['pnl.total_annual_cost'] ?? 0) - (originalKPIs['pnl.total_annual_cost'] ?? 0),
              grossMargin: (result.kpis['pnl.gross_margin_pct'] ?? 0) - (originalKPIs['pnl.gross_margin_pct'] ?? 0),
              grossProfit: (result.kpis['pnl.gross_profit'] ?? 0) - (originalKPIs['pnl.gross_profit'] ?? 0),
            },
            note: 'This is a simulation only. No values were saved. Use the OpEx Calculator UI to save changes.',
          });
        } catch (err) {
          return JSON.stringify({ error: 'Simulation failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // SUPPLY INVENTORY TOOLS
      // -----------------------------------------------------------------------

      case 'query_supply_inventory': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Supply inventory tools require facility context' });
        }
        try {
          const search = (args.search as string) || '';
          const category = (args.category as string) || '';

          const where: Record<string, unknown> = { facilityId: ctx.facilityId };
          if (search) {
            where.name = { contains: search, mode: 'insensitive' };
          }
          if (category) {
            where.category = { contains: category, mode: 'insensitive' };
          }

          const items = await ctx.prisma.supplyItem.findMany({
            where,
            orderBy: { name: 'asc' },
            take: 50,
          });

          return truncateResults({
            totalItems: items.length,
            items: items.map((item) => ({
              id: item.id,
              name: item.name,
              categoryId: item.categoryId,
              currentStock: item.currentStock,
              unit: item.unit,
              reorderPoint: item.reorderPoint,
              vendor: item.vendor,
              unitCost: item.unitCost,
            })),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to query supply inventory: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'check_production_feasibility': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Supply inventory tools require facility context' });
        }
        const metrcItemName = args.metrc_item_name as string;
        const requestedQuantity = args.requested_quantity as number;
        if (!metrcItemName || requestedQuantity == null) {
          return JSON.stringify({ error: 'Missing required parameters: metrc_item_name, requested_quantity' });
        }
        if (requestedQuantity <= 0) {
          return JSON.stringify({ error: 'requested_quantity must be a positive number' });
        }

        try {
          const bomRows = await ctx.prisma.billOfMaterial.findMany({
            where: {
              facilityId: ctx.facilityId,
              metrcItemName: { contains: metrcItemName, mode: 'insensitive' },
            },
            include: {
              componentItem: true,
            },
          });

          if (bomRows.length === 0) {
            return JSON.stringify({ error: `No Bill of Materials found for item "${metrcItemName}". Set one up at Supply > Bill of Materials — approve auto-inferred suggestions from processing history, import a spreadsheet, or create manually.` });
          }

          const bomLines: BOMLine[] = bomRows
            .filter((row) => row.componentItem != null)
            .map((row) => ({
              componentItemId: row.componentItemId ?? '',
              componentName: row.componentItem!.name,
              quantityPerUnit: row.quantityPerUnit,
              unit: row.componentItem!.unit,
              currentStock: row.componentItem!.currentStock,
              unitCost: row.componentItem!.unitCost,
            }));

          const result = checkFeasibility(metrcItemName, requestedQuantity, bomLines);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: 'Failed to check production feasibility: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_low_stock_alerts': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Supply inventory tools require facility context' });
        }
        try {
          const items = await ctx.prisma.supplyItem.findMany({
            where: {
              facilityId: ctx.facilityId,
              reorderPoint: { not: null },
            },
          });

          const alerts = findLowStockItems(
            items.map((item) => ({
              id: item.id,
              name: item.name,
              currentStock: item.currentStock,
              reorderPoint: item.reorderPoint,
              unit: item.unit,
              vendor: item.vendor,
            })),
          );

          return JSON.stringify({
            totalAlerts: alerts.length,
            alerts,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to get low stock alerts: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // SUPPLY RECEIPT ACTION TOOL
      // -----------------------------------------------------------------------

      case 'record_supply_receipt': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Supply inventory tools require facility context' });
        }
        const receiptItemName = args.item_name as string;
        const receiptQuantity = args.quantity as number;
        const receiptNotes = (args.notes as string) || '';
        const receiptConfirmed = args.confirmed === true;

        if (!receiptItemName || receiptQuantity == null) {
          return JSON.stringify({ error: 'Missing required parameters: item_name, quantity' });
        }
        if (receiptQuantity <= 0) {
          return JSON.stringify({ error: 'Quantity must be a positive number' });
        }

        try {
          // Search for matching supply items
          const matchingItems = await ctx.prisma.supplyItem.findMany({
            where: {
              facilityId: ctx.facilityId,
              name: { contains: receiptItemName, mode: 'insensitive' },
            },
            take: 5,
          });

          if (matchingItems.length === 0) {
            return JSON.stringify({ error: `No supply item found matching "${receiptItemName}". Check the item name and try again.` });
          }
          if (matchingItems.length > 1) {
            return JSON.stringify({
              error: 'Multiple supply items match that name. Please be more specific.',
              matches: matchingItems.map((i) => ({ id: i.id, name: i.name, categoryId: i.categoryId, currentStock: i.currentStock, unit: i.unit })),
            });
          }

          const item = matchingItems[0];

          if (!receiptConfirmed) {
            if (ctx.createActionLog && ctx.userId) {
              await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_SUPPLY_RECEIPT', status: 'PREVIEWING', targetType: 'SUPPLY_ITEM', targetIds: [item.id], targetCount: 1 });
            }
            return JSON.stringify({
              status: 'confirmation_required',
              action: 'record_supply_receipt',
              message: `This will add ${receiptQuantity} ${item.unit} of "${item.name}" to current stock (${item.currentStock} ${item.unit}).${receiptNotes ? ' Notes: ' + receiptNotes : ''} Please confirm.`,
              item: { id: item.id, name: item.name, currentStock: item.currentStock, unit: item.unit, newStock: item.currentStock + receiptQuantity },
            });
          }

          // Execute within a transaction
          await ctx.prisma.$transaction([
            ctx.prisma.supplyTransaction.create({
              data: {
                itemId: item.id,
                facilityId: ctx.facilityId,
                type: 'IN',
                quantity: receiptQuantity,
                notes: receiptNotes || null,
                createdBy: ctx.userId || null,
              },
            }),
            ctx.prisma.supplyItem.update({
              where: { id: item.id },
              data: { currentStock: { increment: receiptQuantity } },
            }),
          ]);

          if (ctx.createActionLog && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_SUPPLY_RECEIPT', status: 'COMPLETED', targetType: 'SUPPLY_ITEM', targetIds: [item.id], targetCount: 1, executedAt: new Date() });
          }

          return JSON.stringify({
            success: true,
            action: 'record_supply_receipt',
            item: item.name,
            quantityReceived: receiptQuantity,
            previousStock: item.currentStock,
            newStock: item.currentStock + receiptQuantity,
            unit: item.unit,
          });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_SUPPLY_RECEIPT', status: 'FAILED', targetType: 'SUPPLY_ITEM', targetIds: [], targetCount: 0 });
          }
          return JSON.stringify({ error: 'Failed to record supply receipt: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // PACKAGE PROVENANCE TOOL
      // -----------------------------------------------------------------------

      case 'get_package_provenance': {
        const provenanceLabel = args.package_label as string;
        if (!provenanceLabel) {
          return JSON.stringify({ error: 'Missing required parameter: package_label' });
        }

        try {
          // Fetch harvests from the Metrc client for harvest-level provenance
          let harvests: MetrcHarvest[] = [];
          try {
            const [active, inactive] = await Promise.all([
              client.getActiveHarvests(),
              client.getInactiveHarvests(),
            ]);
            harvests = [...active, ...inactive];
          } catch {
            // Continue without harvest data — package-level provenance still works
          }

          const index = buildProvenanceIndex(packages, harvests);
          const tree = getProvenance(provenanceLabel, index);

          return truncateResults({
            targetLabel: tree.targetLabel,
            maxDepth: tree.maxDepth,
            ancestorCount: tree.nodes.length,
            ancestors: tree.nodes,
            ancestorEdges: tree.edges,
            descendantCount: tree.downstream.length,
            descendants: tree.downstream,
            descendantEdges: tree.downstreamEdges,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to trace package provenance: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // SEED-TO-SALE JOURNEY TOOLS
      // -----------------------------------------------------------------------

      case 'trace_package_journey': {
        const journeyLabel = args.package_label as string;
        if (!journeyLabel) {
          return JSON.stringify({ error: 'Missing required parameter: package_label' });
        }
        try {
          let harvests: MetrcHarvest[] = [];
          try {
            const [active, inactive] = await Promise.all([
              client.getActiveHarvests(),
              client.getInactiveHarvests(),
            ]);
            harvests = [...active, ...inactive];
          } catch { /* continue without harvest data */ }

          const [inTransfers, outTransfers] = await Promise.all([
            client.getIncomingTransfers(),
            client.getOutgoingTransfers(),
          ]);

          const index = buildProvenanceIndex(packages, harvests);
          const tree = getProvenance(journeyLabel, index);
          const pkg = index.packageMap.get(journeyLabel);
          const transfers: TransferLink[] = pkg ? correlateTransfers(pkg, inTransfers, outTransfers) : [];

          let sales: SalesMatch[] = [];
          if (ctx.facility) {
            try {
              const fac = ctx.facility as MetrcFacility;
              const dutchie = getDutchieClient(fac);
              const salesIdx = await buildSalesIndex(dutchie);
              sales = salesIdx.get(journeyLabel) ?? [];
            } catch { /* Dutchie not configured — skip */ }
          }

          return truncateResults({
            targetLabel: tree.targetLabel,
            maxDepth: tree.maxDepth,
            ancestors: tree.nodes,
            ancestorEdges: tree.edges,
            descendants: tree.downstream,
            descendantEdges: tree.downstreamEdges,
            transfers,
            sales,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to trace package journey: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'reconcile_package_sales': {
        const salesLabel = args.package_label as string;
        if (!salesLabel) {
          return JSON.stringify({ error: 'Missing required parameter: package_label' });
        }
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Sales reconciliation requires facility context' });
        }
        try {
          const fac = ctx.facility as MetrcFacility;
          const dutchie = getDutchieClient(fac);
          const salesIdx = await buildSalesIndex(dutchie);
          const sales = salesIdx.get(salesLabel) ?? [];
          return truncateResults({
            packageLabel: salesLabel,
            matchCount: sales.length,
            matches: sales,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to reconcile sales: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_transfer_chain': {
        const transferLabel = args.package_label as string;
        if (!transferLabel) {
          return JSON.stringify({ error: 'Missing required parameter: package_label' });
        }
        try {
          const pkg = resolveLabel(transferLabel, packages);
          if (!pkg) {
            return JSON.stringify({ error: `Package "${transferLabel}" not found` });
          }
          const [inTransfers, outTransfers] = await Promise.all([
            client.getIncomingTransfers(),
            client.getOutgoingTransfers(),
          ]);
          const transfers = correlateTransfers(pkg, inTransfers, outTransfers);
          return truncateResults({
            packageLabel: transferLabel,
            incoming: transfers.filter(t => t.direction === 'incoming'),
            outgoing: transfers.filter(t => t.direction === 'outgoing'),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to get transfer chain: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // ADVANCED TOLLING TOOLS
      // -----------------------------------------------------------------------

      case 'calculate_advanced_tolling': {
        const inputWeightGrams = args.input_weight_grams as number;
        const outputWeightGrams = args.output_weight_grams as number;
        const rawFees = args.fees as Array<{ name: string; type: string; amount: number }>;
        const revenuePerGram = args.revenue_per_gram as number | undefined;

        if (!inputWeightGrams || !outputWeightGrams || !rawFees || rawFees.length === 0) {
          return JSON.stringify({ error: 'Missing required parameters: input_weight_grams, output_weight_grams, fees' });
        }

        // Map user-friendly fee types to engine FeeDefinition
        const feeTypeMap: Record<string, { feeType: 'PER_UNIT' | 'FLAT' | 'PERCENTAGE'; basis: 'input_weight' | 'output_weight' | 'fixed' | 'revenue' }> = {
          per_gram_input: { feeType: 'PER_UNIT', basis: 'input_weight' },
          per_gram_output: { feeType: 'PER_UNIT', basis: 'output_weight' },
          flat: { feeType: 'FLAT', basis: 'fixed' },
          percentage_revenue: { feeType: 'PERCENTAGE', basis: 'revenue' },
        };

        const feeStructure: FeeDefinition[] = rawFees.map((f) => {
          const mapping = feeTypeMap[f.type] || { feeType: 'PER_UNIT' as const, basis: 'input_weight' as const };
          return {
            feeType: mapping.feeType,
            label: f.name,
            rate: f.amount,
            basis: mapping.basis,
          };
        });

        const revenue = revenuePerGram != null ? revenuePerGram * outputWeightGrams : undefined;
        const result = calculateFees(feeStructure, inputWeightGrams, outputWeightGrams, revenue);
        return JSON.stringify(result);
      }

      case 'compare_tolling_partners': {
        const cmpInputWeight = args.input_weight_grams as number;
        const cmpOutputWeight = args.output_weight_grams as number;
        const cmpRevenuePerGram = args.revenue_per_gram as number;
        const scenarios = args.scenarios as Array<{ partner_name: string; fees: Array<{ name: string; type: string; amount: number }> }>;

        if (!cmpInputWeight || !cmpOutputWeight || !cmpRevenuePerGram || !scenarios || scenarios.length === 0) {
          return JSON.stringify({ error: 'Missing required parameters: input_weight_grams, output_weight_grams, revenue_per_gram, scenarios' });
        }

        const feeTypeMap: Record<string, { feeType: 'PER_UNIT' | 'FLAT' | 'PERCENTAGE'; basis: 'input_weight' | 'output_weight' | 'fixed' | 'revenue' }> = {
          per_gram_input: { feeType: 'PER_UNIT', basis: 'input_weight' },
          per_gram_output: { feeType: 'PER_UNIT', basis: 'output_weight' },
          flat: { feeType: 'FLAT', basis: 'fixed' },
          percentage_revenue: { feeType: 'PERCENTAGE', basis: 'revenue' },
        };

        const yieldPct = cmpInputWeight > 0 ? (cmpOutputWeight / cmpInputWeight) * 100 : 0;
        const totalRevenue = cmpRevenuePerGram * cmpOutputWeight;

        const partnerInputs = scenarios.map((s) => ({
          partnerName: s.partner_name,
          feeStructure: s.fees.map((f) => {
            const mapping = feeTypeMap[f.type] || { feeType: 'PER_UNIT' as const, basis: 'input_weight' as const };
            return {
              feeType: mapping.feeType,
              label: f.name,
              rate: f.amount,
              basis: mapping.basis,
            } as FeeDefinition;
          }),
          inputWeight: cmpInputWeight,
          expectedYieldPct: yieldPct,
          revenue: totalRevenue,
        }));

        const comparisons = comparePartners(partnerInputs);
        return truncateResults(comparisons);
      }

      // -----------------------------------------------------------------------
      // SALES TOOLS (Dutchie POS)
      // -----------------------------------------------------------------------

      case 'get_sales_summary': {
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Sales tools require facility context' });
        }
        try {
          const fac = ctx.facility as MetrcFacility;
          const days = Math.min(90, Math.max(1, (args.days as number) || 30));
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          const hasDutchie = fac.dutchieEnvironment && fac.dutchieEnvironment !== 'none';

          if (hasDutchie) {
            const dutchieClient = getDutchieClient(fac);
            const deliveries = await dutchieClient.getDeliveries({
              includeLineItems: true,
              fromDateUTC: cutoff.toISOString(),
            });
            const completed = deliveries.filter(d => d.Status === 'Completed');
            const totalRevenue = completed.reduce((sum, d) => sum + d.OrderTotal, 0);
            const totalTransactions = completed.length;
            const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

            const categoryMap = new Map<string, { revenue: number; count: number }>();
            for (const d of completed) {
              for (const li of d.LineItems ?? []) {
                const cat = li.Category || 'Other';
                const existing = categoryMap.get(cat);
                if (existing) { existing.revenue += li.TotalPrice; existing.count += li.Quantity; }
                else { categoryMap.set(cat, { revenue: li.TotalPrice, count: li.Quantity }); }
              }
            }
            const topCategory = Array.from(categoryMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue)[0];
            return JSON.stringify({
              source: 'dutchie_pos',
              period: `Last ${days} days`,
              totalRevenue: Math.round(totalRevenue * 100) / 100,
              totalTransactions,
              avgOrderValue: Math.round(avgOrderValue * 100) / 100,
              topCategory: topCategory ? { name: topCategory[0], revenue: Math.round(topCategory[1].revenue * 100) / 100 } : null,
              totalTax: Math.round(completed.reduce((sum, d) => sum + d.TaxAmount, 0) * 100) / 100,
              totalDiscount: Math.round(completed.reduce((sum, d) => sum + d.DiscountAmount, 0) * 100) / 100,
              categories: Array.from(categoryMap.entries())
                .map(([name, data]) => ({ name, revenue: Math.round(data.revenue * 100) / 100, units: data.count }))
                .sort((a, b) => b.revenue - a.revenue),
            });
          }

          // Fallback: Metrc RetailSale — aggregate in DB, not JS (1.3M+ rows)
          if (ctx.prisma && ctx.facilityId) {
            const [catGroups, receiptCount] = await Promise.all([
              ctx.prisma.retailSale.groupBy({
                by: ['productCategory'],
                where: { facilityId: ctx.facilityId, soldAt: { gte: cutoff } },
                _sum: { totalPrice: true, quantity: true },
                _count: true,
              }),
              ctx.prisma.retailSaleReceipt.count({
                where: { facilityId: ctx.facilityId, soldAt: { gte: cutoff } },
              }),
            ]);
            if (catGroups.length > 0) {
              const categories = catGroups.map(g => ({
                name: g.productCategory || 'Other',
                revenue: Math.round(Number(g._sum.totalPrice ?? 0) * 100) / 100,
                units: Number(g._sum.quantity ?? 0),
              })).sort((a, b) => b.revenue - a.revenue);
              const totalRevenue = categories.reduce((s, c) => s + c.revenue, 0);
              return JSON.stringify({
                source: 'metrc_sales',
                period: `Last ${days} days`,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                totalTransactions: receiptCount,
                avgOrderValue: receiptCount > 0 ? Math.round((totalRevenue / receiptCount) * 100) / 100 : 0,
                topCategory: categories[0] ? { name: categories[0].name, revenue: categories[0].revenue } : null,
                categories,
              });
            }
          }

          return JSON.stringify({ error: 'No sales data available. Connect Dutchie POS or import Metrc sales data.' });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch sales summary: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_top_products': {
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Sales tools require facility context' });
        }
        try {
          const dutchieClient = getDutchieClient(ctx.facility as MetrcFacility);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const deliveries = await dutchieClient.getDeliveries({
            includeLineItems: true,
            fromDateUTC: thirtyDaysAgo.toISOString(),
          });
          const completed = deliveries.filter(d => d.Status === 'Completed');
          const limit = (args.limit as number) || 10;

          const productMap = new Map<string, { revenue: number; unitsSold: number; category: string; brand: string | null }>();
          for (const d of completed) {
            for (const li of d.LineItems ?? []) {
              const key = li.ProductName;
              const existing = productMap.get(key);
              if (existing) {
                existing.revenue += li.TotalPrice;
                existing.unitsSold += li.Quantity;
              } else {
                productMap.set(key, { revenue: li.TotalPrice, unitsSold: li.Quantity, category: li.Category, brand: li.Brand });
              }
            }
          }

          const topProducts = Array.from(productMap.entries())
            .map(([name, data]) => ({
              name,
              revenue: Math.round(data.revenue * 100) / 100,
              unitsSold: data.unitsSold,
              category: data.category,
              brand: data.brand,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, limit);

          return JSON.stringify({ totalProducts: productMap.size, topProducts });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch top products: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // INVENTORY RUN-RATE ANALYSIS
      // -----------------------------------------------------------------------

      case 'analyze_inventory_run_rate': {
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Run-rate analysis requires facility context' });
        }
        try {
          const dutchieClient = getDutchieClient(ctx.facility as MetrcFacility);
          const result = await computeRunRates(packages, dutchieClient, {
            category: (args.category as string) || null,
            daysLookback: (args.days_lookback as number) || 30,
            limit: (args.limit as number) || 20,
            metrcClient: ctx.client,
            prisma: ctx.prisma,
            facilityId: (ctx.facility as MetrcFacility).id,
          });
          return truncateResults(result);
        } catch (err) {
          return JSON.stringify({ error: 'Failed to analyze run rate: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // FINANCIAL REPORTING TOOL (Org-level)
      // -----------------------------------------------------------------------

      case 'get_org_financials': {
        if (!ctx.prisma || !ctx.userId) {
          return JSON.stringify({ error: 'Financial tools require authentication context' });
        }
        try {
          const dbClient = ctx.dashboardPrisma ?? ctx.prisma;
          const memberships = await dbClient.membership.findMany({
            where: { userId: ctx.userId },
            select: { organizationId: true },
          });
          if (memberships.length === 0) {
            return JSON.stringify({ error: 'No organization found for this user' });
          }
          const orgId = memberships[0]!.organizationId;

          const facilities = await ctx.prisma.metrcFacility.findMany({
            where: { organizationId: orgId, isActive: true },
            select: { id: true, name: true, licenseNumber: true, facilityType: true },
          });
          const facilityIds = facilities.map(f => f.id);

          const [models, tolling, supplyItems] = await Promise.all([
            ctx.prisma.opExModel.findMany({
              where: { facilityId: { in: facilityIds }, status: 'ACTIVE', isDefault: true },
              select: { facilityId: true, annualRevenue: true, annualCost: true, grossMargin: true, grossProfit: true, costPerPound: true },
            }),
            ctx.prisma.tollingAgreement.findMany({
              where: { facilityId: { in: facilityIds }, status: 'ACTIVE' },
              select: { facilityId: true, totalFees: true },
            }),
            ctx.prisma.supplyItem.findMany({
              where: { facilityId: { in: facilityIds }, isActive: true },
              select: { facilityId: true, unitCost: true, currentStock: true },
            }),
          ]);

          const facilityBreakdown = facilities.map(f => {
            const model = models.find(m => m.facilityId === f.id);
            const fTolling = tolling.filter(t => t.facilityId === f.id);
            const fSupply = supplyItems.filter(s => s.facilityId === f.id);
            const tollingFees = fTolling.reduce((sum, t) => sum + (t.totalFees ?? 0), 0);
            const supplyCost = fSupply.reduce((sum, s) => sum + (s.unitCost ?? 0) * s.currentStock, 0);
            return {
              name: f.name,
              revenue: model?.annualRevenue ?? 0,
              cost: model?.annualCost ?? 0,
              grossMargin: model?.grossMargin ?? 0,
              grossProfit: model?.grossProfit ?? 0,
              tollingFees: Math.round(tollingFees * 100) / 100,
              supplyCost: Math.round(supplyCost * 100) / 100,
            };
          });

          const totals = {
            revenue: Math.round(facilityBreakdown.reduce((s, f) => s + f.revenue, 0) * 100) / 100,
            cost: Math.round(facilityBreakdown.reduce((s, f) => s + f.cost, 0) * 100) / 100,
            grossProfit: Math.round(facilityBreakdown.reduce((s, f) => s + f.grossProfit, 0) * 100) / 100,
            tollingFees: Math.round(facilityBreakdown.reduce((s, f) => s + f.tollingFees, 0) * 100) / 100,
            supplyCost: Math.round(facilityBreakdown.reduce((s, f) => s + f.supplyCost, 0) * 100) / 100,
            grossMargin: 0,
          };
          totals.grossMargin = totals.revenue > 0 ? Math.round((totals.grossProfit / totals.revenue) * 10000) / 100 : 0;

          return JSON.stringify({
            facilityCount: facilities.length,
            facilities: facilityBreakdown,
            totals,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch org financials: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_tag_inventory': {
        try {
          const allTags = await client.getAvailableTags();
          const available = allTags.filter(t => t.StatusName === 'Available');
          const used = allTags.filter(t => t.StatusName !== 'Available');
          const usagePercent = allTags.length > 0 ? Math.round((used.length / allTags.length) * 100) : 0;
          const nextAvailable = available
            .sort((a, b) => a.Label.localeCompare(b.Label))
            .slice(0, 5)
            .map(t => t.Label);
          return JSON.stringify({
            total: allTags.length,
            available: available.length,
            used: used.length,
            usagePercent,
            lowStock: available.length < 50,
            nextAvailableLabels: nextAvailable,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch tag inventory: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'search_tags': {
        const query = (args.query as string) || '';
        if (!query) {
          return JSON.stringify({ error: 'query parameter is required' });
        }
        try {
          const allTags = await client.getAvailableTags();
          const q = query.toLowerCase();
          const matches = allTags
            .filter(t => t.Label.toLowerCase().includes(q))
            .slice(0, 25)
            .map(t => ({
              label: t.Label,
              tagType: t.TagTypeName,
              status: t.StatusName,
              usedDateTime: t.UsedDateTime,
            }));
          return JSON.stringify({ query, matchCount: matches.length, tags: matches });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to search tags: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // ENTITY MANAGEMENT ACTION TOOLS
      // -----------------------------------------------------------------------

      case 'create_strain_action': {
        const strainName = args.name as string;
        const indicaPct = (args.indica_percentage as number) ?? 0;
        const sativaPct = (args.sativa_percentage as number) ?? 0;
        const thcLevel = (args.thc_level as number) ?? 0;
        const cbdLevel = (args.cbd_level as number) ?? 0;
        const strainConfirmed = args.confirmed === true;

        if (!strainName) {
          return JSON.stringify({ error: 'Missing required parameter: name' });
        }
        if (indicaPct + sativaPct > 100) {
          return JSON.stringify({ error: `Indica (${indicaPct}%) + Sativa (${sativaPct}%) exceeds 100%. Please correct the percentages.` });
        }

        // Dedup check: verify strain doesn't already exist before creating
        try {
          const existingStrains = await client.getActiveStrains();
          const duplicate = existingStrains.find(s => s.Name.toLowerCase() === strainName.toLowerCase());
          if (duplicate) {
            return JSON.stringify({
              already_exists: true,
              action: 'create_strain',
              name: duplicate.Name,
              indicaPercentage: duplicate.IndicaPercentage,
              sativaPercentage: duplicate.SativaPercentage,
              thcLevel: duplicate.ThcLevel,
              cbdLevel: duplicate.CbdLevel,
              message: `Strain "${duplicate.Name}" already exists in Metrc. No action needed. The user may need to refresh the page to see it in the catalog.`,
            });
          }
        } catch {
          // If the check fails, proceed with creation (Metrc API will reject true duplicates)
        }

        if (!strainConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_STRAIN', status: 'PREVIEWING', targetType: 'STRAIN', targetIds: [strainName], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_strain',
            message: `This will create a new strain "${strainName}" (Indica ${indicaPct}%, Sativa ${sativaPct}%, THC ${thcLevel}%, CBD ${cbdLevel}%). Please confirm.`,
            strain: { name: strainName, indicaPercentage: indicaPct, sativaPercentage: sativaPct, thcLevel, cbdLevel },
          });
        }

        try {
          await client.createStrains([{
            Name: strainName,
            IndicaPercentage: indicaPct,
            SativaPercentage: sativaPct,
            ThcLevel: thcLevel,
            CbdLevel: cbdLevel,
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_STRAIN', status: 'COMPLETED', targetType: 'STRAIN', targetIds: [strainName], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({
            success: true, action: 'create_strain', name: strainName, indicaPercentage: indicaPct, sativaPercentage: sativaPct, thcLevel, cbdLevel,
            note: 'Strain created successfully in Metrc. It is now available in the catalog. If the user does not see it, advise them to refresh the page.',
          });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_STRAIN', status: 'FAILED', targetType: 'STRAIN', targetIds: [strainName], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_item_action': {
        const itemName = args.name as string;
        const itemCategory = args.item_category as string;
        const unitOfMeasure = args.unit_of_measure as string;
        const itemStrain = (args.strain as string) || '';
        const itemConfirmed = args.confirmed === true;

        if (!itemName || !itemCategory || !unitOfMeasure) {
          return JSON.stringify({ error: 'Missing required parameters: name, item_category, unit_of_measure' });
        }

        // Dedup check: verify item doesn't already exist
        try {
          const existingItems = await client.getActiveItems();
          const duplicateItem = existingItems.find(i => i.Name.toLowerCase() === itemName.toLowerCase());
          if (duplicateItem) {
            return JSON.stringify({
              already_exists: true,
              action: 'create_item',
              name: duplicateItem.Name,
              category: duplicateItem.ProductCategoryName,
              unitOfMeasure: duplicateItem.UnitOfMeasureName,
              message: `Item "${duplicateItem.Name}" already exists in Metrc (category: ${duplicateItem.ProductCategoryName}). No action needed. The user may need to refresh the page to see it in the catalog.`,
            });
          }
        } catch {
          // If the check fails, proceed with creation
        }

        if (!itemConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_ITEM', status: 'PREVIEWING', targetType: 'ITEM', targetIds: [itemName], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_item',
            message: `This will create a new item "${itemName}" in category "${itemCategory}" (unit: ${unitOfMeasure})${itemStrain ? ' with strain "' + itemStrain + '"' : ''}. Please confirm.`,
            item: { name: itemName, itemCategory, unitOfMeasure, strain: itemStrain },
          });
        }

        try {
          await client.createItems([{
            Name: itemName,
            ItemCategory: itemCategory,
            UnitOfMeasure: unitOfMeasure,
            ...(itemStrain ? { Strain: itemStrain } : {}),
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_ITEM', status: 'COMPLETED', targetType: 'ITEM', targetIds: [itemName], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({
            success: true, action: 'create_item', name: itemName, itemCategory, unitOfMeasure, strain: itemStrain,
            note: 'Item created successfully in Metrc. It is now available in the catalog. If the user does not see it, advise them to refresh the page.',
          });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_ITEM', status: 'FAILED', targetType: 'ITEM', targetIds: [itemName], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_location_action': {
        const locationName = args.name as string;
        const locationTypeName = args.location_type_name as string;
        const locationConfirmed = args.confirmed === true;

        if (!locationName || !locationTypeName) {
          return JSON.stringify({ error: 'Missing required parameters: name, location_type_name' });
        }

        if (!locationConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_LOCATION', status: 'PREVIEWING', targetType: 'LOCATION', targetIds: [locationName], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_location',
            message: `This will create a new location "${locationName}" of type "${locationTypeName}". Please confirm.`,
            location: { name: locationName, locationTypeName },
          });
        }

        try {
          await client.createLocations([{
            Name: locationName,
            LocationTypeName: locationTypeName,
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_LOCATION', status: 'COMPLETED', targetType: 'LOCATION', targetIds: [locationName], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({
            success: true, action: 'create_location', name: locationName, locationTypeName,
            note: 'Location created successfully in Metrc. If the user does not see it, advise them to refresh the page.',
          });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_LOCATION', status: 'FAILED', targetType: 'LOCATION', targetIds: [locationName], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'change_plant_growth_phase_action': {
        const phaseBatchName = args.plant_batch_name as string;
        const phaseCount = args.count as number;
        const newGrowthPhase = args.new_growth_phase as string;
        const phaseNewLocation = args.new_location as string;
        const startingTag = (args.starting_tag as string) || '';
        const phaseConfirmed = args.confirmed === true;

        if (!phaseBatchName || phaseCount == null || !newGrowthPhase || !phaseNewLocation) {
          return JSON.stringify({ error: 'Missing required parameters: plant_batch_name, count, new_growth_phase, new_location' });
        }
        if (phaseCount <= 0) {
          return JSON.stringify({ error: 'Count must be a positive number' });
        }

        // Validate batch exists
        let phaseBatches: MetrcPlantBatch[] = [];
        try {
          phaseBatches = await client.getActivePlantBatches();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch active plant batches for validation' });
        }
        const matchedBatch = phaseBatches.find(b => b.Name.toLowerCase() === phaseBatchName.toLowerCase());
        if (!matchedBatch) {
          return JSON.stringify({ error: `Plant batch "${phaseBatchName}" not found among ${phaseBatches.length} active batches` });
        }
        if (phaseCount > matchedBatch.Count) {
          return JSON.stringify({ error: `Requested count (${phaseCount}) exceeds batch plant count (${matchedBatch.Count})` });
        }

        if (!phaseConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CHANGE_GROWTH_PHASE', status: 'PREVIEWING', targetType: 'PLANT_BATCH', targetIds: [phaseBatchName], targetCount: phaseCount });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'change_plant_growth_phase',
            message: `This will move ${phaseCount} plant(s) from batch "${phaseBatchName}" to ${newGrowthPhase} phase at location "${phaseNewLocation}"${startingTag ? ' starting at tag ' + startingTag : ''}. Please confirm.`,
            batch: { name: phaseBatchName, count: phaseCount, newGrowthPhase, newLocation: phaseNewLocation, startingTag },
          });
        }

        try {
          await client.changePlantBatchGrowthPhase([{
            Name: phaseBatchName,
            Count: phaseCount,
            GrowthPhase: newGrowthPhase,
            NewLocation: phaseNewLocation,
            GrowthDate: new Date().toISOString().split('T')[0],
            ...(startingTag ? { StartingTag: startingTag } : {}),
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CHANGE_GROWTH_PHASE', status: 'COMPLETED', targetType: 'PLANT_BATCH', targetIds: [phaseBatchName], targetCount: phaseCount, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'change_plant_growth_phase', batch: phaseBatchName, count: phaseCount, newGrowthPhase, newLocation: phaseNewLocation });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CHANGE_GROWTH_PHASE', status: 'FAILED', targetType: 'PLANT_BATCH', targetIds: [phaseBatchName], targetCount: phaseCount });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_incoming_transfer_action': {
        const shipperLicense = args.shipper_license as string;
        const transferLabels = args.package_labels as string[];
        const transferType = (args.transfer_type as string) || 'Affiliated Transfer';
        const transferConfirmed = args.confirmed === true;

        if (!shipperLicense || !transferLabels || transferLabels.length === 0) {
          return JSON.stringify({ error: 'Missing required parameters: shipper_license, package_labels' });
        }

        const { valid: validTransferLabels, invalid: invalidTransferLabels } = validateLabels(transferLabels, packages);
        if (validTransferLabels.length === 0) {
          return JSON.stringify({ error: 'None of the provided package labels match active packages', invalidLabels: invalidTransferLabels });
        }

        if (!transferConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_TRANSFER', status: 'PREVIEWING', targetType: 'TRANSFER', targetIds: validTransferLabels, targetCount: validTransferLabels.length });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_incoming_transfer',
            message: `This will create an incoming "${transferType}" from shipper license "${shipperLicense}" with ${validTransferLabels.length} package(s). Please confirm.`,
            transfer: { shipperLicense, transferType, packageCount: validTransferLabels.length, packages: validTransferLabels },
            ...(invalidTransferLabels.length > 0 ? { skippedInvalid: invalidTransferLabels } : {}),
          });
        }

        try {
          const now = new Date();
          const departure = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour
          const arrival = new Date(now.getTime() + 4 * 60 * 60 * 1000); // +4 hours
          await client.createExternalIncomingTransfers([{
            ShipperLicenseNumber: shipperLicense,
            TransferTypeName: transferType,
            EstimatedDepartureDateTime: departure.toISOString(),
            EstimatedArrivalDateTime: arrival.toISOString(),
            Packages: validTransferLabels.map(label => ({
              PackageLabel: label,
              WholesalePrice: null,
            })),
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_TRANSFER', status: 'COMPLETED', targetType: 'TRANSFER', targetIds: validTransferLabels, targetCount: validTransferLabels.length, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'create_incoming_transfer', shipperLicense, transferType, packageCount: validTransferLabels.length });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_TRANSFER', status: 'FAILED', targetType: 'TRANSFER', targetIds: validTransferLabels, targetCount: validTransferLabels.length });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'record_lab_test_action': {
        const labPackageLabelRaw = args.package_label as string;
        const labTestTypeName = args.test_type_name as string;
        const labOverallPassed = args.overall_passed as boolean;
        const labResults = (args.results as Array<{ test_type_name: string; value: number; passed: boolean }>) || [];
        const labConfirmed = args.confirmed === true;

        if (!labPackageLabelRaw || !labTestTypeName || labOverallPassed == null) {
          return JSON.stringify({ error: 'Missing required parameters: package_label, test_type_name, overall_passed' });
        }

        const labResolvedPkg = resolveLabel(labPackageLabelRaw, packages);
        if (!labResolvedPkg) {
          return JSON.stringify({ error: `Package "${labPackageLabelRaw}" not found in active packages` });
        }
        const labPackageLabel = labResolvedPkg.Label;

        if (!labConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_RECORD_LAB_TEST', status: 'PREVIEWING', targetType: 'PACKAGE', targetIds: [labPackageLabel], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'record_lab_test',
            message: `This will record a "${labTestTypeName}" lab test for package "${labPackageLabel}" — overall ${labOverallPassed ? 'PASSED' : 'FAILED'}${labResults.length > 0 ? ' with ' + labResults.length + ' sub-result(s)' : ''}. Please confirm.`,
            labTest: { packageLabel: labPackageLabel, testTypeName: labTestTypeName, overallPassed: labOverallPassed, resultCount: labResults.length },
          });
        }

        try {
          await client.recordLabTests([{
            Label: labPackageLabel,
            ResultDate: new Date().toISOString().split('T')[0],
            OverallPassed: labOverallPassed,
            TestTypeName: labTestTypeName,
            Results: labResults.map(r => ({
              TestTypeName: r.test_type_name,
              Value: r.value,
              Passed: r.passed,
            })),
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_RECORD_LAB_TEST', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: [labPackageLabel], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'record_lab_test', packageLabel: labPackageLabel, testTypeName: labTestTypeName, overallPassed: labOverallPassed });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_RECORD_LAB_TEST', status: 'FAILED', targetType: 'PACKAGE', targetIds: [labPackageLabel], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'create_processing_package_action': {
        const procTag = args.tag as string;
        const procItem = args.item as string;
        const procQuantity = args.quantity as number;
        const procUnit = args.unit_of_measure as string;
        const procSources = args.source_packages as Array<{ label: string; quantity: number; unit_of_measure: string }>;
        const procNote = (args.note as string) || '';
        const procConfirmed = args.confirmed === true;

        if (!procTag || !procItem || procQuantity == null || !procUnit || !procSources || procSources.length === 0) {
          return JSON.stringify({ error: 'Missing required parameters: tag, item, quantity, unit_of_measure, source_packages' });
        }
        if (procQuantity <= 0) {
          return JSON.stringify({ error: 'Quantity must be a positive number' });
        }

        // Validate source package labels
        const procSourceLabels = procSources.map(s => s.label);
        const { valid: validProcLabels, invalid: invalidProcLabels } = validateLabels(procSourceLabels, packages);
        if (validProcLabels.length === 0) {
          return JSON.stringify({ error: 'None of the source package labels match active packages', invalidLabels: invalidProcLabels });
        }
        // Rebuild sources with resolved labels
        const resolvedProcSources = procSources
          .filter(s => {
            const resolved = resolveLabel(s.label, packages);
            return resolved != null;
          })
          .map(s => {
            const resolved = resolveLabel(s.label, packages)!;
            return { ...s, label: resolved.Label };
          });

        if (!procConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PROCESSING_PKG', status: 'PREVIEWING', targetType: 'PACKAGE', targetIds: [procTag], targetCount: 1 });
          }
          return JSON.stringify({
            status: 'confirmation_required',
            action: 'create_processing_package',
            message: `This will create a new package (tag: ${procTag}) of "${procItem}" (${procQuantity} ${procUnit}) from ${resolvedProcSources.length} source package(s)${invalidProcLabels.length > 0 ? ' (' + invalidProcLabels.length + ' invalid label(s) skipped)' : ''}. Please confirm.`,
            package: { tag: procTag, item: procItem, quantity: procQuantity, unitOfMeasure: procUnit, sourceCount: resolvedProcSources.length, sources: resolvedProcSources },
            ...(invalidProcLabels.length > 0 ? { skippedInvalid: invalidProcLabels } : {}),
          });
        }

        try {
          await client.createProcessingPackages([{
            Tag: procTag,
            Item: procItem,
            Quantity: procQuantity,
            UnitOfMeasure: procUnit,
            Ingredients: resolvedProcSources.map(s => ({
              PackageLabel: s.label,
              Quantity: s.quantity,
              UnitOfMeasure: s.unit_of_measure,
            })),
            ActualDate: new Date().toISOString().split('T')[0],
            ...(procNote ? { Note: procNote } : {}),
          }]);
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PROCESSING_PKG', status: 'COMPLETED', targetType: 'PACKAGE', targetIds: [procTag], targetCount: 1, executedAt: new Date() });
          }
          return JSON.stringify({ success: true, action: 'create_processing_package', tag: procTag, item: procItem, quantity: procQuantity, unitOfMeasure: procUnit, sourceCount: resolvedProcSources.length });
        } catch (err) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({ facilityId: ctx.facilityId, userId: ctx.userId, actionType: 'COPILOT_CREATE_PROCESSING_PKG', status: 'FAILED', targetType: 'PACKAGE', targetIds: [procTag], targetCount: 1 });
          }
          return JSON.stringify({ error: 'Metrc API call failed: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'assess_testing_risk': {
        let labResults: MetrcLabTest[] = [];
        try {
          labResults = await client.getLabTestResults();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch lab test results. Lab test data may not be available for this facility.' });
        }

        const assessment = assessTestingRisk(labResults, packages);

        // Apply optional filters
        let filteredPackages = assessment.atRiskPackages;
        const strainFilter = args.strain as string | undefined;
        const riskFilter = args.risk_level as string | undefined;
        const limitVal = (args.limit as number) || 25;

        if (strainFilter) {
          const strainLower = strainFilter.toLowerCase();
          filteredPackages = filteredPackages.filter(
            (p: AtRiskPackage) => p.strain.toLowerCase().includes(strainLower),
          );
        }
        if (riskFilter) {
          const riskLower = riskFilter.toLowerCase();
          filteredPackages = filteredPackages.filter(
            (p: AtRiskPackage) => p.highestRisk === riskLower,
          );
        }

        // Also filter risksByStrainAndType when strain filter is active
        let filteredRisks = assessment.risksByStrainAndType;
        if (strainFilter) {
          const strainLower = strainFilter.toLowerCase();
          filteredRisks = filteredRisks.filter(
            (r: StrainTestRisk) => r.strain.toLowerCase().includes(strainLower),
          );
        }

        return truncateResults({
          summary: assessment.summary,
          warnings: assessment.warnings,
          risksByStrainAndType: filteredRisks.slice(0, 20),
          atRiskPackages: filteredPackages.slice(0, limitVal).map((p: AtRiskPackage) => ({
            packageLabel: p.packageLabel,
            itemName: p.itemName,
            strain: p.strain,
            category: p.category,
            quantity: p.quantity,
            unit: p.unit,
            labTestingState: p.labTestingState,
            highestRisk: p.highestRisk,
            ageDays: p.ageDays,
            riskSummary: p.risks.map((r: StrainTestRisk) => ({
              testType: r.testType,
              passRate: r.passRate,
              riskLevel: r.riskLevel,
              confidence: r.confidence,
            })),
          })),
          totalAtRiskPackages: filteredPackages.length,
        });
      }

      case 'get_potency_trends': {
        let labResults: MetrcLabTest[] = [];
        try {
          labResults = await client.getLabTestResults();
        } catch {
          return JSON.stringify({ error: 'Unable to fetch lab test results. Lab test data may not be available for this facility.' });
        }

        const trendResult = analyzePotencyTrends(labResults, packages, {
          strainFilter: args.strain as string | undefined,
          testTypeFilter: args.test_type as string | undefined,
          groupBy: (args.group_by as 'strain' | 'item') || 'strain',
        });

        const limitVal = (args.limit as number) || 15;

        return truncateResults({
          summary: trendResult.summary,
          warnings: trendResult.warnings,
          groups: trendResult.groups.slice(0, limitVal).map(g => ({
            displayName: g.displayName,
            testType: g.testType,
            sampleCount: g.sampleCount,
            mean: g.mean,
            stddev: g.stddev,
            cv: g.cv,
            min: g.min,
            max: g.max,
            resultUnit: g.resultUnit,
            driftStatus: g.driftStatus,
            driftMagnitude: g.driftMagnitude,
            recentMean: g.recentMean,
            consistencyRating: g.consistencyRating,
            consistencyRank: g.consistencyRank,
            // Include last 10 data points for trending context (not all — could be very large)
            recentDataPoints: g.dataPoints.slice(-10).map(dp => ({
              packageLabel: dp.packageLabel,
              date: dp.testPerformedDate,
              result: dp.resultLevel,
              unit: dp.resultUnit,
            })),
          })),
          outliers: trendResult.outliers.slice(0, 10).map(o => ({
            displayName: o.displayName,
            testType: o.testType,
            packageLabel: o.packageLabel,
            date: o.testPerformedDate,
            result: o.resultLevel,
            mean: o.mean,
            sigmaDistance: o.sigmaDistance,
          })),
        });
      }

      case 'compare_strains': {
        // Read from the module-level strain comparison cache, scoped to user's accessible facilities
        const validEntries = getStrainCacheForFacilities(ctx.accessibleFacilityIds ?? []);

        if (validEntries.length < 2) {
          return JSON.stringify({
            message: 'Cross-facility strain comparison data is not cached. Please navigate to the Strain Analysis page and expand the "Cross-Facility Comparison" section first, then try this tool again.',
            cachedFacilities: validEntries.length,
            requiredMinimum: 2,
          });
        }

        const comparison = compareAcrossFacilities(validEntries);

        // Filter by strainNames if provided
        const strainNameFilter = args.strainNames as string[] | undefined;
        if (strainNameFilter && strainNameFilter.length > 0) {
          const normalizedFilter = new Set(
            strainNameFilter.map(function (n: string) { return normalizeStrainName(n); }),
          );
          comparison.strains = comparison.strains.filter(function (s) {
            return normalizedFilter.has(s.normalizedName);
          });
          comparison.significantDifferences = comparison.significantDifferences.filter(function (d) {
            return normalizedFilter.has(normalizeStrainName(d.strainName));
          });
        }

        return truncateResults({
          facilityCount: comparison.facilities.length,
          facilities: comparison.facilities,
          strainCount: comparison.strains.length,
          strains: comparison.strains.slice(0, 20),
          significantDifferences: comparison.significantDifferences.slice(0, 15),
          warnings: comparison.warnings,
        }, 20);
      }

      // -----------------------------------------------------------------------
      // AUTO-DISCOUNT ENGINE TOOLS
      // -----------------------------------------------------------------------

      case 'get_auto_discount_dashboard_stats': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Auto-discount tools require facility context' });
        }
        try {
          const config = await ctx.prisma.autoDiscountConfig.findUnique({
            where: { facilityId: ctx.facilityId },
          });
          const recentRuns = await ctx.prisma.autoDiscountRun.findMany({
            where: { facilityId: ctx.facilityId },
            orderBy: { startedAt: 'desc' },
            take: 5,
          });
          const activeRun = recentRuns.find((r: { status: string }) => r.status === 'COMPLETED');
          return JSON.stringify({
            enabled: config?.isEnabled ?? false,
            maxDiscountPct: config?.maxDiscountPct ?? null,
            minScoreThreshold: config?.minScoreThreshold ?? null,
            recentRuns: recentRuns.map((r) => ({
              id: r.id,
              status: r.status,
              startedAt: r.startedAt,
              recommendationCount: r.recommendationCount,
              estimatedRevenueImpact: r.estimatedRevenueImpact,
            })),
            hasActiveDiscounts: !!activeRun,
            lastRunAt: recentRuns[0]?.startedAt ?? null,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch auto-discount stats: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'preview_auto_discounts': {
        if (!ctx.prisma || !ctx.facilityId || !ctx.facility) {
          return JSON.stringify({ error: 'Auto-discount preview requires facility context' });
        }
        try {
          const config = await ctx.prisma.autoDiscountConfig.findUnique({
            where: { facilityId: ctx.facilityId },
          });
          if (!config) {
            return JSON.stringify({ error: 'No auto-discount configuration found for this facility. Set it up in Inventory > Discounts > Auto Config.' });
          }
          const dutchieClient = getDutchieClient(ctx.facility as MetrcFacility);
          const packageProductMap = await buildPackageProductMap(dutchieClient);
          const configData: AutoDiscountConfigData = {
            maxDiscountPct: config.maxDiscountPct,
            minPriceFloor: config.minPriceFloor,
            minScoreThreshold: config.minScoreThreshold,
            priorityFilter: (config.priorityFilter as string[]) || [],
            discountTiers: (config.discountTiers as unknown as DiscountTier[]) || [],
            excludedProductIds: (config.excludedProductIds as string[]) || [],
            excludedCategories: (config.excludedCategories as string[]) || [],
            categoryMaxDiscountPct: config.categoryMaxDiscountPct as Record<string, number> | null | undefined,
          };
          const discountRules = ctx.rules ?? (DEFAULT_RULES as unknown as RuleDefinition[]);
          const recommendations = scorePackagesForDiscounts(discountRules, packages);
          const plan = computeAutoDiscountPlan(recommendations, packageProductMap, configData);
          return truncateResults({
            totalRecommendations: plan.totalRecommendations,
            estimatedRevenueImpact: plan.estimatedRevenueImpact,
            skipped: {
              noProduct: plan.skippedNoProduct,
              noPrice: plan.skippedNoPrice,
              excluded: plan.skippedExcluded,
              belowThreshold: plan.skippedBelowThreshold,
              priorityFilter: plan.skippedPriorityFilter,
            },
            topItems: plan.items.slice(0, 15).map(item => ({
              productName: item.productName,
              oldPrice: item.oldPrice,
              newPrice: item.newPrice,
              discountPct: item.discountPct,
              score: item.score,
              ageDays: item.ageDays,
              category: item.category,
            })),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to preview auto-discounts: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // CONSOLIDATED FINANCIAL TOOLS
      // -----------------------------------------------------------------------

      case 'get_consolidated_pnl': {
        if (!ctx.prisma) {
          return JSON.stringify({ error: 'Financial tools require database context' });
        }
        try {
          const orgFacilities = await getAccessibleOrgFacilities(ctx);
          const groupBy = args.group_by as string | undefined;

          // Aggregate OpEx data across facilities — single query, no N+1
          const allOpexModels = await ctx.prisma.opExModel.findMany({
            where: { facilityId: { in: orgFacilities.map(f => f.id) }, status: 'ACTIVE' },
          });
          const opexByFacility = new Map<string, { revenue: number; cost: number }>();
          for (const m of allOpexModels) {
            const existing = opexByFacility.get(m.facilityId) || { revenue: 0, cost: 0 };
            existing.revenue += m.annualRevenue ?? 0;
            existing.cost += m.annualCost ?? 0;
            opexByFacility.set(m.facilityId, existing);
          }

          // Fetch B2B revenue from Canix sales orders for facilities with Canix enabled
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const b2bByFacility = new Map<string, number>();
          const canixFacilities = orgFacilities.filter(
            f => f.canixEnvironment && f.canixEnvironment !== 'none',
          );
          // Bounded concurrency for Canix calls
          const CONCURRENCY = 5;
          for (let i = 0; i < canixFacilities.length; i += CONCURRENCY) {
            const batch = canixFacilities.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
              batch.map(async (f) => {
                const canixClient = getCanixClient(f);
                const orders = await canixClient.getSalesOrders();
                // Sum totals from non-cancelled, non-draft orders
                const completedStatuses = new Set(['confirmed', 'processing', 'shipped', 'delivered', 'invoiced']);
                const b2bRevenue = orders
                  .filter(o => completedStatuses.has(o.status))
                  .reduce((sum, o) => sum + o.total, 0);
                return { facilityId: f.id, b2bRevenue };
              }),
            );
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.b2bRevenue > 0) {
                b2bByFacility.set(result.value.facilityId, result.value.b2bRevenue);
              }
            }
          }

          const facilityFinancials: Array<{ facilityName: string; stateCode: string; facilityType: string | null; revenue: number; b2bRevenue: number; cost: number; grossMargin: number; grossProfit: number }> = [];

          for (const f of orgFacilities) {
            const opex = opexByFacility.get(f.id) || { revenue: 0, cost: 0 };
            const b2bRevenue = b2bByFacility.get(f.id) ?? 0;
            // B2B (Canix SO) and retail (OpEx/Dutchie) are separate channels. No overlap expected.
            const revenue = opex.revenue + b2bRevenue;
            const cost = opex.cost;
            const grossProfit = revenue - cost;
            const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
            facilityFinancials.push({
              facilityName: f.name,
              stateCode: f.stateCode,
              facilityType: f.facilityType,
              revenue: Math.round(revenue * 100) / 100,
              b2bRevenue: Math.round(b2bRevenue * 100) / 100,
              cost: Math.round(cost * 100) / 100,
              grossMargin: Math.round(grossMargin * 10) / 10,
              grossProfit: Math.round(grossProfit * 100) / 100,
            });
          }

          const totals = {
            revenue: facilityFinancials.reduce((s, f) => s + f.revenue, 0),
            cost: facilityFinancials.reduce((s, f) => s + f.cost, 0),
            grossProfit: facilityFinancials.reduce((s, f) => s + f.grossProfit, 0),
          };
          const totalMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;

          if (groupBy === 'state' || groupBy === 'facilityType') {
            const groups = new Map<string, typeof facilityFinancials>();
            for (const f of facilityFinancials) {
              const key = groupBy === 'state' ? f.stateCode : (f.facilityType || 'Unknown');
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(f);
            }
            const grouped = Array.from(groups.entries()).map(([key, facilities]) => ({
              group: key,
              facilityCount: facilities.length,
              revenue: facilities.reduce((s, f) => s + f.revenue, 0),
              cost: facilities.reduce((s, f) => s + f.cost, 0),
              grossProfit: facilities.reduce((s, f) => s + f.grossProfit, 0),
            }));
            return truncateResults({ totals: { ...totals, grossMargin: Math.round(totalMargin * 10) / 10 }, grouped, revenueNote: 'B2B wholesale revenue added to retail POS revenue — verify no channel overlap' });
          }

          return truncateResults({
            totals: { ...totals, grossMargin: Math.round(totalMargin * 10) / 10 },
            facilities: facilityFinancials,
            revenueNote: 'B2B wholesale revenue added to retail POS revenue — verify no channel overlap',
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch P&L: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_category_margins': {
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Category margins require facility context' });
        }
        try {
          const fac = ctx.facility as MetrcFacility;
          const days = Math.min(90, Math.max(1, (args.days as number) || 30));
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          const hasDutchie = fac.dutchieEnvironment && fac.dutchieEnvironment !== 'none';

          if (hasDutchie) {
            // Dutchie POS: use same calculation as dashboard (sales.ts:getCategoryMargins)
            const dutchieClient = getDutchieClient(fac);
            const { computeCategoryMargins } = await import('@/server/api/routers/sales');
            const [transactions, products] = await Promise.all([
              dutchieClient.getTransactions({ includeDetail: true }),
              dutchieClient.getReportingProducts(),
            ]);
            const result = computeCategoryMargins(transactions, products, cutoff);
            return truncateResults({ period: `Last ${days} days`, source: 'dutchie_pos', ...result });
          }

          // Fallback: Metrc RetailSale — aggregate in DB, not JS (1.3M+ rows)
          if (ctx.prisma && ctx.facilityId) {
            const catGroups = await ctx.prisma.retailSale.groupBy({
              by: ['productCategory'],
              where: { facilityId: ctx.facilityId, soldAt: { gte: cutoff } },
              _sum: { totalPrice: true, quantity: true },
            });
            if (catGroups.length > 0) {
              const categories = catGroups.map(g => ({
                category: g.productCategory || 'Other',
                revenue: Math.round(Number(g._sum.totalPrice ?? 0) * 100) / 100,
                unitsSold: Number(g._sum.quantity ?? 0),
                revenueShare: 0, // computed below
              })).sort((a, b) => b.revenue - a.revenue);
              const totalRevenue = categories.reduce((s, c) => s + c.revenue, 0);
              for (const c of categories) {
                c.revenueShare = totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 10000) / 100 : 0;
              }
              return truncateResults({
                period: `Last ${days} days`,
                source: 'metrc_sales',
                note: 'COGS/margin data unavailable without Dutchie POS. Showing revenue breakdown from Metrc sales receipts.',
                categories,
                totals: { revenue: Math.round(totalRevenue * 100) / 100 },
              });
            }
          }

          return JSON.stringify({ error: 'No sales data available. Connect Dutchie POS or import Metrc sales data.' });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch category margins: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // CANIX ERP / COGS TOOLS
      // -----------------------------------------------------------------------

      case 'get_package_cogs': {
        if (!ctx.facilityId) {
          return JSON.stringify({ error: 'COGS analysis requires facility context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const { resolvePackageCOGS, summarizeCOGS } = await import('@/services/engines/cogs-engine');
          const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
          const fac = ctx.facility as MetrcFacility;
          const metrcClient = getMetrcClient(fac);
          const canixClient = getCanixClient(fac);
          const dutchieClient = getDutchieClient(fac);

          const [activePackages, standardCosts, boms, deliveries] = await Promise.all([
            getActivePackagesWithFallback(ctx.prisma, ctx.facilityId, metrcClient),
            canixClient.getStandardCosts(),
            canixClient.getBillsOfMaterials(),
            dutchieClient.getDeliveries({
              includeLineItems: true,
              fromDateUTC: new Date(Date.now() - 90 * 86400000).toISOString(),
            }),
          ]);

          const DUTCHIE_MARGIN_ASSUMPTION = 0.5; // Approximate COGS from retail price
          const dutchieCosts: Array<{ metrcPackageLabel: string; unitCost: number; inferred: boolean }> = [];
          for (const delivery of deliveries) {
            for (const li of delivery.LineItems ?? []) {
              if (li.MetrcPackageLabel) {
                dutchieCosts.push({ metrcPackageLabel: li.MetrcPackageLabel, unitCost: li.Price * DUTCHIE_MARGIN_ASSUMPTION, inferred: true });
              }
            }
          }

          const packages = activePackages.map(pkg => ({
            label: pkg.Label,
            itemName: pkg.ItemName ?? '',
            quantity: pkg.Quantity,
            unitOfMeasure: pkg.UnitOfMeasureName,
            category: pkg.ItemCategory ?? '',
          }));

          const results = resolvePackageCOGS(packages, {
            standardCosts,
            boms,
            dutchieCosts,
            manualCosts: [],
          });

          const summary = summarizeCOGS(results);

          // Return top 20 by COGS descending + summary
          const topPackages = results
            .filter(r => r.source !== 'none')
            .sort((a, b) => b.totalCOGS - a.totalCOGS)
            .slice(0, 20)
            .map(r => ({
              label: r.packageLabel,
              item: r.itemName,
              costPerUnit: r.costPerUnit,
              totalCOGS: r.totalCOGS,
              qty: r.quantity,
              source: r.source,
              confidence: r.confidence,
              hasBOM: r.bomCostBreakdown !== null,
            }));

          return JSON.stringify({
            summary: {
              totalCOGS: summary.totalCOGS,
              resolved: summary.resolvedCount,
              unresolved: summary.unresolvedCount,
              avgConfidence: summary.averageConfidence,
              bySource: summary.bySource,
            },
            topPackages,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to compute COGS: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_procurement_status': {
        if (!ctx.facilityId) {
          return JSON.stringify({ error: 'Procurement status requires facility context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const fac = ctx.facility as MetrcFacility;
          const canixClient = getCanixClient(fac);
          const statusFilter = args.status as string | undefined;

          const allOrders = await canixClient.getPurchaseOrders();
          const openStatuses = ['draft', 'submitted', 'confirmed', 'in_transit'];
          const orders = statusFilter
            ? allOrders.filter(o => o.status === statusFilter)
            : allOrders.filter(o => openStatuses.includes(o.status));

          // Get contents for open/in-transit orders (bounded to 10)
          const ordersWithContents = await Promise.all(
            orders.slice(0, 10).map(async (order) => {
              const contents = await canixClient.getPurchaseOrderContents(order.id);
              return {
                poNumber: order.poNumber,
                vendor: order.vendorName,
                status: order.status,
                total: order.total,
                expectedDelivery: order.expectedDeliveryDate,
                lineItems: contents.map(li => ({
                  item: li.itemName,
                  qty: li.quantity,
                  unit: li.unit,
                  unitPrice: li.unitPrice,
                })),
              };
            })
          );

          const summary = {
            totalOpenPOs: orders.length,
            totalValue: orders.reduce((s, o) => s + o.total, 0),
            byStatus: orders.reduce((acc, o) => {
              acc[o.status] = (acc[o.status] ?? 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            inTransitCount: orders.filter(o => o.status === 'in_transit').length,
          };

          return JSON.stringify({ summary, orders: ordersWithContents });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch procurement status: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_bom_comparison': {
        if (!ctx.facilityId || !ctx.prisma) {
          return JSON.stringify({ error: 'BOM comparison requires facility and database context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const { validateBOMsAgainstInferred, inferBOMsFromActionLogs } = await import('@/services/engines/cogs-engine');
          const fac = ctx.facility as MetrcFacility;
          const canixClient = getCanixClient(fac);
          const canixBOMs = await canixClient.getBillsOfMaterials();

          if (canixBOMs.length === 0) {
            return JSON.stringify({ message: 'No Canix BOMs found for this facility. Connect Canix ERP to get authoritative Bills of Materials.' });
          }

          // Infer BOMs from processing history
          const logs = await ctx.prisma.actionLog.findMany({
            where: {
              facilityId: fac.id,
              actionType: 'PROCESSING_CREATE',
              status: 'COMPLETED',
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
          });

          const inferredBOMs = inferBOMsFromActionLogs(logs as Array<{ previewData: Record<string, unknown> | null }>);

          const deviations = validateBOMsAgainstInferred(canixBOMs, inferredBOMs);
          const criticalCount = deviations.filter(d => d.severity === 'critical').length;
          const warningCount = deviations.filter(d => d.severity === 'warning').length;

          return JSON.stringify({
            canixBOMCount: canixBOMs.length,
            inferredBOMCount: inferredBOMs.length,
            processLogsAnalyzed: logs.length,
            deviationSummary: {
              total: deviations.length,
              critical: criticalCount,
              warning: warningCount,
              info: deviations.length - criticalCount - warningCount,
            },
            deviations: deviations.slice(0, 15).map(d => ({
              output: d.outputItemName,
              component: d.componentName,
              canixRatio: Math.round(d.canixRatio * 100) / 100,
              inferredRatio: Math.round(d.inferredRatio * 100) / 100,
              deviation: `${d.deviationPercent}%`,
              severity: d.severity,
            })),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to compare BOMs: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // CANIX PHASE 2: AUDIT RECONCILIATION, VENDOR & CUSTOMER ANALYTICS
      // -----------------------------------------------------------------------

      case 'reconcile_audit_trail': {
        if (!ctx.facilityId || !ctx.prisma) {
          return JSON.stringify({ error: 'Audit reconciliation requires facility and database context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const { reconcileAuditTrails } = await import('@/services/engines/audit-reconciliation-engine');
          const fac = ctx.facility as MetrcFacility;
          const canixClient = getCanixClient(fac);
          const daysBack = Math.min(365, Math.max(1, (args.days_back as number) || 30));
          const cutoff = new Date(Date.now() - daysBack * 86400000);

          const [canixActions, actionLogs] = await Promise.all([
            canixClient.getAuditedActions({ limit: 500 }),
            ctx.prisma.actionLog.findMany({
              where: {
                facilityId: fac.id,
                createdAt: { gte: cutoff },
                status: 'COMPLETED',
              },
              orderBy: { createdAt: 'desc' },
              take: 500,
              select: {
                id: true,
                actionType: true,
                status: true,
                targetType: true,
                targetIds: true,
                targetCount: true,
                userId: true,
                createdAt: true,
                executedAt: true,
              },
            }),
          ]);

          const filteredCanixActions = canixActions.filter(
            a => new Date(a.performedAt) >= cutoff
          );

          const result = reconcileAuditTrails(
            filteredCanixActions,
            actionLogs.map(a => ({
              ...a,
              targetIds: a.targetIds as string[],
              createdAt: a.createdAt.toISOString(),
              executedAt: a.executedAt?.toISOString() ?? null,
            })),
          );

          const criticalBypasses = result.discrepancies.filter(d => d.type === 'bypass' && d.severity === 'critical');
          return JSON.stringify({
            summary: {
              totalCanixActions: result.totalCanixActions,
              totalPlatformActions: result.totalPlatformActions,
              matchedCount: result.matchedCount,
              matchRate: `${Math.round(result.matchRate * 100)}%`,
              period: `Last ${daysBack} days`,
            },
            byEntityType: result.byEntityType,
            criticalBypasses: criticalBypasses.length,
            discrepancies: result.discrepancies.slice(0, 20).map(d => ({
              type: d.type,
              severity: d.severity,
              entityType: d.entityType,
              entityId: d.entityId,
              description: d.description,
            })),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to reconcile audit trail: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_supplier_performance': {
        if (!ctx.facilityId) {
          return JSON.stringify({ error: 'Supplier performance requires facility context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const { computeVendorAnalytics } = await import('@/services/engines/vendor-analytics-engine');
          const fac = ctx.facility as MetrcFacility;
          const canixClient = getCanixClient(fac);

          const [vendors, purchaseOrders, items] = await Promise.all([
            canixClient.getVendors(),
            canixClient.getPurchaseOrders(),
            canixClient.getItems(),
          ]);

          // Fetch PO contents (bounded at 20)
          const poContents = new Map<string, import('@/services/canix/types').CanixLineItem[]>();
          const contentResults = await Promise.all(
            purchaseOrders.slice(0, 20).map(async (po) => {
              const contents = await canixClient.getPurchaseOrderContents(po.id);
              return { poId: po.id, contents };
            })
          );
          for (const { poId, contents } of contentResults) {
            poContents.set(poId, contents);
          }

          const result = computeVendorAnalytics(vendors, purchaseOrders, poContents, items);
          const vendorFilter = args.vendor_name as string | undefined;

          if (vendorFilter) {
            const filtered = result.vendors.filter(v =>
              v.vendorName.toLowerCase().includes(vendorFilter.toLowerCase())
            );
            if (filtered.length === 0) {
              return JSON.stringify({ message: `No vendors found matching "${vendorFilter}"`, totalVendors: result.vendors.length });
            }
            return JSON.stringify({ vendors: filtered, totalSpend: result.totalSpend });
          }

          return truncateResults({
            totalSpend: result.totalSpend,
            vendorCount: result.vendors.length,
            topVendors: result.vendors.slice(0, 10),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch supplier performance: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_customer_health': {
        if (!ctx.facilityId) {
          return JSON.stringify({ error: 'Customer health requires facility context' });
        }
        try {
          const { getCanixClient } = await import('@/services/canix/canix-factory');
          const { computeCustomerAnalytics } = await import('@/services/engines/customer-analytics-engine');
          const fac = ctx.facility as MetrcFacility;
          const canixClient = getCanixClient(fac);

          const [customers, salesOrders] = await Promise.all([
            canixClient.getCustomers(),
            canixClient.getSalesOrders(),
          ]);

          // Fetch SO contents (bounded at 20)
          const soContents = new Map<string, import('@/services/canix/types').CanixLineItem[]>();
          const contentResults = await Promise.all(
            salesOrders.slice(0, 20).map(async (so) => {
              const contents = await canixClient.getSalesOrderContents(so.id);
              return { soId: so.id, contents };
            })
          );
          for (const { soId, contents } of contentResults) {
            soContents.set(soId, contents);
          }

          const result = computeCustomerAnalytics(customers, salesOrders);
          const statusFilter = args.status_filter as string | undefined;

          if (statusFilter) {
            const filtered = result.customers.filter(c => c.status === statusFilter);
            return JSON.stringify({
              customerCount: filtered.length,
              customers: filtered.slice(0, 15),
              totalRevenue: result.totalRevenue,
              atRiskCount: result.atRiskCount,
            });
          }

          return truncateResults({
            totalRevenue: result.totalRevenue,
            customerCount: result.customers.length,
            atRiskCount: result.atRiskCount,
            customers: result.customers.slice(0, 15),
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch customer health: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // TOLLING RECONCILIATION
      // -----------------------------------------------------------------------

      case 'get_tolling_reconciliation': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Tolling reconciliation requires facility context' });
        }
        const agreementId = args.agreement_id as string;
        if (!agreementId) {
          return JSON.stringify({ error: 'Missing required parameter: agreement_id' });
        }
        try {
          const agreement = await ctx.prisma.tollingAgreement.findUnique({
            where: { id: agreementId },
            include: { batches: true },
          });
          if (!agreement) {
            return JSON.stringify({ error: `Tolling agreement "${agreementId}" not found` });
          }
          if (agreement.facilityId !== ctx.facilityId) {
            return JSON.stringify({ error: 'Agreement does not belong to the current facility' });
          }
          const statement = generateReconciliationStatement(
            {
              id: agreement.id,
              partnerName: agreement.partnerName,
              partnerLicense: agreement.partnerLicense,
              agreementType: agreement.agreementType,
              billingMode: agreement.billingMode,
              status: agreement.status,
              startDate: agreement.startDate.toISOString(),
              endDate: agreement.endDate?.toISOString() ?? null,
              yieldGuarantee: agreement.yieldGuarantee,
            },
            agreement.batches.map((b: { id: string; status: string; lifecycleStage: string; inputPackageIds: unknown; outputPackageIds: unknown; inputWeight: number | null; outputWeight: number | null; wasteWeight: number | null; wastePct: number | null; calculatedFees: unknown; totalFees: number | null; commencedAt: Date | null }) => ({
              id: b.id,
              status: b.status,
              lifecycleStage: b.lifecycleStage,
              inputPackageIds: (b.inputPackageIds as string[]) || [],
              outputPackageIds: (b.outputPackageIds as string[]) || [],
              inputWeight: b.inputWeight,
              outputWeight: b.outputWeight,
              wasteWeight: b.wasteWeight,
              wastePct: b.wastePct,
              calculatedFees: b.calculatedFees,
              totalFees: b.totalFees,
              commencedAt: b.commencedAt,
            })),
          );
          return truncateResults(statement);
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch tolling reconciliation: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // CROSS-FACILITY OPERATIONS TOOLS
      // -----------------------------------------------------------------------

      case 'get_operations_summary': {
        if (!ctx.prisma) {
          return JSON.stringify({ error: 'Operations summary requires database context' });
        }
        try {
          const orgFacilities = await getAccessibleOrgFacilities(ctx);

          let totalActivePackages = 0;
          let totalHarvests = 0;
          let totalTransfers = 0;
          const facilityMetrics: Array<{ name: string; stateCode: string; activePackages: number; harvests: number; transfers: number }> = [];

          const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
          for (let i = 0; i < orgFacilities.length; i += API_CONCURRENCY) {
            const batch = orgFacilities.slice(i, i + API_CONCURRENCY);
            const settled = await Promise.allSettled(
              batch.map(async (f) => {
                const facClient = getMetrcClient(f as MetrcFacility);
                const [pkgResult, harvestResult, transferResult] = await Promise.allSettled([
                  getActivePackagesWithFallback(ctx.prisma, f.id, facClient),
                  facClient.getActiveHarvests(),
                  facClient.getIncomingTransfers(),
                ]);
                return {
                  name: f.name,
                  stateCode: f.stateCode,
                  activePackages: pkgResult.status === 'fulfilled' ? pkgResult.value.length : 0,
                  harvests: harvestResult.status === 'fulfilled' ? harvestResult.value.length : 0,
                  transfers: transferResult.status === 'fulfilled' ? transferResult.value.length : 0,
                };
              })
            );
            for (const outcome of settled) {
              if (outcome.status === 'fulfilled') {
                const m = outcome.value;
                totalActivePackages += m.activePackages;
                totalHarvests += m.harvests;
                totalTransfers += m.transfers;
                facilityMetrics.push(m);
              }
              // Batch-level failures are rare — individual failures are caught by inner Promise.allSettled
            }
          }

          // Count open compliance alerts
          const alertCounts = await ctx.prisma!.complianceAlert.groupBy({
            by: ['facilityId'],
            where: { facilityId: { in: orgFacilities.map((f: { id: string }) => f.id) }, status: 'OPEN' },
            _count: true,
          });
          const totalAlerts = alertCounts.reduce((s: number, a: { _count: number }) => s + a._count, 0);

          return truncateResults({
            facilityCount: orgFacilities.length,
            totalActivePackages,
            totalActiveHarvests: totalHarvests,
            totalPendingTransfers: totalTransfers,
            totalOpenAlerts: totalAlerts,
            facilities: facilityMetrics,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch operations summary: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      case 'get_run_rate_comparison': {
        if (!ctx.prisma) {
          return JSON.stringify({ error: 'Run-rate comparison requires database context' });
        }
        try {
          const orgFacilities = await getAccessibleOrgFacilities(ctx);
          const categoryFilter = args.category as string | undefined;

          const facilityRunRates: Array<{ name: string; stateCode: string; categories: Array<{ category: string; currentInventory: number; weeksOfSupply: number | null; status: string }> }> = [];

          const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
          for (let i = 0; i < orgFacilities.length; i += API_CONCURRENCY) {
            const batch = orgFacilities.slice(i, i + API_CONCURRENCY);
            const settled = await Promise.allSettled(
              batch.map(async (f) => {
                const facClient = getMetrcClient(f as MetrcFacility);
                const facPackages = await getActivePackagesWithFallback(ctx.prisma, f.id, facClient);
                const facDutchieClient = getDutchieClient(f as MetrcFacility);
                const runRates = await computeRunRates(facPackages, facDutchieClient, { daysLookback: 30, metrcClient: facClient, prisma: ctx.prisma, facilityId: f.id });
                let categories = runRates.byCategory;
                if (categoryFilter) {
                  const filterLower = categoryFilter.toLowerCase();
                  categories = categories.filter((c) => c.category.toLowerCase().includes(filterLower));
                }
                return {
                  name: f.name,
                  stateCode: f.stateCode,
                  dataSource: runRates.dataSource,
                  categories: categories.slice(0, 10).map((c) => ({
                    category: c.category,
                    currentInventory: Math.round(c.currentInventory * 100) / 100,
                    weeksOfSupply: c.weeksOfSupply != null ? Math.round(c.weeksOfSupply * 10) / 10 : null,
                    status: c.status,
                  })),
                };
              })
            );
            for (const outcome of settled) {
              if (outcome.status === 'fulfilled') {
                facilityRunRates.push(outcome.value);
              }
              // Batch-level failures are rare — skip silently
            }
          }

          return truncateResults({
            facilityCount: facilityRunRates.length,
            categoryFilter: categoryFilter || 'all',
            facilities: facilityRunRates,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch run-rate comparison: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // CROSS-FACILITY INVENTORY SUMMARY
      // -----------------------------------------------------------------------

      case 'get_cross_facility_inventory_summary': {
        try {
          const orgFacilities = await getAccessibleOrgFacilities(ctx);
          const categoryFilter = args.category as string | undefined;

          interface FacilityInventory {
            name: string;
            stateCode: string;
            facilityType: string | null;
            totalQuantity: number;
            packageCount: number;
            categories: Array<{ category: string; quantity: number; unit: string; packageCount: number }>;
          }

          const facilityInventories: FacilityInventory[] = [];

          const { getMetrcClient } = await import('@/services/metrc/metrc-factory');
          for (let i = 0; i < orgFacilities.length; i += API_CONCURRENCY) {
            const batch = orgFacilities.slice(i, i + API_CONCURRENCY);
            const settled = await Promise.allSettled(
              batch.map(async (f) => {
                const facClient = getMetrcClient(f as MetrcFacility);
                const facPackages = await getActivePackagesWithFallback(ctx.prisma, f.id, facClient);

                // Aggregate by category
                const catMap = new Map<string, { qty: number; unit: string; count: number }>();
                for (const pkg of facPackages) {
                  if (pkg.Quantity <= 0) continue;
                  const rawCat = pkg.ItemCategory || 'Unknown';
                  if (categoryFilter && !rawCat.toLowerCase().includes(categoryFilter.toLowerCase())) continue;
                  const entry = catMap.get(rawCat);
                  if (entry) {
                    entry.qty += pkg.Quantity;
                    entry.count += 1;
                  } else {
                    catMap.set(rawCat, { qty: pkg.Quantity, unit: pkg.UnitOfMeasureName, count: 1 });
                  }
                }

                const categories = Array.from(catMap.entries())
                  .map(([category, data]) => ({
                    category,
                    quantity: Math.round(data.qty * 100) / 100,
                    unit: data.unit,
                    packageCount: data.count,
                  }))
                  .sort((a, b) => b.quantity - a.quantity);

                const totalQty = categories.reduce((sum, c) => sum + c.quantity, 0);
                const totalPkgs = categories.reduce((sum, c) => sum + c.packageCount, 0);

                return {
                  name: f.name,
                  stateCode: f.stateCode,
                  facilityType: f.facilityType,
                  totalQuantity: Math.round(totalQty * 100) / 100,
                  packageCount: totalPkgs,
                  categories,
                } as FacilityInventory;
              })
            );
            for (const outcome of settled) {
              if (outcome.status === 'fulfilled') {
                facilityInventories.push(outcome.value);
              }
            }
          }

          // Compute org-level totals by category
          const orgCatMap = new Map<string, { qty: number; unit: string; count: number }>();
          for (const fac of facilityInventories) {
            for (const cat of fac.categories) {
              const entry = orgCatMap.get(cat.category);
              if (entry) {
                entry.qty += cat.quantity;
                entry.count += cat.packageCount;
              } else {
                orgCatMap.set(cat.category, { qty: cat.quantity, unit: cat.unit, count: cat.packageCount });
              }
            }
          }

          const orgTotals = Array.from(orgCatMap.entries())
            .map(([category, data]) => ({
              category,
              totalQuantity: Math.round(data.qty * 100) / 100,
              unit: data.unit,
              totalPackages: data.count,
            }))
            .sort((a, b) => b.totalQuantity - a.totalQuantity);

          const grandTotalQty = orgTotals.reduce((sum, c) => sum + c.totalQuantity, 0);
          const grandTotalPkgs = orgTotals.reduce((sum, c) => sum + c.totalPackages, 0);

          return truncateResults({
            facilityCount: facilityInventories.length,
            categoryFilter: categoryFilter || 'all',
            grandTotalQuantity: Math.round(grandTotalQty * 100) / 100,
            grandTotalPackages: grandTotalPkgs,
            orgTotalsByCategory: orgTotals,
            facilities: facilityInventories,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch cross-facility inventory: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // AUDIT READINESS
      // -----------------------------------------------------------------------

      case 'get_audit_readiness_report': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Audit readiness requires facility context' });
        }
        try {
          let transfers: MetrcTransfer[] = [];
          try { transfers = await client.getIncomingTransfers(); } catch { /* non-critical */ }

          // Fetch action logs (last 30 days)
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const actionLogs = await ctx.prisma.actionLog.findMany({
            where: { facilityId: ctx.facilityId, executedAt: { gte: thirtyDaysAgo } },
            select: { id: true, actionType: true, status: true, targetType: true, targetCount: true, userId: true, createdAt: true, executedAt: true },
            orderBy: { executedAt: 'desc' },
            take: 100,
          });
          const actionLogSummaries: ActionLogSummary[] = actionLogs.map((a) => ({
            id: a.id,
            actionType: a.actionType,
            status: a.status,
            targetType: a.targetType,
            targetCount: a.targetCount,
            userId: a.userId,
            createdAt: a.createdAt.toISOString(),
            executedAt: a.executedAt?.toISOString() ?? null,
            errorMessage: null,
          }));

          // Fetch open alert count
          const openAlertCount = await ctx.prisma.complianceAlert.count({
            where: { facilityId: ctx.facilityId, status: 'OPEN' },
          });

          // Last reconciliation — null if no reconciliation data available
          const lastRecon: LastReconciliation | null = null;

          const report = generateAuditReadinessReport(
            packages,
            transfers,
            actionLogSummaries,
            lastRecon,
            openAlertCount,
          );

          return truncateResults({
            overallReadiness: report.overallReadiness,
            readinessLevel: report.readinessLevel,
            packageAudit: {
              overallScore: report.packageAudit.overallScore,
              categories: report.packageAudit.categories,
            },
            employeeScore: report.employeeScore,
            activityScore: report.activityScore,
            recentActions: report.recentActions,
            lastReconciliation: report.lastReconciliation,
            generatedAt: report.generatedAt,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to generate audit readiness report: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // DAILY SALES (POS)
      // -----------------------------------------------------------------------

      case 'get_daily_sales': {
        if (!ctx.facility) {
          return JSON.stringify({ error: 'Daily sales require facility context' });
        }
        try {
          const fac = ctx.facility as MetrcFacility;
          const days = Math.min(90, Math.max(1, (args.days as number) || 30));
          const fromDate = new Date(Date.now() - days * 86400000);
          const hasDutchie = fac.dutchieEnvironment && fac.dutchieEnvironment !== 'none';

          let dailySales: Array<{ date: string; revenue: number; orderCount: number; unitsSold: number; avgOrderValue: number; topCategory: string }> = [];
          let source = 'none';

          if (hasDutchie) {
            source = 'dutchie_pos';
            const dutchieClient = getDutchieClient(fac);
            const deliveries = await dutchieClient.getDeliveries({ includeLineItems: true, fromDateUTC: fromDate.toISOString() });
            // Dynamic import — sales.ts → copilot-tools.ts → ... → AppRouter forms a
            // type cycle that breaks tRPC inference for getDailySales when imported
            // statically. Plan AD1 allows dynamic fallback when a cycle is observed.
            const { computeDailySales } = await import('@/server/api/routers/sales');
            const points = computeDailySales(deliveries, { fromDate });
            const catsByDay = new Map<string, Map<string, number>>();
            for (const d of deliveries) {
              if (d.Status !== 'Completed' || !d.CompletedDate) continue;
              const day = new Date(d.CompletedDate).toISOString().slice(0, 10);
              let cats = catsByDay.get(day);
              if (!cats) {
                cats = new Map();
                catsByDay.set(day, cats);
              }
              for (const li of d.LineItems ?? []) {
                const cat = li.Category || 'Other';
                cats.set(cat, (cats.get(cat) || 0) + li.TotalPrice);
              }
            }
            dailySales = points.map(p => {
              const cats = catsByDay.get(p.date);
              const top = cats ? Array.from(cats.entries()).sort((a, b) => b[1] - a[1])[0] : undefined;
              return {
                ...p,
                avgOrderValue: p.orderCount > 0 ? Math.round((p.revenue / p.orderCount) * 100) / 100 : 0,
                topCategory: top?.[0] ?? 'N/A',
              };
            });
          } else if (ctx.prisma && ctx.facilityId) {
            // Fallback: Metrc — receipt summary table for facilities without Dutchie POS.
            const receipts = await ctx.prisma.retailSaleReceipt.findMany({
              where: { facilityId: ctx.facilityId, soldAt: { gte: fromDate } },
              select: { totalPrice: true, soldAt: true, lineItemCount: true },
            });
            if (receipts.length > 0) {
              source = 'metrc_sales';
              const dayMap = new Map<string, { revenue: number; orderCount: number; unitsSold: number }>();
              for (const r of receipts) {
                const day = r.soldAt.toISOString().slice(0, 10);
                const existing = dayMap.get(day) || { revenue: 0, orderCount: 0, unitsSold: 0 };
                existing.revenue += Number(r.totalPrice);
                existing.orderCount += 1;
                existing.unitsSold += r.lineItemCount;
                dayMap.set(day, existing);
              }
              dailySales = Array.from(dayMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, data]) => ({
                  date,
                  revenue: Math.round(data.revenue * 100) / 100,
                  orderCount: data.orderCount,
                  unitsSold: data.unitsSold,
                  avgOrderValue: data.orderCount > 0 ? Math.round((data.revenue / data.orderCount) * 100) / 100 : 0,
                  topCategory: 'N/A',
                }));
            }
          }

          if (dailySales.length === 0) {
            return JSON.stringify({ error: 'No sales data available. Connect Dutchie POS or import Metrc sales data.' });
          }

          const totalRevenue = dailySales.reduce((s, d) => s + d.revenue, 0);
          const totalOrders = dailySales.reduce((s, d) => s + d.orderCount, 0);

          return truncateResults({
            source,
            period: `Last ${days} days`,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalOrders,
            avgDailyRevenue: Math.round((totalRevenue / dailySales.length) * 100) / 100,
            days: dailySales,
          });
        } catch (err) {
          return JSON.stringify({ error: 'Failed to fetch daily sales: ' + (err instanceof Error ? err.message : String(err)) });
        }
      }

      // -----------------------------------------------------------------------
      // TOLLING BREAKEVEN ANALYSIS
      // -----------------------------------------------------------------------

      case 'find_tolling_breakeven': {
        const inputWeight = args.input_weight_grams as number;
        const revPerGram = args.revenue_per_gram as number;
        const partnerA = args.partner_a as { name: string; fees: Array<{ name: string; type: string; amount: number }> };
        const partnerB = args.partner_b as { name: string; fees: Array<{ name: string; type: string; amount: number }> };

        if (inputWeight == null || inputWeight <= 0 || revPerGram == null || revPerGram <= 0 || !partnerA || !partnerB) {
          return JSON.stringify({ error: 'Missing or invalid parameters: input_weight_grams and revenue_per_gram must be positive numbers, partner_a and partner_b are required' });
        }

        const feeTypeMap: Record<string, { feeType: 'PER_UNIT' | 'FLAT' | 'PERCENTAGE'; basis: 'input_weight' | 'output_weight' | 'fixed' | 'revenue' }> = {
          per_gram_input: { feeType: 'PER_UNIT', basis: 'input_weight' },
          per_gram_output: { feeType: 'PER_UNIT', basis: 'output_weight' },
          flat: { feeType: 'FLAT', basis: 'fixed' },
          percentage_revenue: { feeType: 'PERCENTAGE', basis: 'revenue' },
        };

        const mapFees = (fees: Array<{ name: string; type: string; amount: number }>): FeeDefinition[] =>
          fees.map(f => {
            const mapping = feeTypeMap[f.type] || { feeType: 'PER_UNIT' as const, basis: 'input_weight' as const };
            return { feeType: mapping.feeType, label: f.name, rate: f.amount, basis: mapping.basis };
          });

        // Check if costs actually diverge across yield range — if constant (both flat), no crossover exists
        const costAtLow = {
          a: calculateFees(mapFees(partnerA.fees), inputWeight, inputWeight * 0.01, inputWeight * 0.01 * revPerGram).totalFees,
          b: calculateFees(mapFees(partnerB.fees), inputWeight, inputWeight * 0.01, inputWeight * 0.01 * revPerGram).totalFees,
        };
        const costAtHigh = {
          a: calculateFees(mapFees(partnerA.fees), inputWeight, inputWeight, inputWeight * revPerGram).totalFees,
          b: calculateFees(mapFees(partnerB.fees), inputWeight, inputWeight, inputWeight * revPerGram).totalFees,
        };
        const diffAtLow = costAtLow.a - costAtLow.b;
        const diffAtHigh = costAtHigh.a - costAtHigh.b;

        // If the sign doesn't change across the range, no crossover exists
        if (diffAtLow * diffAtHigh > 0 && Math.abs(diffAtLow) > 0.01 && Math.abs(diffAtHigh) > 0.01) {
          const cheaperPartner = diffAtLow < 0 ? partnerA.name : partnerB.name;
          return JSON.stringify({
            breakevenYieldPct: null,
            message: `No breakeven point exists in the 1-100% yield range. ${cheaperPartner} is cheaper across all yield percentages.`,
            atYield1Pct: { partnerA: { name: partnerA.name, totalFees: costAtLow.a }, partnerB: { name: partnerB.name, totalFees: costAtLow.b } },
            atYield100Pct: { partnerA: { name: partnerA.name, totalFees: costAtHigh.a }, partnerB: { name: partnerB.name, totalFees: costAtHigh.b } },
          });
        }

        // Binary search for breakeven yield %
        let low = 1;
        let high = 100;
        let breakevenYield: number | null = null;

        for (let iter = 0; iter < 50; iter++) {
          const mid = (low + high) / 2;
          const outputWeight = inputWeight * (mid / 100);
          const totalRevenue = outputWeight * revPerGram;
          const costA = calculateFees(mapFees(partnerA.fees), inputWeight, outputWeight, totalRevenue).totalFees;
          const costB = calculateFees(mapFees(partnerB.fees), inputWeight, outputWeight, totalRevenue).totalFees;

          if (Math.abs(costA - costB) < 0.01) {
            breakevenYield = Math.round(mid * 100) / 100;
            break;
          }
          // Use the endpoints to determine search direction
          if ((costA - costB) * diffAtLow > 0) {
            // Same sign as low end — crossover is higher
            low = mid;
          } else {
            high = mid;
          }
        }

        if (!breakevenYield) breakevenYield = Math.round(((low + high) / 2) * 100) / 100;

        // Calculate costs at breakeven
        const beOutput = inputWeight * (breakevenYield / 100);
        const beRevenue = beOutput * revPerGram;
        const aCost = calculateFees(mapFees(partnerA.fees), inputWeight, beOutput, beRevenue);
        const bCost = calculateFees(mapFees(partnerB.fees), inputWeight, beOutput, beRevenue);

        return JSON.stringify({
          breakevenYieldPct: breakevenYield,
          inputWeightGrams: inputWeight,
          revenuePerGram: revPerGram,
          atBreakeven: {
            outputWeightGrams: Math.round(beOutput * 100) / 100,
            partnerA: { name: partnerA.name, totalFees: aCost.totalFees },
            partnerB: { name: partnerB.name, totalFees: bCost.totalFees },
          },
          interpretation: `At ${breakevenYield}% yield, both partners cost approximately the same ($${aCost.totalFees.toFixed(2)} vs $${bCost.totalFees.toFixed(2)}). Above this yield, check which partner's per-output fees give you the better deal.`,
        });
      }

      case 'get_disposition_summary': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Disposition summary requires a facility context.' });
        }
        const dispMonth = (args.month as string) || undefined;
        const now = new Date();
        const targetMonth = dispMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [yearStr, monthStr] = targetMonth.split('-');
        const year = parseInt(yearStr, 10);
        const mon = parseInt(monthStr, 10);

        const [dispPolicy, dispRecords] = await Promise.all([
          ctx.prisma.dispositionPolicy.findUnique({
            where: { facilityId: ctx.facilityId },
          }),
          ctx.prisma.dispositionRecord.findMany({
            where: {
              facilityId: ctx.facilityId,
              status: 'COMPLETED',
              createdAt: {
                gte: new Date(year, mon - 1, 1),
                lt: new Date(year, mon, 1),
              },
            },
          }),
        ]);

        const dispPolicyData = toPolicyData(dispPolicy);

        const dispRecordData: DispositionRecordData[] = dispRecords.map(r => ({
          category: r.category as DispositionCategory,
          quantity: r.quantity,
          estimatedValue: r.estimatedValue,
          createdAt: r.createdAt,
        }));

        const summary = buildDispositionSummary(dispRecordData, dispPolicyData, targetMonth);
        const alerts = checkDispositionBudgets(summary);

        return truncateResults({
          month: summary.month,
          totalUnits: summary.totalUnits,
          totalValue: summary.totalValue,
          totalCount: summary.totalCount,
          byCategory: summary.byCategory,
          budgets: summary.budgets.map(b => ({
            category: b.category,
            label: b.label,
            used: { units: b.monthlyUsage.units, value: b.monthlyUsage.value, count: b.monthlyUsage.count },
            limit: b.limit,
            remaining: { units: b.unitsRemaining, value: b.valueRemaining },
            utilization: { units: b.unitsFraction, value: b.valueFraction },
            status: b.status,
          })),
          alerts,
          policyEnabled: dispPolicyData.isEnabled,
        });
      }

      case 'log_disposition': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Disposition logging requires a facility context.' });
        }
        const label = args.package_label as string;
        const category = args.category as DispositionCategory;
        const quantity = args.quantity as number;
        const unitOfMeasure = args.unit_of_measure as string;
        const estimatedValue = (args.estimated_value as number) ?? 0;
        const recipientName = args.recipient_name as string | undefined;
        const note = args.note as string | undefined;
        const confirmed = args.confirmed as boolean;

        // Resolve label
        const resolvedPkg = resolveLabel(label, packages);
        if (!resolvedPkg) {
          return JSON.stringify({ error: `Package not found: ${label}. Use full package labels.` });
        }

        // Load policy
        const logPolicy = await ctx.prisma.dispositionPolicy.findUnique({
          where: { facilityId: ctx.facilityId },
        });
        const logPolicyData = toPolicyData(logPolicy);

        if (!logPolicyData.isEnabled) {
          return JSON.stringify({ error: 'Disposition tracking is disabled for this facility.' });
        }
        if (logPolicyData.requireNote && !note) {
          return JSON.stringify({ error: 'A note is required for dispositions at this facility.' });
        }

        // Get current month usage
        const logNow = new Date();
        const logMonth = `${logNow.getFullYear()}-${String(logNow.getMonth() + 1).padStart(2, '0')}`;
        const logRecords = await ctx.prisma.dispositionRecord.findMany({
          where: {
            facilityId: ctx.facilityId,
            status: 'COMPLETED',
            createdAt: {
              gte: new Date(logNow.getFullYear(), logNow.getMonth(), 1),
              lt: new Date(logNow.getFullYear(), logNow.getMonth() + 1, 1),
            },
          },
        });
        const logUsage = computeMonthlyUsage(
          logRecords.map(r => ({
            category: r.category as DispositionCategory,
            quantity: r.quantity,
            estimatedValue: r.estimatedValue,
            createdAt: r.createdAt,
          })),
          logMonth,
        );

        const logValidation = validateDisposition(category, quantity, estimatedValue, logUsage, logPolicyData);

        if (!confirmed) {
          // Preview
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({
              facilityId: ctx.facilityId,
              userId: ctx.userId,
              actionType: 'DISPOSITION',
              status: 'PREVIEWING',
              targetType: 'PACKAGE',
              targetIds: [resolvedPkg.Label],
              targetCount: 1,
            });
          }

          let previewMessage: string;
          if (logValidation.allowed) {
            previewMessage = `Ready to log ${quantity} ${unitOfMeasure} of ${resolvedPkg.Label} as ${DISPOSITION_CATEGORY_LABELS[category]}. Please confirm to proceed.`;
          } else if (logPolicyData.allowBudgetOverride) {
            previewMessage = `WARNING: ${logValidation.reason} Budget override is enabled — the disposition can still be logged if you confirm.`;
          } else {
            previewMessage = `BLOCKED: ${logValidation.reason} Budget override is not enabled for this facility.`;
          }

          return JSON.stringify({
            status: 'preview',
            packageLabel: resolvedPkg.Label,
            itemName: resolvedPkg.ItemName ?? 'Unknown',
            category,
            categoryLabel: DISPOSITION_CATEGORY_LABELS[category],
            quantity,
            unitOfMeasure,
            estimatedValue,
            recipientName,
            note,
            budgetAllowed: logValidation.allowed,
            budgetReason: logValidation.reason,
            message: previewMessage,
          });
        }

        // Execute — atomic transaction: re-check budget + create record + log
        if (!ctx.userId) {
          return JSON.stringify({ error: 'User context required to log dispositions.' });
        }

        const txResult = await ctx.prisma.$transaction(async (tx) => {
          // Re-read usage inside transaction for atomicity
          const txRecords = await tx.dispositionRecord.findMany({
            where: {
              facilityId: ctx.facilityId!,
              status: 'COMPLETED',
              createdAt: {
                gte: new Date(logNow.getFullYear(), logNow.getMonth(), 1),
                lt: new Date(logNow.getFullYear(), logNow.getMonth() + 1, 1),
              },
            },
          });

          const txUsage = computeMonthlyUsage(
            txRecords.map(r => ({
              category: r.category as DispositionCategory,
              quantity: r.quantity,
              estimatedValue: r.estimatedValue,
              createdAt: r.createdAt,
            })),
            logMonth,
          );

          const txValidation = validateDisposition(category, quantity, estimatedValue, txUsage, logPolicyData);

          if (!txValidation.allowed && !logPolicyData.allowBudgetOverride) {
            throw new Error(txValidation.reason ?? 'Budget limit exceeded and budget override is not enabled.');
          }

          const record = await tx.dispositionRecord.create({
            data: {
              facilityId: ctx.facilityId!,
              packageLabel: resolvedPkg.Label,
              category,
              quantity,
              unitOfMeasure,
              estimatedValue,
              recipientName: recipientName ?? null,
              note: note ?? null,
              status: 'COMPLETED',
              createdBy: ctx.userId!,
            },
          });

          await tx.actionLog.create({
            data: {
              facilityId: ctx.facilityId!,
              userId: ctx.userId!,
              actionType: 'DISPOSITION',
              status: 'COMPLETED',
              targetType: 'PACKAGE',
              targetIds: [resolvedPkg.Label],
              targetCount: 1,
              executedAt: new Date(),
              metadata: {
                category,
                quantity,
                estimatedValue,
                dispositionRecordId: record.id,
                budgetExceeded: !txValidation.allowed,
                budgetOverrideUsed: !txValidation.allowed && logPolicyData.allowBudgetOverride,
              },
            },
          });

          return { record, validation: txValidation };
        });

        return JSON.stringify({
          status: 'completed',
          message: `Logged ${quantity} ${unitOfMeasure} of ${resolvedPkg.Label} as ${DISPOSITION_CATEGORY_LABELS[category]}.`,
          recordId: txResult.record.id,
          budgetExceeded: !txResult.validation.allowed,
        });
      }

      case 'create_business_rule': {
        if (!ctx.prisma || !ctx.facilityId) {
          return JSON.stringify({ error: 'Rule creation requires a facility context.' });
        }

        // Enforce OPERATOR minimum — this is a write operation (ADR-010)
        if (ctx.prisma && ctx.userId && ctx.facilityId) {
          const grant = await ctx.prisma.facilityAccess.findFirst({
            where: { facilityId: ctx.facilityId, userId: ctx.userId },
            select: { role: true },
          });
          // No grant = implicit ADMIN (backward compat, see ADR-010)
          const role = grant?.role ?? 'ADMIN';
          if (role === 'VIEWER') {
            return JSON.stringify({ error: 'You need OPERATOR or ADMIN role to create business rules.' });
          }
        }

        const ruleName = args.name as string;
        const ruleDescription = args.description as string | undefined;
        const ruleCategory = args.category as string;
        const ruleSeverity = args.severity as string;
        const ruleActionType = args.action_type as string;
        const ruleConditions = args.conditions as { field: string; operator: string; value: unknown; item_category?: string }[];
        const ruleStateCode = args.state_code as string | undefined;
        const ruleConfirmed = args.confirmed as boolean;

        // Validate field names against known whitelist
        const VALID_FIELDS = new Set([
          'ageDays', 'Quantity', 'ItemCategory', 'ItemName', 'ItemStrainName',
          'LabTestingState', 'IsOnHold', 'IsTestingSample', 'IsTradesSample',
          'ProductRequiresRemediation', 'LocationName', 'PackageType',
          'PackagedDate', 'UnitOfMeasureName', 'ageCategory',
        ]);
        const VALID_OPERATORS = new Set([
          'gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in',
        ]);
        const VALID_CATEGORIES = new Set(['aging', 'inventory', 'compliance', 'operations', 'discount']);
        const VALID_SEVERITIES = new Set(['INFO', 'WARNING', 'CRITICAL']);
        const VALID_ACTION_TYPES = new Set([
          'ALERT', 'NOTIFICATION', 'BLOCK', 'DISCOUNT_RECOMMEND',
          'AUTO_DISCOUNT', 'PROMO_FLAG', 'CONSOLIDATE', 'SAMPLE_OUT',
        ]);

        if (!VALID_CATEGORIES.has(ruleCategory)) {
          return JSON.stringify({ error: `Invalid category "${ruleCategory}". Must be one of: ${Array.from(VALID_CATEGORIES).join(', ')}` });
        }
        if (!VALID_SEVERITIES.has(ruleSeverity)) {
          return JSON.stringify({ error: `Invalid severity "${ruleSeverity}". Must be one of: ${Array.from(VALID_SEVERITIES).join(', ')}` });
        }
        if (!VALID_ACTION_TYPES.has(ruleActionType)) {
          return JSON.stringify({ error: `Invalid action_type "${ruleActionType}". Must be one of: ${Array.from(VALID_ACTION_TYPES).join(', ')}` });
        }

        // Validate each condition
        for (const cond of ruleConditions) {
          if (!VALID_FIELDS.has(cond.field)) {
            return JSON.stringify({ error: `Invalid field "${cond.field}". Must be one of: ${Array.from(VALID_FIELDS).join(', ')}` });
          }
          if (!VALID_OPERATORS.has(cond.operator)) {
            return JSON.stringify({ error: `Invalid operator "${cond.operator}". Must be one of: ${Array.from(VALID_OPERATORS).join(', ')}` });
          }
        }

        if (ruleStateCode && (ruleStateCode.length !== 2 || !/^[A-Z]{2}$/.test(ruleStateCode))) {
          return JSON.stringify({ error: `Invalid state_code "${ruleStateCode}". Must be 2 uppercase letters (e.g., "CO", "MA").` });
        }

        // Build condition text for preview
        const conditionText = ruleConditions.map(c => {
          const catFilter = c.item_category ? ` [${c.item_category} only]` : '';
          return `${c.field} ${c.operator} ${JSON.stringify(c.value)}${catFilter}`;
        }).join(' AND ');

        const prismaConditions = ruleConditions.map(c => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
          ...(c.item_category ? { itemCategory: c.item_category } : {}),
        }));

        if (!ruleConfirmed) {
          // Preview mode
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({
              facilityId: ctx.facilityId,
              userId: ctx.userId,
              actionType: 'CREATE_BUSINESS_RULE',
              status: 'PREVIEWING',
              targetType: 'PACKAGE',
              targetIds: [],
              targetCount: 0,
            });
          }

          return JSON.stringify({
            status: 'preview',
            message: `Ready to create rule "${ruleName}".`,
            rule: {
              name: ruleName,
              description: ruleDescription || '(none)',
              category: ruleCategory,
              severity: ruleSeverity,
              actionType: ruleActionType,
              conditions: conditionText,
              stateCode: ruleStateCode || '(universal)',
            },
            confirm_instructions: 'Call create_business_rule again with confirmed=true to create this rule.',
          });
        }

        // Execute: create the rule
        const newRule = await ctx.prisma.businessRule.create({
          data: {
            facilityId: ctx.facilityId,
            name: ruleName,
            description: ruleDescription,
            category: ruleCategory,
            severity: ruleSeverity,
            conditions: prismaConditions as Prisma.InputJsonValue,
            actionType: ruleActionType,
            stateCode: ruleStateCode ?? null,
            isDefault: false,
            isActive: true,
          },
        });

        if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
          await ctx.createActionLog({
            facilityId: ctx.facilityId,
            userId: ctx.userId,
            actionType: 'CREATE_BUSINESS_RULE',
            status: 'COMPLETED',
            targetType: 'PACKAGE',
            targetIds: [newRule.id],
            targetCount: 1,
            executedAt: new Date(),
          });
        }

        return JSON.stringify({
          status: 'completed',
          message: `Created business rule "${ruleName}" (${ruleCategory}, ${ruleSeverity}).`,
          ruleId: newRule.id,
        });
      }

      case 'get_pipeline_summary': {
        if (!ctx.client) return JSON.stringify({ error: 'Pipeline summary requires a facility context.' });
        const [pipelineData, pipelineOverrides] = await Promise.all([
          buildCopilotPipelineData(ctx.client, ctx.prisma, ctx.facilityId),
          loadCopilotPipelineOverrides(ctx),
        ]);
        const { overview } = computeFullPipeline(pipelineData, pipelineOverrides);

        return truncateResults({
          stages: overview.stages.filter(s => s.packageCount > 0).map(s => ({
            stage: PIPELINE_STAGE_LABELS[s.stage],
            packageCount: s.packageCount,
            quantities: s.quantities,
            avgAgeDays: s.avgAgeDays,
          })),
          totalActivePackages: overview.totalActivePackages,
          totalWeight: overview.totalWeight,
          harvestIntake: overview.harvestIntake,
          conversionRate: overview.conversionRate,
          customPipelineEnabled: !!pipelineOverrides,
        });
      }

      case 'get_harvest_cash_tracker': {
        if (!ctx.client) return JSON.stringify({ error: 'Harvest tracking requires a facility context.' });
        const [htData, htOverrides] = await Promise.all([
          buildCopilotPipelineData(ctx.client, ctx.prisma, ctx.facilityId),
          loadCopilotPipelineOverrides(ctx),
        ]);
        const specificHarvest = args.harvest_name as string | undefined;

        if (specificHarvest) {
          const harvest = htData.harvests.find((h: MetrcHarvest) => h.Name === specificHarvest);
          const tracker = traceHarvestToCash(specificHarvest, harvest, htData, htOverrides);
          return truncateResults(tracker);
        }

        const { harvests: trackers } = computeFullPipeline(htData, htOverrides);
        trackers.sort((a, b) => a.percentSold - b.percentSold);

        return truncateResults({
          total: trackers.length,
          harvests: trackers.slice(0, 20).map(h => ({
            harvestName: h.harvestName,
            strain: h.strain,
            harvestWeight: h.harvestWeight,
            percentSold: h.percentSold,
            revenueSoFar: h.revenueSoFar,
            weightRemaining: h.weightRemaining,
            avgDaysToSale: h.avgDaysToSale,
          })),
        });
      }

      case 'get_waste_analysis': {
        if (!ctx.client || !ctx.facility) {
          return JSON.stringify({ error: 'Waste analysis requires a facility context.' });
        }
        const wasteDays = (args.days as number) ?? 90;
        const wasteGranularity = (args.granularity as 'day' | 'week' | 'month') ?? 'week';
        const wasteFacility = ctx.facility as MetrcFacility;

        const [wasteAllHarvests, wasteBatchWaste] = await Promise.all([
          Promise.all([
            ctx.client.getActiveHarvests(),
            ctx.client.getInactiveHarvests(),
          ]).then(([active, inactive]) => [...active, ...inactive]),
          ctx.client.getPlantBatchWaste(wasteFacility.licenseNumber),
        ]);

        const wasteHarvestRecords = await Promise.all(
          wasteAllHarvests.map(h => ctx.client!.getHarvestWaste(h.Id).catch(() => []))
        );
        const wasteHarvestNames = new Map(wasteAllHarvests.map(h => [h.Id, h.Name]));
        const wasteTotalPackaged = wasteAllHarvests.reduce((sum, h) => sum + h.TotalPackagedWeight, 0);

        const wasteSources = aggregateWasteSources({
          harvestWaste: wasteHarvestRecords.flat(),
          harvestNames: wasteHarvestNames,
          plantBatchWaste: wasteBatchWaste,
        });

        return truncateResults(computeWasteAnalysis(wasteSources, wasteTotalPackaged, wasteDays, wasteGranularity));
      }

      case 'record_plant_batch_waste': {
        if (!ctx.client || !ctx.facility || !ctx.facilityId) {
          return JSON.stringify({ error: 'Recording plant batch waste requires a facility context.' });
        }
        const rbwBatchId = args.plant_batch_id as number;
        const rbwBatchName = args.plant_batch_name as string;
        const rbwReason = args.waste_reason_name as string;
        const rbwWeight = args.waste_weight as number;
        const rbwUnit = (args.unit_of_weight as string) ?? 'Grams';
        const rbwDate = args.actual_date as string;
        const rbwConfirmed = args.confirmed as boolean;

        if (!rbwConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({
              facilityId: ctx.facilityId,
              userId: ctx.userId,
              actionType: 'PLANTBATCH_WASTE',
              status: 'PREVIEWING',
              targetType: 'PLANT_BATCH',
              targetIds: [String(rbwBatchId)],
              targetCount: 1,
            });
          }
          return JSON.stringify({
            status: 'preview',
            message: `Ready to record ${rbwWeight} ${rbwUnit} of waste for batch "${rbwBatchName}" (reason: ${rbwReason}, date: ${rbwDate}). Please confirm to proceed.`,
            preview: { plantBatchId: rbwBatchId, plantBatchName: rbwBatchName, wasteReasonName: rbwReason, wasteWeight: rbwWeight, unitOfWeight: rbwUnit, actualDate: rbwDate },
          });
        }

        const rbwFacility = ctx.facility as MetrcFacility;
        await ctx.client.recordPlantBatchWaste(rbwFacility.licenseNumber, [{
          PlantBatchId: rbwBatchId,
          PlantBatchName: rbwBatchName,
          WasteReasonName: rbwReason,
          WasteWeight: rbwWeight,
          UnitOfWeightName: rbwUnit,
          ActualDate: rbwDate,
        }]);

        if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
          await ctx.createActionLog({
            facilityId: ctx.facilityId,
            userId: ctx.userId,
            actionType: 'PLANTBATCH_WASTE',
            status: 'COMPLETED',
            targetType: 'PLANT_BATCH',
            targetIds: [String(rbwBatchId)],
            targetCount: 1,
            executedAt: new Date(),
          });
        }

        return JSON.stringify({
          status: 'completed',
          message: `Recorded ${rbwWeight} ${rbwUnit} of waste for batch "${rbwBatchName}".`,
        });
      }

      case 'destroy_plants_action': {
        if (!ctx.client || !ctx.facility || !ctx.facilityId) {
          return JSON.stringify({ error: 'Destroying plants requires a facility context.' });
        }
        const dpPlantIds = args.plant_ids as number[];
        const dpMethod = args.waste_method_name as string;
        const dpReason = args.reason_note as string;
        const dpDate = args.actual_date as string;
        const dpConfirmed = args.confirmed as boolean;

        if (!dpConfirmed) {
          if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
            await ctx.createActionLog({
              facilityId: ctx.facilityId,
              userId: ctx.userId,
              actionType: 'PLANT_DESTROY',
              status: 'PREVIEWING',
              targetType: 'PLANT',
              targetIds: dpPlantIds.map(String),
              targetCount: dpPlantIds.length,
            });
          }
          return JSON.stringify({
            status: 'preview',
            message: `Ready to destroy ${dpPlantIds.length} plant(s) using method "${dpMethod}" (reason: ${dpReason}, date: ${dpDate}). Please confirm to proceed.`,
            preview: { plantIds: dpPlantIds, wasteMethodName: dpMethod, reasonNote: dpReason, actualDate: dpDate },
          });
        }

        const dpFacility = ctx.facility as MetrcFacility;
        await ctx.client.destroyPlants(dpFacility.licenseNumber, dpPlantIds.map(id => ({
          Id: id,
          WasteMethodName: dpMethod,
          ReasonNote: dpReason,
          ActualDate: dpDate,
        })));

        if (ctx.createActionLog && ctx.facilityId && ctx.userId) {
          await ctx.createActionLog({
            facilityId: ctx.facilityId,
            userId: ctx.userId,
            actionType: 'PLANT_DESTROY',
            status: 'COMPLETED',
            targetType: 'PLANT',
            targetIds: dpPlantIds.map(String),
            targetCount: dpPlantIds.length,
            executedAt: new Date(),
          });
        }

        return JSON.stringify({
          status: 'completed',
          message: `Destroyed ${dpPlantIds.length} plant(s) using method "${dpMethod}".`,
        });
      }

      // -------------------------------------------------------------------
      // Financial Overlays (Q1, Q21, Q27 — progressive enrichment)
      // -------------------------------------------------------------------

      case 'get_inventory_valuation': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Inventory valuation requires facility context' });
        try {
          const { computeInventoryValuation } = await import('@/services/engines/financial-overlay-engine');
          const { computeDataFidelity } = await import('@/services/engines/data-fidelity');
          const fac = ctx.facility as MetrcFacility;
          const fidelity = computeDataFidelity(fac);

          // Always get packages (operational core)
          let cogsResults = null;

          // Conditionally load COGS data if any financial source is available
          if (fidelity.hasFinancialData) {
            try {
              const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
              const { getCanixClient } = await import('@/services/canix/canix-factory');
              const { getDutchieClient } = await import('@/services/dutchie/dutchie-factory');
              const canixClient = getCanixClient(fac);
              const dutchieClient = getDutchieClient(fac);

              const [standardCosts, boms, deliveries] = await Promise.all([
                canixClient.getStandardCosts(),
                canixClient.getBillsOfMaterials(),
                dutchieClient.getDeliveries({ fromDateUTC: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() }),
              ]);

              // Build Dutchie cost entries from deliveries
              const dutchieCosts: Array<{ metrcPackageLabel: string; unitCost: number }> = [];
              for (const d of deliveries) {
                for (const li of d.LineItems ?? []) {
                  if (li.MetrcPackageLabel && li.Price > 0) {
                    dutchieCosts.push({
                      metrcPackageLabel: li.MetrcPackageLabel,
                      unitCost: li.Price / Math.max(li.Quantity, 1),
                    });
                  }
                }
              }

              // Map MetrcPackage to PackageForCOGS
              const packagesForCOGS = packages.map(p => ({
                label: p.Label,
                itemName: p.ItemName,
                quantity: p.Quantity,
                unitOfMeasure: p.UnitOfMeasureName,
                category: p.ItemCategory || 'Unknown',
              }));

              cogsResults = resolvePackageCOGS(packagesForCOGS, {
                standardCosts,
                boms,
                dutchieCosts,
                manualCosts: [],
              });
            } catch {
              // Financial data unavailable — degrade gracefully
              cogsResults = null;
            }
          }

          const result = computeInventoryValuation(packages, cogsResults);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Inventory valuation failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_pipeline_valuation': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Pipeline valuation requires facility context' });
        try {
          const { computePipelineValuation } = await import('@/services/engines/financial-overlay-engine');
          const { computeDataFidelity } = await import('@/services/engines/data-fidelity');
          const fac = ctx.facility as MetrcFacility;
          const fidelity = computeDataFidelity(fac);

          // Build pipeline stage data from packages
          const stageMap = new Map<string, { count: number; weight: number; totalAge: number; labels: string[] }>();

          for (const pkg of packages) {
            // Infer stage from package metadata (simplified version of pipeline-stage-engine)
            let stage = 'inventory';
            const labState = pkg.LabTestingState || '';
            const cat = (pkg.ItemCategory || '').toLowerCase();

            if (['notsubmitted', 'submittedfortesting', 'awaitingconfirmation'].includes(labState.toLowerCase())) {
              stage = 'testing';
            } else if (cat.includes('waste') || cat.includes('trim') || cat.includes('biomass') || cat.includes('whole plant')) {
              stage = 'post_harvest';
            } else if (labState.toLowerCase() === 'testpassed') {
              stage = 'retail_ready';
            } else {
              stage = 'inventory';
            }

            const existing = stageMap.get(stage);
            const age = Math.floor((Date.now() - new Date(pkg.PackagedDate).getTime()) / (1000 * 60 * 60 * 24));

            if (existing) {
              existing.count++;
              existing.weight += pkg.Quantity ?? 0;
              existing.totalAge += age;
              existing.labels.push(pkg.Label);
            } else {
              stageMap.set(stage, { count: 1, weight: pkg.Quantity ?? 0, totalAge: age, labels: [pkg.Label] });
            }
          }

          const stageData: Array<{ stage: string; packageCount: number; totalWeight: number; avgAgeDays: number; packageLabels: string[] }> = [];
          stageMap.forEach((data, stage) => {
            stageData.push({
              stage,
              packageCount: data.count,
              totalWeight: data.weight,
              avgAgeDays: data.count > 0 ? Math.round(data.totalAge / data.count) : 0,
              packageLabels: data.labels,
            });
          });

          // Conditionally load COGS
          let cogsResults = null;
          if (fidelity.hasFinancialData) {
            try {
              const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
              const { getCanixClient } = await import('@/services/canix/canix-factory');
              const canixClient = getCanixClient(fac);

              const [standardCosts, boms] = await Promise.all([
                canixClient.getStandardCosts(),
                canixClient.getBillsOfMaterials(),
              ]);

              const pkgsForCOGS = packages.map(p => ({
                label: p.Label, itemName: p.ItemName, quantity: p.Quantity,
                unitOfMeasure: p.UnitOfMeasureName, category: p.ItemCategory || 'Unknown',
              }));
              cogsResults = resolvePackageCOGS(pkgsForCOGS, {
                standardCosts,
                boms,
                dutchieCosts: [],
                manualCosts: [],
              });
            } catch {
              cogsResults = null;
            }
          }

          const result = computePipelineValuation(stageData, cogsResults);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Pipeline valuation failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_loss_analysis': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Loss analysis requires facility context' });
        try {
          const { computeLossAnalysis } = await import('@/services/engines/financial-overlay-engine');
          const { computeDataFidelity } = await import('@/services/engines/data-fidelity');
          const fac = ctx.facility as MetrcFacility;
          const fidelity = computeDataFidelity(fac);

          const inactiveHarvests = await client.getInactiveHarvests();

          // Conditionally load COGS
          let cogsResults = null;
          if (fidelity.hasFinancialData) {
            try {
              const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
              const { getCanixClient } = await import('@/services/canix/canix-factory');
              const canixClient = getCanixClient(fac);

              const [standardCosts, boms] = await Promise.all([
                canixClient.getStandardCosts(),
                canixClient.getBillsOfMaterials(),
              ]);

              const pkgsForCOGS = packages.map(p => ({
                label: p.Label, itemName: p.ItemName, quantity: p.Quantity,
                unitOfMeasure: p.UnitOfMeasureName, category: p.ItemCategory || 'Unknown',
              }));
              cogsResults = resolvePackageCOGS(pkgsForCOGS, {
                standardCosts,
                boms,
                dutchieCosts: [],
                manualCosts: [],
              });
            } catch {
              cogsResults = null;
            }
          }

          const result = computeLossAnalysis(packages, inactiveHarvests, cogsResults);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Loss analysis failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_expiring_material': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Expiring material analysis requires facility context' });
        try {
          const { computeExpiringMaterial } = await import('@/services/engines/financial-overlay-engine');
          const { computeDataFidelity } = await import('@/services/engines/data-fidelity');
          const fac = ctx.facility as MetrcFacility;
          const fidelity = computeDataFidelity(fac);

          let cogsResults = null;
          if (fidelity.hasFinancialData) {
            try {
              const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
              const { getCanixClient } = await import('@/services/canix/canix-factory');
              const canixClient = getCanixClient(fac);
              const [standardCosts, boms] = await Promise.all([
                canixClient.getStandardCosts(),
                canixClient.getBillsOfMaterials(),
              ]);
              const pkgsForCOGS = packages.map(p => ({
                label: p.Label, itemName: p.ItemName, quantity: p.Quantity,
                unitOfMeasure: p.UnitOfMeasureName, category: p.ItemCategory || 'Unknown',
              }));
              cogsResults = resolvePackageCOGS(pkgsForCOGS, { standardCosts, boms, dutchieCosts: [], manualCosts: [] });
            } catch { cogsResults = null; }
          }

          const result = computeExpiringMaterial(
            packages, cogsResults,
            { thresholdDays: typeof args.threshold_days === 'number' ? args.threshold_days : 45 },
          );
          return JSON.stringify({
            ...result,
            atRisk: result.atRisk.slice(0, 20), // Limit for Copilot response
          });
        } catch (err) {
          return JSON.stringify({ error: `Expiring material analysis failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_transfer_loss': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Transfer loss analysis requires facility context' });
        try {
          const { computeTransferLoss } = await import('@/services/engines/financial-overlay-engine');
          const { computeDataFidelity } = await import('@/services/engines/data-fidelity');
          const fac = ctx.facility as MetrcFacility;
          const fidelity = computeDataFidelity(fac);

          const inactiveHarvests = await client.getInactiveHarvests();

          let cogsResults = null;
          if (fidelity.hasFinancialData) {
            try {
              const { resolvePackageCOGS } = await import('@/services/engines/cogs-engine');
              const { getCanixClient } = await import('@/services/canix/canix-factory');
              const canixClient = getCanixClient(fac);
              const [standardCosts, boms] = await Promise.all([
                canixClient.getStandardCosts(),
                canixClient.getBillsOfMaterials(),
              ]);
              const pkgsForCOGS = packages.map(p => ({
                label: p.Label, itemName: p.ItemName, quantity: p.Quantity,
                unitOfMeasure: p.UnitOfMeasureName, category: p.ItemCategory || 'Unknown',
              }));
              cogsResults = resolvePackageCOGS(pkgsForCOGS, { standardCosts, boms, dutchieCosts: [], manualCosts: [] });
            } catch { cogsResults = null; }
          }

          const result = computeTransferLoss(inactiveHarvests, packages, cogsResults);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Transfer loss analysis failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      // -------------------------------------------------------------------
      // Operational Intelligence (Q16, Q17, Q19, Q26)
      // -------------------------------------------------------------------

      case 'get_harvest_forecast': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Harvest forecast requires facility context' });
        try {
          const { computeHarvestForecast } = await import('@/services/engines/operational-intelligence-engine');

          const [activeBatches, inactiveHarvests] = await Promise.all([
            client.getActivePlantBatches(),
            client.getInactiveHarvests(),
          ]);

          const result = computeHarvestForecast(
            activeBatches,
            inactiveHarvests,
            activeBatches,
            { windowDays: typeof args.window_days === 'number' ? args.window_days : 14 },
          );

          return JSON.stringify({
            forecastWindow: `${result.windowDays} days`,
            upcomingCount: result.upcoming.length,
            totalFloweringBatches: result.allFlowering.length,
            upcoming: result.upcoming.slice(0, 10),
            strainsWithoutHistory: result.strainsWithoutHistory,
          });
        } catch (err) {
          return JSON.stringify({ error: `Harvest forecast failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_cycle_time_analysis': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Cycle time analysis requires facility context' });
        try {
          const { computeCycleTime } = await import('@/services/engines/operational-intelligence-engine');

          const [inactiveHarvests, inactiveBatches, activeBatches] = await Promise.all([
            client.getInactiveHarvests(),
            client.getInactivePlantBatches(),
            client.getActivePlantBatches(),
          ]);

          const allBatches = [...inactiveBatches, ...activeBatches];
          const result = computeCycleTime(inactiveHarvests, allBatches);

          return JSON.stringify({
            overallAvgDays: result.overallAvgDays,
            strainCount: result.strains.length,
            strains: result.strains.slice(0, 15),
            worseningStrains: result.worseningStrains,
          });
        } catch (err) {
          return JSON.stringify({ error: `Cycle time analysis failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_throughput_analysis': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Throughput analysis requires facility context' });
        try {
          const { computeThroughputAnalysis } = await import('@/services/engines/operational-intelligence-engine');

          const [inactiveHarvests, activePackages] = await Promise.all([
            client.getInactiveHarvests(),
            getActivePackagesWithFallback(ctx.prisma, ctx.facilityId, client),
          ]);

          const result = computeThroughputAnalysis(
            inactiveHarvests,
            activePackages,
            { windowDays: typeof args.window_days === 'number' ? args.window_days : 60 },
          );

          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Throughput analysis failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      case 'get_plant_compliance': {
        if (!ctx.facilityId || !ctx.client) return JSON.stringify({ error: 'Plant compliance requires facility context' });
        try {
          const { computePlantCompliance } = await import('@/services/engines/operational-intelligence-engine');

          const [plants, batches] = await Promise.all([
            client.getActivePlants(),
            client.getActivePlantBatches(),
          ]);

          const result = computePlantCompliance(
            plants,
            batches,
            { plantLimit: typeof args.plant_limit === 'number' ? args.plant_limit : undefined },
          );

          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({ error: `Plant compliance check failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      // -----------------------------------------------------------------------
      // KNOWLEDGE BASE (multiagent bridge)
      // -----------------------------------------------------------------------

      case 'ask_knowledge_base': {
        try {
          const question = args.question as string;
          const state = args.state as string | undefined;
          const multiagentUrl = process.env.MULTIAGENT_API_URL;
          if (!multiagentUrl) {
            return JSON.stringify({ error: 'Knowledge base not configured. Set MULTIAGENT_API_URL environment variable.' });
          }

          // Build the query with optional state context
          const enrichedQuestion = state
            ? `[State: ${state.toUpperCase()}] ${question}`
            : question;

          // Call the multiagent backend (OpenAI-compatible /chat/completions)
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            // API key auth (if configured, e.g. for operator-tier access)
            if (process.env.MULTIAGENT_API_KEY) {
              headers['x-api-key'] = process.env.MULTIAGENT_API_KEY;
            }

            const response = await fetch(`${multiagentUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                messages: [{ role: 'user', content: enrichedQuestion }],
                stream: false,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
              const errText = await response.text().catch(() => 'unknown');
              return JSON.stringify({ error: `Knowledge base returned ${response.status}: ${errText.slice(0, 200)}` });
            }

            // The multiagent backend currently emits SSE (`data: {...}\n\n`)
            // even when `stream: false` is requested. Detect either format
            // and aggregate. We strip <think> blocks (the agent's internal
            // routing trace) and concatenate every `delta.content` chunk.
            const contentType = response.headers.get('content-type') ?? '';
            const rawBody = await response.text();
            let answer = '';
            let agent = 'unknown';

            if (contentType.includes('text/event-stream') || rawBody.startsWith('data:') || rawBody.includes('\ndata: ')) {
              // SSE: walk each `data: {...}` line, concatenate delta.content.
              for (const line of rawBody.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                  const chunk = JSON.parse(payload) as {
                    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
                    agentId?: string;
                  };
                  if (chunk.agentId) agent = chunk.agentId;
                  const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
                  if (typeof delta === 'string') answer += delta;
                } catch { /* skip malformed chunks */ }
              }
              // Strip the agent's internal <think>...</think> routing trace.
              answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            } else {
              // Non-streamed JSON path — keep working when the backend honors stream:false.
              try {
                const data = JSON.parse(rawBody) as {
                  choices?: Array<{ message?: { content?: string } }>;
                  agentId?: string;
                };
                answer = data.choices?.[0]?.message?.content ?? '';
                agent = data.agentId ?? 'unknown';
              } catch {
                return JSON.stringify({
                  error: `Knowledge base returned non-JSON response: ${rawBody.slice(0, 200)}`,
                });
              }
            }

            if (!answer) {
              return JSON.stringify({
                error: `Knowledge base returned empty answer. Raw body: ${rawBody.slice(0, 200)}`,
              });
            }

            return JSON.stringify({
              answer: answer.slice(0, 6000),
              source: `knowledge-base (${agent})`,
              note: 'This is general industry knowledge. Always cross-reference with facility-specific data from other tools.',
            });
          } catch (fetchErr) {
            clearTimeout(timeout);
            if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
              return JSON.stringify({ error: 'Knowledge base request timed out (15s). Try a more specific question.' });
            }
            throw fetchErr;
          }
        } catch (err) {
          return JSON.stringify({ error: `Knowledge base query failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  };
}
