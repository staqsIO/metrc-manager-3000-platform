import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility, Prisma } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { evaluateAndCreateAlerts } from '@/services/engines/rules-evaluation';

/**
 * Railway cron endpoint for automated business rules evaluation.
 * Runs daily at 6:15 AM UTC (15 min after Metrc sync, safe margin for tail facilities).
 *
 * Railway cron config:
 *   POST /api/cron/rules-eval
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 15 6 * * *
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!prisma) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Get all active, non-mock facilities
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: {
        isActive: true,
        metrcEnvironment: { not: 'mock' },
        organizationId: { in: prodOrgIds },
      },
    });

    const results = [];
    let totalAlertsCreated = 0;
    let totalAutoResolved = 0;

    for (const facility of facilities) {
      try {
        const client = getMetrcClient(facility as MetrcFacility);
        const result = await evaluateAndCreateAlerts(prisma, facility.id, client, {
          stateCode: facility.stateCode,
        });

        // Create ActionLog per facility evaluation (matching auto-discount cron pattern)
        await prisma.actionLog.create({
          data: {
            facilityId: facility.id,
            userId: 'system-cron',
            actionType: 'RULES_EVALUATION',
            status: 'COMPLETED',
            targetType: 'PACKAGE',
            targetIds: [],
            targetCount: result.evaluated,
            executedAt: new Date(),
            metadata: {
              rulesChecked: result.rulesChecked,
              violationsFound: result.violationsFound,
              alertsCreated: result.alertsCreated,
              alertsSkipped: result.alertsSkipped,
              alertsAutoResolved: result.alertsAutoResolved,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        totalAlertsCreated += result.alertsCreated;
        totalAutoResolved += result.alertsAutoResolved;

        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'SUCCESS',
          ...result,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'FAILED',
          errorMessage: msg,
        });
      }
    }

    return res.status(200).json({
      processed: facilities.length,
      totalAlertsCreated,
      totalAutoResolved,
      results,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
