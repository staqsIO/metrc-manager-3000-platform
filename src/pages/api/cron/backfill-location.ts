import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCronSecret } from '@/lib/cron-auth'
import { prisma } from '@/lib/prisma';

/**
 * One-shot backfill: extract LocationName from rawPayload JSON into the
 * locationName column on PackageSnapshot. Zero Metrc API calls — reads
 * from data already stored during prior syncs.
 *
 * POST /api/cron/backfill-location
 * Authorization: Bearer $CRON_SECRET
 *
 * Uses a single SQL UPDATE — completes in seconds even for 60K+ rows.
 * Safe to run multiple times (idempotent).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await prisma.$executeRawUnsafe(`
      UPDATE "PackageSnapshot"
      SET "locationName" = "rawPayload"->>'LocationName'
      WHERE "locationName" IS NULL
        AND "rawPayload"->>'LocationName' IS NOT NULL
        AND "rawPayload"->>'LocationName' != ''
    `);

    console.log(`[BACKFILL-LOCATION] Updated ${result} snapshots`);
    return res.status(200).json({ updated: result });
  } catch (err) {
    console.error('[BACKFILL-LOCATION] Fatal error:', err);
    return res.status(500).json({ error: 'Backfill failed' });
  }
}
