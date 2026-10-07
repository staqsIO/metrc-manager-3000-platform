import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import type { MetrcFacility } from '@prisma/client';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { computeBriefingMetrics } from '@/server/api/routers/copilot';

/**
 * Railway cron endpoint for daily briefing snapshots.
 * Captures compliance metrics per facility for historical delta tracking.
 *
 * Railway cron config:
 *   POST /api/cron/briefing-snapshot
 *   Authorization: Bearer $CRON_SECRET
 *   Schedule: 0 6 * * *
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    // Find all active facilities
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: { isActive: true, organizationId: { in: prodOrgIds } },
    });

    const results: Array<{
      facilityId: string;
      facilityName: string;
      status: string;
      errorMessage?: string;
    }> = [];

    for (const facility of facilities) {
      try {
        const result = await computeBriefingMetrics(facility as MetrcFacility);

        await prisma.briefingSnapshot.create({
          data: {
            facilityId: facility.id,
            metrics: result.snapshot.metrics,
            details: result.snapshot.details,
          },
        });

        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'COMPLETED',
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[briefing-snapshot] Failed for ${facility.name}:`, msg);
        results.push({
          facilityId: facility.id,
          facilityName: facility.name,
          status: 'FAILED',
          errorMessage: msg,
        });
      }
    }

    // Retention: delete snapshots older than 90 days
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - 90);
    const { count: deletedCount } = await prisma.briefingSnapshot.deleteMany({
      where: { createdAt: { lt: retentionDate } },
    });

    return res.status(200).json({
      processed: facilities.length,
      succeeded: results.filter(r => r.status === 'COMPLETED').length,
      failed: results.filter(r => r.status === 'FAILED').length,
      deletedStaleSnapshots: deletedCount,
      results,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
