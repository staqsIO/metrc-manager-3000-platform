import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { getProductionOrgIds } from '@/services/tenant';
import { runFullSync } from '@/services/sync/sync-orchestrator';

/**
 * Vercel Cron endpoint for scheduled Metrc data sync.
 * Runs daily, syncs all active non-mock facilities.
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/sync",
 *     "schedule": "0 6 * * *"
 *   }]
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret to prevent unauthorized access
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
    // Get all active, non-mock facilities — credential validation is handled by the factory
    const prodOrgIds = await getProductionOrgIds(dashboardPrisma);
    const facilities = await prisma.metrcFacility.findMany({
      where: {
        isActive: true,
        metrcEnvironment: { not: 'mock' },
        organizationId: { in: prodOrgIds },
      },
    });

    const results = [];
    for (let i = 0; i < facilities.length; i++) {
      try {
        const result = await runFullSync(prisma, facilities[i]);
        results.push({
          facilityId: facilities[i].id,
          facilityName: facilities[i].name,
          status: result.status,
          packagesCount: result.packagesCount,
          durationMs: result.durationMs,
          errorMessage: result.errorMessage,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          facilityId: facilities[i].id,
          facilityName: facilities[i].name,
          status: 'FAILED' as const,
          packagesCount: 0,
          durationMs: 0,
          errorMessage: msg,
        });
      }
    }

    return res.status(200).json({
      synced: facilities.length,
      results,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
