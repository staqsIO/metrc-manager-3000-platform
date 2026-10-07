/**
 * facility-matcher.ts — Match CSV facility names/licenses to MetrcFacility IDs
 *
 * Pure-function module. No React imports.
 */

import type { TransferLineItemInput } from './transfer-csv-parser';

interface FacilityRef {
  id: string;
  licenseNumber: string;
  name: string;
}

export interface MatchResult {
  /** Lines with facilityId assigned (matched "our" side) */
  matched: Array<TransferLineItemInput & { facilityId: string }>;
  /** Lines where neither origin nor destination matched any facility */
  unmatched: TransferLineItemInput[];
  /** Summary of unmatched facility names/licenses with counts */
  unmatchedFacilities: Array<{ name: string; license: string; count: number }>;
}

/**
 * Match CSV transfer lines to facility IDs.
 *
 * For each line, determines which side is "ours" (origin for outgoing, dest for incoming)
 * by matching license numbers and facility names against the provided facility list.
 *
 * A line is considered "outgoing" if the origin matches one of our facilities,
 * and "incoming" if the destination matches. If both match (affiliated transfer
 * between two of our facilities), the origin facility is used.
 */
export function matchFacilities(
  lines: TransferLineItemInput[],
  facilities: FacilityRef[],
): MatchResult {
  // Build lookup indexes
  const byLicense = new Map<string, FacilityRef>();
  const byNameLower = new Map<string, FacilityRef>();

  for (const f of facilities) {
    byLicense.set(f.licenseNumber.trim().toUpperCase(), f);
    byNameLower.set(f.name.trim().toLowerCase(), f);
  }

  function findFacility(license: string, name: string): FacilityRef | null {
    // 1. Exact license match
    const byLic = byLicense.get(license.trim().toUpperCase());
    if (byLic) return byLic;
    // 2. Case-insensitive name match
    const byName = byNameLower.get(name.trim().toLowerCase());
    if (byName) return byName;
    return null;
  }

  const matched: Array<TransferLineItemInput & { facilityId: string }> = [];
  const unmatched: TransferLineItemInput[] = [];
  const unmatchedMap = new Map<string, { name: string; license: string; count: number }>();

  for (const line of lines) {
    const originMatch = findFacility(line.originLicenseNumber, line.originFacilityName);
    const destMatch = findFacility(line.destLicenseNumber, line.destFacilityName);

    // Prefer origin (outgoing from our facility), fall back to dest (incoming)
    const match = originMatch ?? destMatch;

    if (match) {
      matched.push({ ...line, facilityId: match.id });
    } else {
      unmatched.push(line);
      // Track both sides as unmatched
      for (const [license, name] of [
        [line.originLicenseNumber, line.originFacilityName],
        [line.destLicenseNumber, line.destFacilityName],
      ] as const) {
        const key = `${license}|${name}`;
        const existing = unmatchedMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          unmatchedMap.set(key, { name, license, count: 1 });
        }
      }
    }
  }

  return {
    matched,
    unmatched,
    unmatchedFacilities: Array.from(unmatchedMap.values())
      .sort((a, b) => b.count - a.count),
  };
}
