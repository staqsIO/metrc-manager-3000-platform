/**
 * filename-detect.ts — Best-effort auto-detection of facility + report type
 * from a Metrc UI export filename.
 *
 * Metrc filenames embed two useful signals:
 *   1. License number with state-specific prefix
 *      e.g. "Massachusetts MR000103 Inactive Packages.xlsx"
 *           → MR000103 (Marijuana Retailer = Dispensary)
 *      e.g. "MC000101 Transfers Report ALL 04-16-2026.csv"
 *           → MC000101 (Marijuana Cultivator)
 *      e.g. "MP000102 Wholesale Transfers Report ..." → Manufacturer
 *   2. Report name as plain text:
 *      "Inactive Packages" / "Active Packages" / "Packages Inventory"
 *      "Transfers Report" / "Wholesale Transfers"
 *      "Sales Transactions"
 *
 * Pure helpers — no React / Prisma. Exported separately so both client and
 * future server-side ingest queues can reuse the rules.
 */

export type DetectedReportType =
  | 'packages'
  | 'transfers-affiliated'
  | 'transfers-wholesale'
  | 'sales'

export interface FilenameDetection {
  /** Extracted license number (e.g. "MR000103"). null when no match. */
  licenseNumber: string | null
  /** Detected report type. null when no keyword match. */
  reportType: DetectedReportType | null
  /** True when the filename contains "Inactive" — packages flag. */
  inactivePackages: boolean
  /** Inferred facility type from license prefix (display-only). */
  inferredFacilityType: 'Cultivator' | 'Manufacturer' | 'Dispensary' | null
}

// MA prefixes are letters + 6 digits. CO/CA add their own prefixes; this
// regex tolerates 1–4 prefix letters followed by 4–8 digits, which covers
// every state we've seen so far.
const LICENSE_PATTERN = /\b([A-Z]{1,4}\d{4,8})\b/

/**
 * MA license prefixes:
 *   MR = Marijuana Retailer (Dispensary)
 *   MP = Marijuana Product Manufacturer
 *   MC = Marijuana Cultivator
 *   MM = Microbusiness (treat as Manufacturer for reports until we have one)
 *
 * CO uses different prefixes; we'll add when we see them. This map only
 * influences the *display* hint — the actual import binds to the user's
 * Metrc facility row by license number, not by inferred type.
 */
const MA_PREFIX_TO_TYPE: Record<string, FilenameDetection['inferredFacilityType']> = {
  MC: 'Cultivator',
  MP: 'Manufacturer',
  MM: 'Manufacturer',
  MR: 'Dispensary',
}

export function detectFromFilename(filename: string): FilenameDetection {
  const lower = filename.toLowerCase()

  // License extraction: pick the first match in the filename. Strips the
  // path so callers can pass either basename or full path.
  const basename = filename.split('/').pop() ?? filename
  const match = basename.match(LICENSE_PATTERN)
  const licenseNumber = match ? match[1]! : null

  // Inferred type from MA prefix — only set when we recognize the prefix.
  // Prefix can be 1–4 letters; we only know MA mappings for 2-letter ones.
  let inferredFacilityType: FilenameDetection['inferredFacilityType'] = null
  if (licenseNumber) {
    const prefix = licenseNumber.match(/^[A-Z]+/)?.[0] ?? ''
    if (prefix.length === 2 && MA_PREFIX_TO_TYPE[prefix]) {
      inferredFacilityType = MA_PREFIX_TO_TYPE[prefix]!
    }
  }

  // Report type detection — order matters. "Wholesale Transfers" is
  // checked before plain "Transfers" because the longer phrase is a
  // more specific match.
  let reportType: DetectedReportType | null = null
  if (/wholesale\s+transfers/.test(lower)) {
    reportType = 'transfers-wholesale'
  } else if (/sales\s+transactions/.test(lower)) {
    reportType = 'sales'
  } else if (/transfers\s+report|transfers\b/.test(lower)) {
    reportType = 'transfers-affiliated'
  } else if (/(inactive|active)\s+packages|packages\s+inventory|packages\s+report/.test(lower)) {
    reportType = 'packages'
  }

  const inactivePackages = /inactive\s+packages/.test(lower)

  return { licenseNumber, reportType, inactivePackages, inferredFacilityType }
}

/**
 * Match a detected license number against a list of facilities. Returns
 * the facility id when found, or null. License comparison is exact and
 * case-insensitive (Metrc filenames preserve case but operators
 * occasionally type lowercase manually).
 */
export function matchFacilityByLicense<T extends { id: string; licenseNumber: string }>(
  licenseNumber: string | null,
  facilities: T[],
): T | null {
  if (!licenseNumber) return null
  const upper = licenseNumber.toUpperCase()
  return facilities.find((f) => f.licenseNumber?.toUpperCase() === upper) ?? null
}
