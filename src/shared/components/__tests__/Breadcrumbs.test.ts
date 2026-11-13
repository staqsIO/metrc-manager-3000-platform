import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SEGMENTS_WITHOUT_PAGE } from '@/shared/components/Breadcrumbs';

const FACILITY_DIR = join(__dirname, '../../../app/facilities/[facilityId]');

// Every non-dynamic folder under a facility that has no page.tsx of its own.
function foldersWithoutPage(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    // A dynamic segment's crumb is a real id and a route group is not in the URL, so neither
    // needs an entry itself, but folders nested inside them still do.
    const literal = !name.startsWith('[') && !name.startsWith('(');
    if (literal && !existsSync(join(full, 'page.tsx'))) out.push(name);
    out.push(...foldersWithoutPage(full));
  }
  return out;
}

describe('breadcrumb segments without a page', () => {
  it('match the facility folders that have no page.tsx', () => {
    const found = Array.from(new Set(foldersWithoutPage(FACILITY_DIR))).sort();
    expect(found).toEqual(Array.from(SEGMENTS_WITHOUT_PAGE).sort());
  });
});
