import { describe, it, expect } from 'vitest';
import { needsReenrichment } from '@/lib/jwt-freshness';

describe('needsReenrichment', () => {
  const enrichedSec = 1_791_331_200;
  it('is false when the user was never invalidated', () => {
    expect(needsReenrichment(null, enrichedSec)).toBe(false);
    expect(needsReenrichment(null, undefined)).toBe(false);
  });
  it('is true when invalidated after the last enrichment', () => {
    expect(needsReenrichment(new Date((enrichedSec + 1) * 1000), enrichedSec)).toBe(true);
  });
  it('is true when invalidated in the same second as the last enrichment', () => {
    expect(needsReenrichment(new Date(enrichedSec * 1000), enrichedSec)).toBe(true);
    expect(needsReenrichment(new Date(enrichedSec * 1000 + 999), enrichedSec)).toBe(true);
  });
  it('is false when invalidated before the last enrichment', () => {
    expect(needsReenrichment(new Date((enrichedSec - 1) * 1000), enrichedSec)).toBe(false);
    expect(needsReenrichment(new Date((enrichedSec - 30) * 1000), enrichedSec)).toBe(false);
  });
  it('re-enriches a pre-upgrade token (no lastEnrichedAt) once an invalidation exists', () => {
    expect(needsReenrichment(new Date(enrichedSec * 1000), undefined)).toBe(true);
  });
});
