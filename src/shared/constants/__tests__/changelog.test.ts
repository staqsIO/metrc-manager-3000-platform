import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGELOG_ENTRIES } from '@/shared/constants/changelog';

// The changelog page renders a "View feature" link for every entry link without
// [facilityId], so each such link must be a real app route or it 404s.
const APP_DIR = join(__dirname, '../../../app');

describe('changelog links', () => {
  it('has links of both kinds to check', () => {
    // The two checks below assert an empty list, which also passes if no links remain.
    const links = CHANGELOG_ENTRIES.map((e) => e.link).filter((l): l is string => !!l);
    expect(links.some((l) => l.includes('[facilityId]'))).toBe(true);
    expect(links.some((l) => !l.includes('[facilityId]'))).toBe(true);
  });

  it('point at a page that exists, or are marked facility-scoped', () => {
    const broken = CHANGELOG_ENTRIES
      .map((e) => e.link)
      .filter((link): link is string => !!link && !link.includes('[facilityId]'))
      .filter((link) => !existsSync(join(APP_DIR, link, 'page.tsx')));
    expect(broken).toEqual([]);
  });

  it('facility-scoped links name a real facility page', () => {
    const missing = CHANGELOG_ENTRIES
      .map((e) => e.link)
      .filter((link): link is string => !!link && link.includes('[facilityId]'))
      .filter((link) => !existsSync(join(APP_DIR, link, 'page.tsx')));
    expect(missing).toEqual([]);
  });
});
