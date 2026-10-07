/**
 * packages-csv-parser.ts — Parse Metrc "Packages Inventory" UI export.
 *
 * Pure-function module. No React/Prisma/tRPC imports. Targets the
 * `PackageSnapshot` table, which is the same table the API ingest pipeline
 * writes to — CSV-imported rows coexist with snapshot rows because the
 * dedupe key `[facilityId, metrcPackageId]` is unique. When the API later
 * picks up a label that was CSV-imported first, the cron's UPSERT path
 * supersedes the historical row.
 *
 * Why this exists: Metrc's REST API for historical data caps at 20 records
 * per call. Backfilling years of inventory for a new client through the
 * API alone is prohibitively slow + expensive. The UI export is the
 * pragmatic backfill source.
 *
 * Header aliases below cover the column variants we've seen across MA / CO
 * exports as of 2026-04. Add new aliases freely — no code change needed.
 */

import {
  parseCSVLine,
  splitCSVLines,
  buildHeaderMap,
  resolveAliases,
  colByField,
  parseNumber,
  parseDateTime,
  parseBool,
  type HeaderAliases,
} from './csv-core'

/** Shape ready to feed into `prisma.packageSnapshot.createMany`. */
export interface PackageSnapshotInput {
  facilityId: string
  metrcPackageId: number
  packageLabel: string
  packageType: string | null
  itemId: number | null
  itemName: string
  itemCategory: string | null
  quantity: string // Decimal — keep as string for Prisma
  unitOfMeasure: string | null
  locationName: string | null
  packagedDate: string | null // ISO
  productCategory: string | null
  itemStrainName: string | null
  isFinished: boolean
  isActive: boolean
  labTestingState: string | null
  isOnHold: boolean
  sourceHarvestNames: string | null
  /** Original raw row for rehydration / audit. */
  rawPayload: Record<string, string>
}

export interface PackagesParseResult {
  /** Rows ready to insert. */
  valid: PackageSnapshotInput[]
  /** Rows we couldn't parse — reported for the dry-run preview. */
  errors: { row: number; message: string }[]
  /** Headers detected in the CSV — useful for confirming column shape. */
  detectedHeaders: string[]
}

/**
 * Header aliases — extend as we encounter new state-specific exports. Order
 * matters: first match wins. Always try the human-readable name (Metrc
 * Reports Control Panel) before terse aliases.
 */
const PACKAGES_ALIASES: HeaderAliases = {
  // Identity
  metrcPackageId: ['Package #', 'Package ID', 'Package Id'],
  packageLabel: ['Package', 'Package Label', 'Tag'],
  packageType: ['Type', 'Package Type'],

  // Item
  itemId: ['Item #', 'Item Id', 'Item ID'],
  itemName: ['Item', 'Item Name', 'Product Name'],
  itemCategory: ['Category', 'Item Category', 'Product Category'],
  productCategory: ['Product Category Type', 'Sub-Category'],
  itemStrainName: ['Strain', 'Item Strain', 'Strain Name'],

  // Quantity
  quantity: ['Quantity', 'Qty', 'Active Quantity'],
  unitOfMeasure: ['UoM', 'Unit of Measure'],

  // Location + dates
  locationName: ['Location', 'Location Name', 'Current Location'],
  packagedDate: ['Date Packaged', 'Packaged Date', 'Packaged'],

  // Compliance flags
  isFinished: ['Finished', 'Is Finished', 'Finished?'],
  labTestingState: ['Lab Testing', 'Lab Testing State', 'Testing State'],
  isOnHold: ['On Hold', 'Is On Hold', 'Hold'],
  sourceHarvestNames: ['Source Harvests', 'Harvest', 'Source Harvest'],
}

/**
 * Best-effort fallback: derive a deterministic synthetic int id from the
 * package label when the CSV omits "Package #". Uses a 32-bit FNV-1a hash
 * so multiple imports of the same row land on the same key. Negative space
 * is reserved for synthetic ids so they can't collide with Metrc's positive
 * `metrcPackageId` integers.
 */
function syntheticIdFromLabel(label: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // Force into negative 31-bit space to never collide with real Metrc ids.
  return -(Math.abs(hash | 0)) - 1
}

export function parsePackagesInventoryCSV(
  text: string,
  facilityId: string,
): PackagesParseResult {
  const lines = splitCSVLines(text)
  if (lines.length === 0) {
    return { valid: [], errors: [{ row: 0, message: 'CSV is empty.' }], detectedHeaders: [] }
  }

  const headers = parseCSVLine(lines[0]!)
  const headerMap = buildHeaderMap(headers)
  const fieldMap = resolveAliases(headerMap, PACKAGES_ALIASES)

  // Required columns — without these we can't produce a valid row.
  const required: Array<keyof typeof PACKAGES_ALIASES> = [
    'packageLabel',
    'itemName',
    'quantity',
  ]
  const missing = required.filter((f) => !fieldMap.has(f))
  if (missing.length > 0) {
    return {
      valid: [],
      errors: [{
        row: 0,
        message: `Missing required column(s): ${missing.join(', ')}. Detected headers: ${headers.join(', ')}`,
      }],
      detectedHeaders: headers,
    }
  }

  const valid: PackageSnapshotInput[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]!)
    try {
      const packageLabel = colByField(row, fieldMap, 'packageLabel')
      if (!packageLabel) {
        // Skip silently — Metrc UI exports often have summary rows at the bottom.
        continue
      }
      const itemName = colByField(row, fieldMap, 'itemName')
      if (!itemName) {
        errors.push({ row: i + 1, message: 'Missing Item name' })
        continue
      }

      const metrcPackageIdRaw = parseNumber(colByField(row, fieldMap, 'metrcPackageId'))
      const metrcPackageId = metrcPackageIdRaw ?? syntheticIdFromLabel(packageLabel)

      const quantity = parseNumber(colByField(row, fieldMap, 'quantity')) ?? 0
      const itemId = parseNumber(colByField(row, fieldMap, 'itemId'))

      const rawPayload: Record<string, string> = {}
      headers.forEach((h, idx) => {
        const v = row[idx]
        if (v) rawPayload[h] = v
      })

      valid.push({
        facilityId,
        metrcPackageId: Math.trunc(metrcPackageId),
        packageLabel,
        packageType: colByField(row, fieldMap, 'packageType') || null,
        itemId: itemId !== null ? Math.trunc(itemId) : null,
        itemName,
        itemCategory: colByField(row, fieldMap, 'itemCategory') || null,
        quantity: quantity.toString(),
        unitOfMeasure: colByField(row, fieldMap, 'unitOfMeasure') || null,
        locationName: colByField(row, fieldMap, 'locationName') || null,
        packagedDate: parseDateTime(colByField(row, fieldMap, 'packagedDate')),
        productCategory: colByField(row, fieldMap, 'productCategory') || null,
        itemStrainName: colByField(row, fieldMap, 'itemStrainName') || null,
        isFinished: parseBool(colByField(row, fieldMap, 'isFinished')),
        isActive: true,
        labTestingState: colByField(row, fieldMap, 'labTestingState') || null,
        isOnHold: parseBool(colByField(row, fieldMap, 'isOnHold')),
        sourceHarvestNames: colByField(row, fieldMap, 'sourceHarvestNames') || null,
        rawPayload,
      })
    } catch (err) {
      errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : 'Unknown parse error',
      })
    }
  }

  return { valid, errors, detectedHeaders: headers }
}
