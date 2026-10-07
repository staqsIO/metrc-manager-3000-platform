/**
 * POST /api/import/packages-csv — Import a Metrc "Packages Inventory" CSV.
 *
 * Body (JSON):
 *   - csvText: string — raw CSV content from Metrc Reports Control Panel
 *   - facilityId: string — destination facility for these rows
 *   - confirmed: 'true' | 'false' — preview vs commit
 *
 * Why this exists: backfilling new clients via the REST API is prohibitively
 * slow because Metrc caps historical reads at 20 records per call. The UI
 * export gets thousands of packages in one CSV. Lands rows in
 * `PackageSnapshot` (same table as the API ingest cron) with
 * `skipDuplicates: true` so re-runs are safe and a future API sync
 * supersedes any synthetic ids.
 *
 * Auth: facility-write — caller must have OPERATOR+ on the facility (per
 * FOR-1172) or implicit-admin (no FacilityAccess rows yet for the user).
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma, dashboardPrisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getUserOrgIds } from '@/lib/auth-helpers'
import { parsePackagesInventoryCSV, type PackageSnapshotInput } from '@/services/import/packages-csv-parser'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
    responseLimit: false,
  },
}

interface ImportRequestBody {
  csvText?: string
  facilityId?: string
  confirmed?: string
  /** When 'inactive', tag rows isActive=false (Inactive Packages report). */
  packagesScope?: 'active' | 'inactive'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = await getServerSession(req, res, authOptions)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { csvText, facilityId, confirmed, packagesScope } = (req.body ?? {}) as ImportRequestBody
  if (!csvText || !facilityId) {
    return res.status(400).json({ error: 'Missing required fields: csvText, facilityId' })
  }

  // Org membership + facility access check (same gate as facilityWriteProcedure).
  const orgIds = await getUserOrgIds(dashboardPrisma, session.user.id)
  if (orgIds.length === 0) {
    return res.status(403).json({ error: 'No organization membership' })
  }
  const facility = await prisma.metrcFacility.findFirst({
    where: { id: facilityId, organizationId: { in: orgIds } },
    select: { id: true, name: true, licenseNumber: true },
  })
  if (!facility) {
    return res.status(404).json({ error: 'Facility not found or out of scope' })
  }

  // FOR-1172: explicit grant gate. When the user has any FacilityAccess
  // grants, only those facilities are reachable. No grants → implicit
  // admin (legacy single-facility orgs).
  const facilityAccess: Record<string, string> = (session.user as { facilityAccess?: Record<string, string> })?.facilityAccess ?? {}
  if (Object.keys(facilityAccess).length > 0) {
    const role = facilityAccess[facilityId]
    if (role !== 'OPERATOR' && role !== 'ADMIN') {
      return res.status(403).json({ error: 'OPERATOR role required for this facility' })
    }
  }

  const parseResult = parsePackagesInventoryCSV(csvText, facilityId)
  // Inactive Packages export → mark rows historical so dashboards know
  // these aren't currently in the operator's Metrc account.
  if (packagesScope === 'inactive') {
    for (const r of parseResult.valid) {
      r.isActive = false
    }
  }
  if (parseResult.valid.length === 0) {
    return res.status(400).json({
      error: 'No valid rows parsed',
      detectedHeaders: parseResult.detectedHeaders,
      parseErrors: parseResult.errors.slice(0, 25),
    })
  }

  // Quick category/strain breakdown for the preview surface.
  const categories = new Map<string, number>()
  const strains = new Map<string, number>()
  for (const r of parseResult.valid) {
    categories.set(r.itemCategory ?? '(uncategorized)', (categories.get(r.itemCategory ?? '(uncategorized)') ?? 0) + 1)
    if (r.itemStrainName) {
      strains.set(r.itemStrainName, (strains.get(r.itemStrainName) ?? 0) + 1)
    }
  }

  const isConfirmed = confirmed === 'true'

  if (!isConfirmed) {
    // Dry run — return enough for the UI to confirm column mapping looked
    // right before the user clicks commit. Sample the first 5 rows verbatim.
    return res.status(200).json({
      status: 'preview',
      preview: {
        totalParsed: parseResult.valid.length,
        parseErrors: parseResult.errors.slice(0, 25),
        detectedHeaders: parseResult.detectedHeaders,
        sample: parseResult.valid.slice(0, 5).map((r) => ({
          packageLabel: r.packageLabel,
          itemName: r.itemName,
          itemCategory: r.itemCategory,
          quantity: r.quantity,
          unitOfMeasure: r.unitOfMeasure,
          packagedDate: r.packagedDate,
          locationName: r.locationName,
          itemStrainName: r.itemStrainName,
        })),
        categories: Object.fromEntries(
          Array.from(categories.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25),
        ),
        strains: Object.fromEntries(
          Array.from(strains.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25),
        ),
      },
    })
  }

  // Commit — chunked createMany with skipDuplicates for safe re-runs.
  const CHUNK_SIZE = 500
  let inserted = 0
  for (let i = 0; i < parseResult.valid.length; i += CHUNK_SIZE) {
    const chunk = parseResult.valid.slice(i, i + CHUNK_SIZE)
    const result = await prisma.packageSnapshot.createMany({
      data: chunk.map(toPackageSnapshotData),
      skipDuplicates: true,
    })
    inserted += result.count
  }

  // Audit log so admins can see who imported what + when.
  await prisma.actionLog
    .create({
      data: {
        facilityId,
        userId: session.user.id,
        actionType: 'IMPORT_PACKAGES_CSV',
        status: 'COMPLETED',
        targetType: 'PACKAGE',
        targetIds: [],
        targetCount: inserted,
        executedAt: new Date(),
        metadata: {
          totalParsed: parseResult.valid.length,
          inserted,
          skipped: parseResult.valid.length - inserted,
          parseErrors: parseResult.errors.length,
        } as Prisma.InputJsonValue,
      },
    })
    .catch((err) => {
      console.error('[import/packages-csv] audit log failed', err instanceof Error ? err.message : err)
    })

  return res.status(200).json({
    status: 'completed',
    result: {
      totalParsed: parseResult.valid.length,
      inserted,
      skipped: parseResult.valid.length - inserted,
      parseErrors: parseResult.errors.length,
    },
  })
}

function toPackageSnapshotData(row: PackageSnapshotInput): Prisma.PackageSnapshotCreateManyInput {
  return {
    facilityId: row.facilityId,
    metrcPackageId: row.metrcPackageId,
    packageLabel: row.packageLabel,
    packageType: row.packageType,
    itemId: row.itemId,
    itemName: row.itemName,
    itemCategory: row.itemCategory,
    quantity: new Prisma.Decimal(row.quantity),
    unitOfMeasure: row.unitOfMeasure,
    locationName: row.locationName,
    packagedDate: row.packagedDate ? new Date(row.packagedDate) : null,
    productCategory: row.productCategory,
    itemStrainName: row.itemStrainName,
    isFinished: row.isFinished,
    isActive: row.isActive,
    labTestingState: row.labTestingState,
    isOnHold: row.isOnHold,
    sourceHarvestNames: row.sourceHarvestNames,
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
  }
}
