/**
 * Shared run-rate / median helpers used by /executive, /operations, and
 * the executive sub-pages. Extracted because three near-identical copies
 * of the median-days-of-supply algorithm and three drifting waste-color
 * helpers were scattered across pages.
 *
 * Status colors map to the semantic CSS variables (`--primary`,
 * `--signal-caution`, `--signal-critical`) — never bare Tailwind palette
 * classes — so visual treatment stays in sync with token resets.
 */

// ---------------------------------------------------------------------------
// Median days of supply
// ---------------------------------------------------------------------------

/**
 * Median days-of-supply across a set of facilities. Each facility carries
 * `overallWeeksOfSupply` (null when no velocity data); we collect the
 * non-null values, take the median, and convert to days (×7).
 *
 * Generic over the input shape — works with ComparisonData['facilities'],
 * the cross-facility router output, or any array of objects with the
 * required field.
 */
export function computeMedianDaysOfSupply(
  facilities: { overallWeeksOfSupply: number | null }[],
): number | null {
  const wos = facilities
    .map(f => f.overallWeeksOfSupply)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
  if (wos.length === 0) return null
  const mid = Math.floor(wos.length / 2)
  const median = wos.length % 2 === 1 ? wos[mid]! : (wos[mid - 1]! + wos[mid]!) / 2
  return Math.round(median * 7)
}

// ---------------------------------------------------------------------------
// Waste-rate status colors
// ---------------------------------------------------------------------------

/** Thresholds shared across all callsites. Anything > HIGH is critical. */
export const WASTE_RATE_HIGH = 5
export const WASTE_RATE_WARN = 2

/**
 * Just the text color class for a waste rate. Use when you want to color
 * a single number (e.g. inside a KpiCard `valueClass`).
 */
export function wasteColor(rate: number): string {
  if (rate > WASTE_RATE_HIGH) return 'text-[hsl(var(--signal-critical))]'
  if (rate > WASTE_RATE_WARN) return 'text-[hsl(var(--signal-caution))]'
  return 'text-[hsl(var(--primary))]'
}

/**
 * Both the text class and a soft-fill badge class. Use when rendering a
 * pill/badge that needs a tinted background to stand out in a table cell.
 * `bg` uses /10 opacity over the same semantic color.
 */
export function wasteRateStyle(rate: number): { text: string; bg: string } {
  if (rate > WASTE_RATE_HIGH) {
    return {
      text: 'text-[hsl(var(--signal-critical))]',
      bg: 'bg-[hsl(var(--signal-critical))]/10 text-[hsl(var(--signal-critical))]',
    }
  }
  if (rate > WASTE_RATE_WARN) {
    return {
      text: 'text-[hsl(var(--signal-caution))]',
      bg: 'bg-[hsl(var(--signal-caution))]/10 text-[hsl(var(--signal-caution))]',
    }
  }
  return {
    text: 'text-[hsl(var(--primary))]',
    bg: 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]',
  }
}

/** Just the badge background+text class for a waste rate. */
export function wasteBadgeColor(rate: number): string {
  return wasteRateStyle(rate).bg
}
