/**
 * csv-core.ts — Shared CSV parsing primitives for Metrc UI report imports.
 *
 * Pure-function module. No React/Prisma/tRPC imports. Re-used by every
 * Metrc-report parser (transfers, sales, packages, ...).
 *
 * Why a hand-rolled parser: Metrc UI exports are well-formed CSV but the
 * column counts swing per report (22–60+) and we need positional column
 * resolution for repeated headers (e.g. "UoM" appearing twice in transfer
 * exports). Pulling in `papaparse` would be ~30KB and we'd still need the
 * header-alias layer on top.
 */

/**
 * Parse a single CSV line into trimmed string fields.
 * Handles RFC 4180 double-quoted fields and embedded escaped quotes (`""`).
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

/** Strip CRLF + BOM, split into lines. Skips blank lines. */
export function splitCSVLines(text: string): string[] {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return cleaned.split('\n').filter((l) => l.length > 0)
}

/**
 * Build a header → column-index map from the parsed first row.
 * Repeated header names map to the *first* occurrence; resolve duplicates
 * positionally in the consumer (e.g. "UoM" appearing twice in transfers).
 */
export function buildHeaderMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headers.forEach((h, i) => {
    if (!map.has(h)) map.set(h, i)
  })
  return map
}

export type HeaderAliases = Record<string, string[]>

/**
 * Resolve logical field names to column indices using an aliases map.
 * For each logical field, tries each alias in order; first match wins.
 * Logical fields with no matching alias are absent from the result.
 */
export function resolveAliases(
  headerMap: Map<string, number>,
  aliases: HeaderAliases,
): Map<string, number> {
  const resolved = new Map<string, number>()
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const idx = headerMap.get(name)
      if (idx !== undefined) {
        resolved.set(field, idx)
        break
      }
    }
  }
  return resolved
}

/** Look up a row value by logical field name (via the alias-resolved map). */
export function colByField(
  row: string[],
  fieldMap: Map<string, number>,
  field: string,
): string {
  const idx = fieldMap.get(field)
  return idx !== undefined ? (row[idx] ?? '') : ''
}

/** Look up a row value by raw column index (for positional resolution). */
export function colByIndex(row: string[], idx: number | undefined): string {
  return idx !== undefined ? (row[idx] ?? '') : ''
}

/**
 * Parse a Metrc-style numeric cell. Strips `%`, thousand separators, and
 * common nullish markers (`-`, `N/A`, blank). Returns null on parse failure.
 */
export function parseNumber(val: string): number | null {
  if (!val || val === '-' || val.toUpperCase() === 'N/A') return null
  const cleaned = val.replace(/%$/, '').replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/** Parse a Metrc bool cell. Accepts `true`/`yes`/`1` (case-insensitive). */
export function parseBool(val: string): boolean {
  const v = val.toLowerCase().trim()
  return v === 'true' || v === 'yes' || v === '1'
}

/**
 * Parse a Metrc datetime cell. Returns ISO string or null. Metrc UI exports
 * use `MM/DD/YYYY HH:MM:SS` (no timezone) in facility-local time. We round-
 * trip via Date and let the caller decide on timezone handling.
 */
export function parseDateTime(val: string): string | null {
  if (!val) return null
  const trimmed = val.trim()
  if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'N/A') return null
  const d = new Date(trimmed)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
