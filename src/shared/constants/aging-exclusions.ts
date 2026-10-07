import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Locations whose contents are long-term storage and should be excluded
 * from aging analysis (FIFO violations, aging buckets, slow-moving detection,
 * AI Insights aging line).
 *
 * Phase 1: heuristic pattern match on location name. Catches the canonical
 * cases (seed banks, genetics libraries, mother stock rooms, tissue culture
 * labs, clone libraries) without requiring schema or UI changes.
 *
 * Phase 2 (deferred): per-location `excludeFromAging` toggle in facility
 * settings, backed by a `LocationSnapshot.excludeFromAging` column. The
 * keyword heuristic becomes the auto-suggestion on first sync.
 *
 * Why this is a behavior change at the engine level (not the caller level):
 * every aging-related consumer (Aging page, AI Insights, Copilot briefing,
 * audit engine, auto-discount preview) wants the same exclusion. Filtering
 * inside engines means a future caller can't accidentally re-introduce noisy
 * seed-bank-driven alerts.
 */
const PATTERN = /seed[\s_-]?bank|genetics|mother[\s_-]?(stock|room)|tissue[\s_-]?culture|clone[\s_-]?library/i;

export function isLongTermStorageLocation(name: string | null | undefined): boolean {
  if (!name) return false;
  return PATTERN.test(name);
}

/**
 * Returns the list of location names on a facility that match the long-term
 * storage heuristic. Used to build Prisma `notIn` clauses for count queries
 * in routers (e.g., inventory.getAgingSummary).
 *
 * Empty array means no exclusions apply — callers should treat that as
 * "include everything".
 *
 * Source: `packageSnapshot.locationName` (NOT `LocationSnapshot`). The
 * Locations table is unreliable per facility — the Northfield site has
 * 789 packages across `Autoflower_Seed_Bank` + `Full-Term_Seed_Bank` but
 * zero rows in `LocationSnapshot`. Querying the package table directly
 * uses the actual locationName values the aging engine will see, so the
 * `notIn` filter always matches reality.
 */
export async function getLongTermStorageLocations(
  prisma: PrismaClient,
  facilityId: string,
): Promise<string[]> {
  const rows = await prisma.packageSnapshot.findMany({
    where: { facilityId, isActive: true, locationName: { not: null } },
    select: { locationName: true },
    distinct: ['locationName'],
  });
  return rows
    .map((r) => r.locationName)
    .filter((n): n is string => !!n)
    .filter(isLongTermStorageLocation);
}

/**
 * Build a Prisma where fragment that excludes long-term storage locations.
 * Returns `undefined` when no exclusions apply so callers can spread cleanly:
 *
 *   const exclusion = await buildAgingExclusionWhere(prisma, facilityId);
 *   await prisma.packageSnapshot.count({
 *     where: { facilityId, isActive: true, ...(exclusion ?? {}) },
 *   });
 */
export async function buildAgingExclusionWhere(
  prisma: PrismaClient,
  facilityId: string,
): Promise<Prisma.PackageSnapshotWhereInput | undefined> {
  const excluded = await getLongTermStorageLocations(prisma, facilityId);
  if (excluded.length === 0) return undefined;
  return { locationName: { notIn: excluded } };
}
