/**
 * Cross-facility global search index.
 *
 * Module-level singleton cache with 5-minute TTL, separate from MetrcCachedClient (30s TTL).
 * Stores projected SearchIndexEntry[] per facility for fast text search across all facilities.
 *
 * Cache is keyed by facilityId. Within an org, all users share the same Metrc API credentials
 * per facility (stored on MetrcFacility), so the cached package data is identical regardless
 * of which user triggered the warm. Cross-org access is prevented at the tRPC layer
 * (facility list is scoped by org membership + FacilityAccess grants).
 */

import type { MetrcPackage } from './types';
import { normSearch } from '@/shared/utils/search';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchIndexEntry {
  id: number;
  label: string;           // package tag (e.g., "1A4FF0300...")
  itemName: string;
  strainName: string;
  category: string;
  location: string;
  facilityId: string;
  facilityName: string;
  stateCode: string;
  /** Pre-computed lowercase fields for search (avoids repeated toLowerCase in hot path). */
  _lower: {
    label: string;
    itemName: string;
    strainName: string;
    category: string;
    location: string;
    facilityName: string;
  };
}

interface FacilitySearchCache {
  entries: SearchIndexEntry[];
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

const INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200; // max facility entries in cache (evict oldest on overflow)
const cache = new Map<string, FacilitySearchCache>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns cached search entries for a facility if not expired, null if cold/expired.
 */
export function getSearchIndex(facilityId: string): SearchIndexEntry[] | null {
  const entry = cache.get(facilityId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(facilityId);
    return null;
  }
  return entry.entries;
}

/**
 * Projects packages to SearchIndexEntry[] and stores with 5-minute TTL.
 * Evicts the oldest cache entry if MAX_CACHE_SIZE is exceeded.
 */
export function setSearchIndex(
  facilityId: string,
  facilityName: string,
  stateCode: string,
  packages: MetrcPackage[],
): void {
  const entries: SearchIndexEntry[] = packages.map((pkg) => ({
    id: pkg.Id,
    label: pkg.Label,
    itemName: pkg.ItemName,
    strainName: pkg.ItemStrainName,
    category: pkg.ItemCategory,
    location: pkg.LocationName,
    facilityId,
    facilityName,
    stateCode,
    _lower: {
      label: pkg.Label.toLowerCase(),
      itemName: pkg.ItemName.toLowerCase(),
      strainName: pkg.ItemStrainName.toLowerCase(),
      category: pkg.ItemCategory.toLowerCase(),
      location: pkg.LocationName.toLowerCase(),
      facilityName: facilityName.toLowerCase(),
    },
  }));

  // Evict oldest entry if at capacity (and we're not updating an existing key)
  if (!cache.has(facilityId) && cache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    Array.from(cache.entries()).forEach(([key, entry]) => {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    });
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(facilityId, {
    entries,
    expiresAt: Date.now() + INDEX_TTL_MS,
  });
}

/**
 * Aggregates entries from all cached facilities, applies relevance-scored search,
 * and returns top N results. Only searches warm (cached) facilities — does NOT warm cold ones.
 */
export function searchAcrossFacilities(
  facilityIds: string[],
  query: string,
  limit = 20,
): SearchIndexEntry[] {
  const lowerQuery = query.toLowerCase();
  const scored: { entry: SearchIndexEntry; score: number }[] = [];

  for (const facilityId of facilityIds) {
    const entries = getSearchIndex(facilityId);
    if (!entries) continue;

    for (const entry of entries) {
      const score = computeRelevanceScore(entry, lowerQuery);
      if (score > 0) {
        scored.push({ entry, score });
      }
    }
  }

  // Sort by score descending, then by facilityName ascending for ties
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.facilityName.localeCompare(b.entry.facilityName);
  });

  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Returns observability stats for the search index.
 */
export function getSearchIndexStats(): {
  facilityCount: number;
  totalEntries: number;
  memoryEstimateBytes: number;
} {
  // Clean expired entries
  const now = Date.now();
  Array.from(cache.entries()).forEach(([key, entry]) => {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  });

  let totalEntries = 0;
  Array.from(cache.values()).forEach((entry) => {
    totalEntries += entry.entries.length;
  });

  // Rough estimate: ~250 bytes per entry (strings + pre-computed lowercase + numbers)
  const memoryEstimateBytes = totalEntries * 250;

  return {
    facilityCount: cache.size,
    totalEntries,
    memoryEstimateBytes,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Compute a relevance score for a search entry against a lowercase query.
 * Uses pre-computed _lower fields to avoid repeated toLowerCase() in the hot path.
 * Returns the score for the highest-priority matching field (early return).
 * Returns 0 if no match (entry is filtered out).
 */
function computeRelevanceScore(entry: SearchIndexEntry, lowerQuery: string): number {
  const { _lower } = entry;
  const q = normSearch(lowerQuery);
  const tokens = q.split(/\s+/).filter(Boolean);

  // Normalize all fields once
  const label = normSearch(_lower.label);
  const itemName = normSearch(_lower.itemName);
  const strainName = normSearch(_lower.strainName);
  const category = normSearch(_lower.category);
  const location = normSearch(_lower.location);
  const facilityName = normSearch(_lower.facilityName);

  if (tokens.length <= 1) {
    // Single-word: existing tiered scoring
    if (label === q) return 100;
    if (label.startsWith(q)) return 80;
    if (itemName.includes(q)) return 60;
    if (strainName.includes(q)) return 40;
    if (category.includes(q)) return 20;
    if (location.includes(q)) return 10;
    if (facilityName.includes(q)) return 5;
    return 0;
  }

  // Multi-word: ALL tokens must appear across combined fields
  const combined = [label, itemName, strainName, category, location, facilityName].join(' ');
  if (!tokens.every(t => combined.includes(t))) return 0;

  // Score by highest-priority field containing any token
  if (tokens.some(t => label.includes(t))) return 70;
  if (tokens.some(t => itemName.includes(t))) return 55;
  if (tokens.some(t => strainName.includes(t))) return 35;
  if (tokens.some(t => category.includes(t))) return 15;
  if (tokens.some(t => location.includes(t))) return 8;
  if (tokens.some(t => facilityName.includes(t))) return 3;
  return 1;
}
