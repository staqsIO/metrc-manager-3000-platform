import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure, platformProcedure } from '@/lib/trpc';
import { dashboardPrisma, prisma } from '@/lib/prisma';
import type { MetrcFacility } from '@prisma/client';
import { getActivePackagesFromDb, getAllHarvestsFromDb } from '@/services/metrc/snapshot-utils';
import {
  buildFacilityContext,
  getContextualSuggestions,
  COPILOT_SKILLS,
  executeCopilotQuery,
  checkCopilotRateLimit,
} from '@/services/copilot/copilot-service';
import { getMCPServersInfo } from '@/services/copilot/mcp-client';
import { resolveLlm, getProviders } from '@/services/llm/registry';
import { generateAuditSnapshot } from '@/services/engines/audit-engine';
import { analyzeAgingDistribution, detectFIFOViolations } from '@/services/engines/fifo-engine';
import { detectSlowMoving } from '@/services/engines/fifo-engine';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import { getUserOrgIds } from '@/lib/auth-helpers';
import { getAccessibleFacilities } from '@/server/api/routers/cross-facility';
import { demoQuotaStatus, takeDemoQuestionOrThrow } from '@/server/api/demo-ai-gate';

// Skill IDs that work in org mode (no facility required)
const ORG_SKILLS = new Set(['executive-overview', 'financial-health']);

/**
 * Compute briefing metrics + snapshot data for a facility.
 * Reused by getBriefing (query) and the cron snapshot job.
 */
/**
 * FOR-1485 Phase 1: cap live in-memory compute. Engines like detectFIFOViolations
 * are O(n²) over the package list and saturate the node process at >10K rows.
 * For oversize facilities, return an `oversize: true` shape with the cheap
 * `totalPackages` count and empty engine outputs — the per-page Inventory routes
 * already have DB-side queries that scale.
 *
 * Phase 2 will populate `briefing_snapshots` via cron and read from there here.
 */
const MAX_PACKAGES_FOR_LIVE_COMPUTE = 10_000;

export async function computeBriefingMetrics(facility: MetrcFacility) {
  // Cheap count first — uses index, returns fast even for 100K+ rows.
  const totalCount = await prisma.packageSnapshot.count({
    where: { facilityId: facility.id, isActive: true },
  });
  const oversize = totalCount > MAX_PACKAGES_FOR_LIVE_COMPUTE;

  // Skip the full-array load entirely on oversize facilities.
  const packages = oversize ? [] : await getActivePackagesFromDb(prisma, facility.id);

  const [audit, aging, fifoViolations, slowMoving] = await Promise.all([
    Promise.resolve(generateAuditSnapshot(packages, facility.facilityType)),
    Promise.resolve(analyzeAgingDistribution(packages)),
    Promise.resolve(detectFIFOViolations(packages)),
    Promise.resolve(detectSlowMoving(packages)),
  ]);

  const harvestTypes = ['Cultivator', 'Microbusiness'];
  const supportsHarvests = harvestTypes.includes(facility.facilityType ?? '');

  // Only call Dutchie if credentials are configured
  const hasDutchie = facility.dutchieEnvironment && facility.dutchieEnvironment !== 'none';
  const [runRateResult, harvestResult] = await Promise.allSettled([
    (async () => {
      const dutchie = getDutchieClient(hasDutchie ? facility : { ...facility, dutchieEnvironment: 'none' } as typeof facility);
      return computeRunRates(packages, dutchie, { daysLookback: 30, prisma, facilityId: facility.id });
    })(),
    supportsHarvests
      ? getAllHarvestsFromDb(prisma, facility.id).then(r => r.active)
      : Promise.resolve([]),
  ]);

  let weeksOfSupply: number | null = null;
  let promoOpportunityCount = 0;
  if (runRateResult.status === 'fulfilled') {
    weeksOfSupply = runRateResult.value.overallWeeksOfSupply;
    promoOpportunityCount = runRateResult.value.promoOpportunities?.length ?? 0;
  }

  const onHoldCount = packages.filter(p => p.IsOnHold).length;
  const deadStock = slowMoving.filter(p => p.tier === 'dead');

  let harvestThroughputGrams: number | null = null;
  let harvestCount = 0;
  if (harvestResult.status === 'fulfilled') {
    const harvests = harvestResult.value;
    harvestCount = harvests.length;
    harvestThroughputGrams = Math.round(
      harvests.reduce((sum, h) => sum + (h.TotalPackagedWeight ?? 0), 0) * 100
    ) / 100;
  }

  return {
    totalPackages: totalCount, // accurate even when oversize-gated
    auditScore: audit.overallScore,
    averageAgeDays: aging.averageAgeDays,
    weeksOfSupply,
    fifoViolationCount: fifoViolations.length,
    fifoViolations: fifoViolations.slice(0, 20), // Top 20 only — not full array
    slowMovingCount: slowMoving.length,
    slowMoving: slowMoving.slice(0, 20), // Top 20 only
    deadStockCount: deadStock.length,
    onHoldCount,
    audit,
    aging,
    harvestThroughputGrams,
    harvestCount,
    promoOpportunityCount,
    oversize, // FOR-1485: clients can render a "facility too large for live compute" hint
    // packages intentionally excluded — was ~2MB for 2400 items, client only needs metrics
    snapshot: {
      metrics: {
        totalPackages: totalCount,
        auditScore: audit.overallScore,
        fifoViolationCount: fifoViolations.length,
        avgAgeDays: aging.averageAgeDays,
        slowMovingCount: slowMoving.length,
        deadStockCount: deadStock.length,
        onHoldCount,
        weeksOfSupply,
        insightCount: 0, // will be set after insights are built
      },
      details: {
        fifoViolations: fifoViolations.slice(0, 50).map(v => ({
          newerLabel: v.newerPackage.label,
          olderLabel: v.olderPackage.label,
          category: v.category,
          strain: v.strain,
          daysDifference: v.daysDifference,
        })),
        criticalAgingLabels: aging.critical.packages.slice(0, 20).map(p => p.label),
      },
    },
  };
}

export const copilotRouter = createTRPCRouter({
  // The default model of the configured LLM provider (null = AI disabled)
  getActiveModel: platformProcedure.query(async () => {
    const llm = await resolveLlm();
    if (!llm) return null;
    return { modelId: llm.model, displayName: llm.model.split('/').pop() || llm.model, provider: llm.provider.name };
  }),

  // Models offered by enabled LLM providers (configured in Super Admin → LLM Providers)
  getAvailableModels: platformProcedure
    .input(z.object({ facilityId: z.string().optional() }))
    .query(async () => {
      const providers = (await getProviders()).filter((p) => p.enabled);
      return providers.flatMap((p) =>
        Array.from(new Set([p.defaultModel, ...p.models])).map((model) => ({
          model_id: model,
          display_name: model.split('/').pop() || model,
          provider: p.name,
          supports_function_calling: true,
          max_context_tokens: null as number | null,
        })),
      );
    }),

  // Get available copilot skills (categorized workflows), filtered by facility type
  getSkills: platformProcedure
    .input(z.object({ facilityId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (!input.facilityId) {
        // Org mode: return only org-compatible skills
        return COPILOT_SKILLS.filter(s => ORG_SKILLS.has(s.id));
      }
      // Look up facility type for context-aware skill filtering
      const facility = await ctx.prisma.metrcFacility.findUnique({
        where: { id: input.facilityId },
        select: { facilityType: true },
      });
      const facilityType = facility?.facilityType;
      if (!facilityType) return COPILOT_SKILLS; // unknown type = show all
      return COPILOT_SKILLS.filter(s =>
        !s.facilityTypes || s.facilityTypes.includes(facilityType)
      );
    }),

  // Get contextual suggestions based on current facility state
  getSuggestions: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      const context = buildFacilityContext(
        facility.name,
        facility.licenseNumber,
        facility.stateCode,
        packages,
        facility.facilityType ?? undefined,
      );

      return getContextualSuggestions(context);
    }),

  // Get facility context summary for the copilot
  getContext: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      return buildFacilityContext(
        facility.name,
        facility.licenseNumber,
        facility.stateCode,
        packages,
        facility.facilityType ?? undefined,
      );
    }),

  // Lightweight click-through telemetry for skill cards / suggestion chips.
  // Structured server log only — no schema change. Aggregate from Railway logs.
  // Required signal for deciding whether Phase 2 (templating) is worth shipping.
  logSkillClick: platformProcedure
    .input(z.object({
      skillId: z.string().max(100),
      surface: z.enum(['skill_card', 'suggestion_chip', 'inline_suggestion']),
      facilityId: z.string().optional(),
      facilityType: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      console.log('[copilot.skill_click]', JSON.stringify({
        userId: ctx.session.user.id,
        skillId: input.skillId,
        surface: input.surface,
        facilityId: input.facilityId ?? null,
        facilityType: input.facilityType ?? null,
        ts: new Date().toISOString(),
      }));
      return { ok: true };
    }),

  // Send a message and get a response (non-streaming fallback)
  // Supports both facility mode (facilityId provided) and org mode (no facilityId)
  /** Free questions left for this visitor on the public demo; null on a real install. */
  demoQuota: platformProcedure.query(({ ctx }) => demoQuotaStatus(ctx.forwardedFor)),

  sendMessage: platformProcedure
    .input(z.object({
      facilityId: z.string().optional(),
      message: z.string().min(1).max(2000),
      history: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })).max(50).optional(),
      skillId: z.string().max(100).optional(),
      captureAudit: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Rate limit per user (shared bucket with SSE endpoint)
      if (!checkCopilotRateLimit(ctx.session.user.id)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded. Please wait a moment before sending more messages.',
        });
      }
      await takeDemoQuestionOrThrow(ctx.forwardedFor);

      const historyMapped = input.history?.filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      if (input.facilityId) {
        // FACILITY MODE — validate access (mirrors facilityProcedure logic)
        let orgIds: string[];
        try {
          orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);
        } catch {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No organization membership found' });
        }
        const facility = await ctx.prisma.metrcFacility.findFirst({
          where: { id: input.facilityId, organizationId: { in: orgIds } },
        });
        if (!facility) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Facility not found or access denied' });
        }

        // FOR-1172: enforce facility-level access grants
        const facilityAccess: Record<string, string> = ctx.session.user?.facilityAccess ?? {};
        if (Object.keys(facilityAccess).length > 0 && !facilityAccess[input.facilityId]) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this facility' });
        }

        // FOR-1491: derive the user's facility role so executeCopilotQuery can
        // refuse action tools for VIEWER. Implicit-admin fallback (zero grants
        // = ADMIN) matches resolveFacilityRole() in trpc.ts.
        const userFacilityRole =
          Object.keys(facilityAccess).length > 0
            ? facilityAccess[input.facilityId] ?? 'VIEWER'
            : 'ADMIN';

        const result = await executeCopilotQuery({
          facility: facility as MetrcFacility,
          message: input.message,
          history: historyMapped,
          userId: ctx.session.user.id,
          userFacilityRole,
          prisma: ctx.prisma,
          dashboardPrisma,
          skillId: input.skillId,
          captureAudit: input.captureAudit,
        });

        return {
          role: 'assistant' as const,
          content: result.content,
          context: result.context,
          toolsUsed: result.toolsUsed,
          ...(result.audit ? { audit: result.audit } : {}),
        };
      } else {
        // ORG MODE — resolve accessible facilities
        const orgFacilities = await getAccessibleFacilities({
          session: ctx.session,
          activeOrgId: ctx.activeOrgId ?? null,
          prisma: ctx.prisma,
        });

        const result = await executeCopilotQuery({
          orgFacilities,
          message: input.message,
          history: historyMapped,
          userId: ctx.session.user.id,
          prisma: ctx.prisma,
          dashboardPrisma,
          skillId: input.skillId,
          captureAudit: input.captureAudit,
        });

        return {
          role: 'assistant' as const,
          content: result.content,
          context: result.context,
          toolsUsed: result.toolsUsed,
          ...(result.audit ? { audit: result.audit } : {}),
        };
      }
    }),

  // Get connected MCP servers and their tools (for the frontend)
  getMCPTools: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async () => {
      return getMCPServersInfo();
    }),

  // Proactive briefing — server-side engine runs for quick dashboard insights
  getBriefing: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const metrics = await computeBriefingMetrics(facility);

      // Fetch supply alerts (not needed for snapshot, only for briefing display)
      const lowStockItems = await ctx.prisma.supplyItem.findMany({
        where: { facilityId: facility.id, isActive: true, reorderPoint: { not: null } },
        select: { currentStock: true, reorderPoint: true },
      }).catch(() => []);

      // promoOpportunityCount already computed inside computeBriefingMetrics — no duplicate API call
      const promoOpportunityCount = metrics.promoOpportunityCount;

      const restockAlertCount = lowStockItems.filter(
        i => i.reorderPoint != null && i.currentStock < i.reorderPoint,
      ).length;

      // Build actionable insights
      const insights: { severity: 'critical' | 'warning' | 'info' | 'success'; title: string; detail: string; action?: string; link?: string }[] = [];

      if (metrics.audit.overallScore < 60) {
        insights.push({
          severity: 'critical',
          title: 'Compliance Score: ' + metrics.audit.overallScore + '/100',
          detail: metrics.audit.criticalCount + ' critical finding' + (metrics.audit.criticalCount !== 1 ? 's' : '') + ' detected',
          action: 'Run full audit',
          link: `/facilities/${facility.id}/compliance/audit`,
        });
      } else if (metrics.audit.overallScore < 80) {
        insights.push({
          severity: 'warning',
          title: 'Compliance Score: ' + metrics.audit.overallScore + '/100',
          detail: metrics.audit.warningCount + ' warning' + (metrics.audit.warningCount !== 1 ? 's' : '') + ' need attention',
          action: 'Review audit',
          link: `/facilities/${facility.id}/compliance/audit`,
        });
      } else {
        insights.push({
          severity: 'success',
          title: 'Compliance Score: ' + metrics.audit.overallScore + '/100',
          detail: 'Facility is in good compliance standing',
        });
      }

      if (metrics.aging.critical.count > 0) {
        insights.push({
          severity: 'critical',
          title: metrics.aging.critical.count + ' packages over 90 days old',
          detail: 'Average age: ' + metrics.averageAgeDays + ' days. ' + metrics.aging.critical.count + ' packages need immediate action.',
          action: 'View aging inventory',
          link: `/facilities/${facility.id}/inventory/aging`,
        });
      }

      if (metrics.fifoViolations.length > 0) {
        insights.push({
          severity: 'warning',
          title: metrics.fifoViolations.length + ' FIFO violation' + (metrics.fifoViolations.length !== 1 ? 's' : ''),
          detail: 'Newer packages are being used before older ones. Worst gap: ' + metrics.fifoViolations[0].daysDifference + ' days.',
          action: 'Review FIFO',
          link: `/facilities/${facility.id}/inventory/aging`,
        });
      }

      if (metrics.deadStockCount > 0) {
        insights.push({
          severity: 'warning',
          title: metrics.deadStockCount + ' dead stock package' + (metrics.deadStockCount !== 1 ? 's' : ''),
          detail: 'Packages idle for 120+ days. Consider discounting, sampling out, or destruction.',
          action: 'View slow movers',
          link: `/facilities/${facility.id}/inventory`,
        });
      }

      if (metrics.onHoldCount > 0) {
        const pct = Math.round((metrics.onHoldCount / metrics.totalPackages) * 100);
        insights.push({
          severity: pct > 10 ? 'critical' : 'warning',
          title: metrics.onHoldCount + ' package' + (metrics.onHoldCount !== 1 ? 's' : '') + ' on hold (' + pct + '%)',
          detail: 'Held packages cannot be sold or transferred.',
          action: 'Review holds',
          link: `/facilities/${facility.id}/compliance`,
        });
      }

      if (promoOpportunityCount > 0) {
        insights.push({
          severity: 'info',
          title: promoOpportunityCount + ' categor' + (promoOpportunityCount !== 1 ? 'ies have' : 'y has') + ' excess inventory',
          detail: 'Consider running promotions on overstocked categories (>12 weeks supply)',
          action: 'View run rates',
          link: `/facilities/${facility.id}/run-rates`,
        });
      }

      if (restockAlertCount > 0) {
        insights.push({
          severity: 'warning',
          title: restockAlertCount + ' supply item' + (restockAlertCount !== 1 ? 's' : '') + ' below reorder point',
          detail: 'Non-Metrc materials need restocking',
          action: 'View alerts',
          link: `/facilities/${facility.id}/supply/alerts`,
        });
      }

      if (metrics.harvestThroughputGrams != null && metrics.harvestCount > 0) {
        insights.push({
          severity: 'info',
          title: metrics.harvestThroughputGrams + ' g packaged from ' + metrics.harvestCount + ' active harvest' + (metrics.harvestCount !== 1 ? 's' : ''),
          detail: 'Current harvest activity summary',
          action: 'View harvests',
          link: `/facilities/${facility.id}/harvests`,
        });
      }

      return {
        facilityName: facility.name,
        facilityId: facility.id,
        metrcEnvironment: facility.metrcEnvironment,
        totalPackages: metrics.totalPackages,
        auditScore: metrics.auditScore,
        averageAgeDays: metrics.averageAgeDays,
        weeksOfSupply: metrics.weeksOfSupply,
        promoOpportunityCount,
        restockAlertCount,
        harvestThroughputGrams: metrics.harvestThroughputGrams,
        insights,
      };
    }),

  // Get current briefing + delta from the most recent snapshot
  getBriefingWithDelta: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx }) => {
      // Run FIFO detection for current violation details (lightweight — no run-rates/harvests)
      const packages = await getActivePackagesFromDb(ctx.prisma, ctx.facility.id);
      const fifoViolations = detectFIFOViolations(packages);

      const currentFifoDetails = fifoViolations.slice(0, 50).map(v => ({
        newerLabel: v.newerPackage.label,
        olderLabel: v.olderPackage.label,
        category: v.category,
        strain: v.strain,
        daysDifference: v.daysDifference,
      }));

      const previousSnapshot = await ctx.prisma.briefingSnapshot.findFirst({
        where: { facilityId: ctx.facility.id },
        orderBy: { createdAt: 'desc' },
        select: { metrics: true, details: true, createdAt: true },
      });

      return { previousSnapshot, currentFifoDetails };
    }),

  // Save a briefing snapshot. Called by cron but also reachable by clients —
  // gate at OPERATOR-minimum to prevent VIEWER role users from polluting
  // snapshot history. Cron service account has implicit ADMIN.
  saveBriefingSnapshot: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx }) => {
      const facility = ctx.facility as MetrcFacility;
      const result = await computeBriefingMetrics(facility);

      return ctx.prisma.briefingSnapshot.create({
        data: {
          facilityId: facility.id,
          metrics: result.snapshot.metrics,
          details: result.snapshot.details,
        },
      });
    }),

  // List snapshot history for a facility (last 30 days)
  listBriefingSnapshots: facilityProcedure
    .input(z.object({ facilityId: z.string(), limit: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.briefingSnapshot.findMany({
        where: { facilityId: ctx.facility.id },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: { id: true, metrics: true, createdAt: true },
      });
    }),
});
