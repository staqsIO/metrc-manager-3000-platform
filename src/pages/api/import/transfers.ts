/**
 * POST /api/import/transfers — Multipart file upload for large CSV imports.
 *
 * Accepts multipart/form-data with:
 *   - file: CSV file (max 20MB)
 *   - csvType: 'affiliated' | 'wholesale'
 *   - facilityId: string
 *   - confirmed: 'true' | 'false'
 *
 * Delegates to the same parser + import logic as the tRPC mutation.
 * This route exists because tRPC JSON payloads have size limits for 23K-row CSVs.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseAffiliatedTransferCSV, parseWholesaleTransferCSV } from '@/services/import/transfer-csv-parser';
import { matchFacilities } from '@/services/import/facility-matcher';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { csvText, csvType, facilityId, confirmed } = req.body as {
    csvText?: string;
    csvType?: string;
    facilityId?: string;
    confirmed?: string;
  };

  if (!csvText || !csvType || !facilityId) {
    return res.status(400).json({ error: 'Missing required fields: csvText, csvType, facilityId' });
  }

  if (csvType !== 'affiliated' && csvType !== 'wholesale') {
    return res.status(400).json({ error: 'csvType must be "affiliated" or "wholesale"' });
  }

  // Verify facility access
  const facility = await prisma.metrcFacility.findUnique({
    where: { id: facilityId },
    select: { id: true, organizationId: true, licenseNumber: true, name: true },
  });

  if (!facility) {
    return res.status(404).json({ error: 'Facility not found' });
  }

  // Parse CSV
  const parseResult = csvType === 'affiliated'
    ? parseAffiliatedTransferCSV(csvText)
    : parseWholesaleTransferCSV(csvText);

  if (parseResult.valid.length === 0) {
    return res.status(400).json({
      error: 'No valid rows parsed',
      parseErrors: parseResult.errors.slice(0, 20),
    });
  }

  // Match facilities
  const orgFacilities = await prisma.metrcFacility.findMany({
    where: { organizationId: facility.organizationId, isActive: true },
    select: { id: true, licenseNumber: true, name: true },
  });

  const matchResult = matchFacilities(parseResult.valid, orgFacilities);

  const isConfirmed = confirmed === 'true';

  if (!isConfirmed) {
    // Preview
    const categories = new Map<string, number>();
    for (const line of matchResult.matched) {
      categories.set(line.itemCategory, (categories.get(line.itemCategory) ?? 0) + 1);
    }

    return res.status(200).json({
      status: 'preview',
      preview: {
        totalParsed: parseResult.valid.length,
        parseErrors: parseResult.errors.slice(0, 20),
        matched: matchResult.matched.length,
        unmatched: matchResult.unmatched.length,
        unmatchedFacilities: matchResult.unmatchedFacilities.slice(0, 10),
        categories: Object.fromEntries(categories),
      },
    });
  }

  // Confirmed — batch insert
  const importBatchId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const CHUNK_SIZE = 500;
  let insertedCount = 0;

  for (let i = 0; i < matchResult.matched.length; i += CHUNK_SIZE) {
    const chunk = matchResult.matched.slice(i, i + CHUNK_SIZE);
    const result = await prisma.transferLineItem.createMany({
      data: chunk.map(line => ({
        facilityId: line.facilityId,
        manifestNumber: line.manifestNumber,
        originLicenseNumber: line.originLicenseNumber,
        originFacilityName: line.originFacilityName,
        originFacilityType: line.originFacilityType,
        destLicenseNumber: line.destLicenseNumber,
        destFacilityName: line.destFacilityName,
        destFacilityType: line.destFacilityType,
        transferType: line.transferType,
        createdDateTime: line.createdDateTime,
        receivedDateTime: line.receivedDateTime,
        isVoided: line.isVoided,
        packageLabel: line.packageLabel,
        itemName: line.itemName,
        itemCategory: line.itemCategory,
        shippedQuantity: line.shippedQuantity,
        shippedUnitOfMeasure: line.shippedUnitOfMeasure,
        shippedWeight: line.shippedWeight,
        shippedWeightUoM: line.shippedWeightUoM,
        receivedQuantity: line.receivedQuantity,
        receivedUnitOfMeasure: line.receivedUnitOfMeasure,
        receivedWeight: line.receivedWeight,
        receivedWeightUoM: line.receivedWeightUoM,
        countVariancePct: line.countVariancePct,
        weightVariancePct: line.weightVariancePct,
        shipperWholesalePrice: line.shipperWholesalePrice,
        receiverWholesalePrice: line.receiverWholesalePrice,
        importSource: `csv_${csvType}`,
        importBatchId,
      })),
      skipDuplicates: true,
    });
    insertedCount += result.count;
  }

  await prisma.actionLog.create({
    data: {
      facilityId,
      userId: session.user.id,
      actionType: 'TRANSFER_IMPORT_CSV',
      status: 'COMPLETED',
      targetType: 'TRANSFER',
      targetIds: [importBatchId],
      targetCount: insertedCount,
      executedAt: new Date(),
    },
  });

  return res.status(200).json({
    status: 'completed',
    importBatchId,
    insertedCount,
    skippedDuplicates: matchResult.matched.length - insertedCount,
    unmatchedCount: matchResult.unmatched.length,
  });
}
