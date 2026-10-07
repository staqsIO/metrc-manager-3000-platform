import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { MetrcFacility, Prisma, PrismaClient } from '@prisma/client';
import { getMetrcClient, getMetrcClientForWrite } from '@/services/metrc/metrc-factory';
import type { IMetrcClient, MetrcPackage } from '@/services/metrc/types';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import { generateAuditSnapshot } from '@/services/engines/audit-engine';
import { generateAuditReadinessReport, type ActionLogSummary, type LastReconciliation } from '@/services/engines/audit-readiness-engine';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import {
  checkPackageNoteChange,
  checkPackageRemediation,
  checkPackageFinish,
} from '@/services/metrc/verification-checks';
import { evaluateAndCreateAlerts } from '@/services/engines/rules-evaluation';
import { logMetrcErr } from '@/services/metrc/metrc-errors';

// ---------------------------------------------------------------------------
// Shared helper: fetch all data needed for audit readiness report
// ---------------------------------------------------------------------------

async function fetchReadinessData(packages: MetrcPackage[], client: IMetrcClient, prisma: PrismaClient, facilityId: string) {
  const [outgoing, incoming, openAlertCount, lastRecon, recentActionRows] = await Promise.all([
    client.getOutgoingTransfers().catch(logMetrcErr('compliance', 'getOutgoingTransfers')),
    client.getIncomingTransfers().catch(logMetrcErr('compliance', 'getIncomingTransfers')),
    prisma.complianceAlert.count({ where: { facilityId, status: 'OPEN' } }),
    prisma.reconciliationRecord.findFirst({
      where: { facilityId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.actionLog.findMany({
      where: { facilityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        actionType: true,
        status: true,
        targetType: true,
        targetCount: true,
        userId: true,
        createdAt: true,
        executedAt: true,
        errorMessage: true,
      },
    }),
  ]);

  const transfers = [...outgoing, ...incoming];

  const actionLogs: ActionLogSummary[] = recentActionRows.map(row => ({
    id: row.id,
    actionType: row.actionType,
    status: row.status,
    targetType: row.targetType,
    targetCount: row.targetCount,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    executedAt: row.executedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  }));

  const lastReconciliation: LastReconciliation | null = lastRecon
    ? {
        date: lastRecon.createdAt.toISOString(),
        status: lastRecon.status,
        matchRate: lastRecon.totalRecords
          ? Math.round(((lastRecon.matchedCount ?? 0) / lastRecon.totalRecords) * 1000) / 10
          : null,
      }
    : null;

  return { packages, transfers, actionLogs, lastReconciliation, openAlertCount };
}

export const complianceRouter = createTRPCRouter({
  getAlerts: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.ComplianceAlertWhereInput = { facilityId: input.facilityId };
      if (input.status) where.status = input.status;
      if (input.severity) where.severity = input.severity;
      if (input.category) where.category = input.category;
      if (input.search) {
        where.OR = [
          { title: { contains: input.search, mode: 'insensitive' } },
          { packageLabel: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      const [items, total, categoryRows] = await Promise.all([
        ctx.prisma.complianceAlert.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
        }),
        ctx.prisma.complianceAlert.count({ where }),
        // All categories for this facility (unfiltered) so category pills stay stable
        ctx.prisma.complianceAlert.findMany({
          where: { facilityId: input.facilityId },
          select: { category: true },
          distinct: ['category'],
          orderBy: { category: 'asc' },
        }),
      ]);

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
        categories: categoryRows.map(r => r.category),
      };
    }),

  /**
   * Day-of-week × hour-of-day matrix of alert createdAt timestamps over the
   * lookback. Used by the Compliance page's activity heatmap to surface
   * operational rhythm — when do alerts actually fire?
   *
   * Times are bucketed in server time (UTC on Vercel). Per-facility timezone
   * accuracy is a followup; for pattern detection (weekday vs weekend, AM vs
   * PM) the absolute zone doesn't change the shape.
   */
  getActivityHeatmap: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      daysLookback: z.number().min(1).max(180).optional().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const cutoff = new Date(Date.now() - input.daysLookback * 86_400_000);
      const alerts = await ctx.prisma.complianceAlert.findMany({
        where: { facilityId: input.facilityId, createdAt: { gte: cutoff } },
        select: { createdAt: true },
      });
      // matrix[dayOfWeek (0=Sun … 6=Sat)][hour 0-23] — count of alerts.
      const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
      let max = 0;
      for (const a of alerts) {
        const d = a.createdAt;
        const cell = ++matrix[d.getDay()]![d.getHours()]!;
        if (cell > max) max = cell;
      }
      return {
        matrix,
        max,
        totalAlerts: alerts.length,
        daysLookback: input.daysLookback,
      };
    }),

  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [
        totalOpen,
        criticalOpen,
        warningOpen,
        infoOpen,
        totalResolved,
        totalDismissed,
      ] = await Promise.all([
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'OPEN' } }),
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'OPEN', severity: 'CRITICAL' } }),
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'OPEN', severity: 'WARNING' } }),
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'OPEN', severity: 'INFO' } }),
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'RESOLVED' } }),
        ctx.prisma.complianceAlert.count({ where: { facilityId: input.facilityId, status: 'DISMISSED' } }),
      ]);

      return {
        totalOpen,
        criticalOpen,
        warningOpen,
        infoOpen,
        totalResolved,
        totalDismissed,
      };
    }),

  resolveAlert: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      alertId: z.string(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.complianceAlert.update({
        where: { id: input.alertId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: ctx.session.user.id,
          resolutionNote: input.note,
        },
      });
    }),

  dismissAlert: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      alertId: z.string(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.complianceAlert.update({
        where: { id: input.alertId },
        data: {
          status: 'DISMISSED',
          resolvedAt: new Date(),
          resolvedBy: ctx.session.user.id,
          resolutionNote: input.note,
        },
      });
    }),

  auditSnapshot: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as import('@prisma/client').MetrcFacility;
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      return generateAuditSnapshot(packages, facility.facilityType);
    }),

  auditReadiness: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const data = await fetchReadinessData(packages, client, ctx.prisma, input.facilityId);
      return generateAuditReadinessReport(
        data.packages, data.transfers, data.actionLogs, data.lastReconciliation, data.openAlertCount,
      );
    }),

  listAuditSnapshots: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.auditSnapshot.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    }),

  saveAuditSnapshot: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const data = await fetchReadinessData(packages, client, ctx.prisma, input.facilityId);
      const readinessReport = generateAuditReadinessReport(
        data.packages, data.transfers, data.actionLogs, data.lastReconciliation, data.openAlertCount,
      );

      const categoryScores: Record<string, number> = {};
      for (let i = 0; i < readinessReport.packageAudit.categories.length; i++) {
        categoryScores[readinessReport.packageAudit.categories[i].name] = readinessReport.packageAudit.categories[i].score;
      }
      categoryScores['Employee Activity'] = readinessReport.employeeScore;
      categoryScores['Recent Activity'] = readinessReport.activityScore;

      return ctx.prisma.auditSnapshot.create({
        data: {
          facilityId: (ctx.facility as MetrcFacility).id,
          auditType: 'SELF_AUDIT',
          overallScore: readinessReport.overallReadiness,
          categoryScores: categoryScores as unknown as Prisma.InputJsonValue,
          totalFindings: readinessReport.packageAudit.totalFindings,
          criticalCount: readinessReport.packageAudit.criticalCount,
          warningCount: readinessReport.packageAudit.warningCount,
          infoCount: readinessReport.packageAudit.infoCount,
          findings: readinessReport.packageAudit.findings as unknown as Prisma.InputJsonValue,
          metadata: {
            readinessLevel: readinessReport.readinessLevel,
            employeeScore: readinessReport.employeeScore,
            activityScore: readinessReport.activityScore,
            packageAuditScore: readinessReport.packageAudit.overallScore,
            totalEmployees: readinessReport.employeePatterns.totalEmployees,
            trainingNeedsCount: readinessReport.trainingNeeds.length,
            recentActionsCount: readinessReport.recentActions.totalActions,
            failedActionsCount: readinessReport.recentActions.failedCount,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }),

  /**
   * Execute a bulk Metrc action to resolve an audit finding.
   * Supports: expedite_testing, remediate, finish
   */
  resolveAuditFinding: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      actionType: z.enum(['expedite_testing', 'remediate', 'finish']),
      packageLabels: z.array(z.string()).min(1).max(500),
      confirmed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;

      const descriptionMap = {
        expedite_testing: `Flag ${input.packageLabels.length} package(s) with "Expedite lab testing" note`,
        remediate: `Flag ${input.packageLabels.length} package(s) for remediation in Metrc`,
        finish: `Finish ${input.packageLabels.length} zero-quantity package(s) (remove from active inventory)`,
      };

      if (!input.confirmed) {
        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: `AUDIT_${input.actionType.toUpperCase()}`,
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.packageLabels,
            targetCount: input.packageLabels.length,
          },
        });

        return {
          status: 'preview' as const,
          description: descriptionMap[input.actionType],
          count: input.packageLabels.length,
        };
      }

      // Use per-user credentials for write operations
      const writeClient = await getMetrcClientForWrite(facility, ctx.session.user.id, ctx.prisma);

      // Capture beforeState from DB
      const allPkgs = await getActivePackagesFromDb(ctx.prisma, input.facilityId);
      const beforeState = input.packageLabels.map(label => {
        const pkg = allPkgs.find(p => p.Label === label);
        return { Label: label, LastModified: pkg?.LastModified ?? '' };
      });

      // Verification uses live client to check actual Metrc state
      const client = getMetrcClient(facility);

      const executeFn = async () => {
        switch (input.actionType) {
          case 'expedite_testing':
            await writeClient.changePackageNote(
              input.packageLabels.map(label => ({ Label: label, Note: 'Flagged: Expedite lab testing' }))
            );
            break;
          case 'remediate':
            await writeClient.remediatePackages(
              input.packageLabels.map(label => ({ Label: label }))
            );
            break;
          case 'finish':
            await writeClient.finishPackages(
              input.packageLabels.map(label => ({ Label: label }))
            );
            break;
        }
      };

      const verifyFn = async () => {
        const afterPkgs = await client.getActivePackages();
        switch (input.actionType) {
          case 'expedite_testing': {
            const expectedNotes: Record<string, string> = {};
            for (const label of input.packageLabels) expectedNotes[label] = 'Flagged: Expedite lab testing';
            return checkPackageNoteChange(beforeState, afterPkgs.filter(p => input.packageLabels.includes(p.Label)), expectedNotes);
          }
          case 'remediate':
            return checkPackageRemediation(beforeState, afterPkgs.filter(p => input.packageLabels.includes(p.Label)));
          case 'finish':
            return checkPackageFinish(input.packageLabels, afterPkgs);
        }
      };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: `AUDIT_${input.actionType.toUpperCase()}`,
        targetType: 'PACKAGE',
        targetIds: input.packageLabels,
        targetCount: input.packageLabels.length,
        executeFn,
        beforeState,
        verifyFn,
      });

      if (result.status === 'FAILED') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Metrc API call failed' });
      }

      return { status: 'completed' as const, count: input.packageLabels.length, verified: result.verified };
    }),

  runEvaluation: facilityWriteProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      return evaluateAndCreateAlerts(ctx.prisma, input.facilityId, client, {
        stateCode: facility.stateCode,
      });
    }),
});
