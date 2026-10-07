import { describe, it, expect } from 'vitest';
import * as service from '../copilot-service';
import { renderToolResultsAsMarkdown } from '../copilot-service';

describe('renderToolResultsAsMarkdown (fallback mode)', () => {
  it('renders a deterministic Markdown block per tool with the tool name and its JSON output', () => {
    const md = renderToolResultsAsMarkdown('inventory overview', [
      { name: 'get_inventory_overview', result: JSON.stringify({ totalPackages: 12 }) },
      { name: 'analyze_aging', result: JSON.stringify({ critical: 3 }) },
    ]);

    expect(md).toContain('inventory overview');
    expect(md).toContain('get_inventory_overview');
    expect(md).toContain('"totalPackages":12');
    expect(md).toContain('analyze_aging');
    expect(md).toContain('"critical":3');
    // Per-tool section ordering follows the input order (deterministic, not LLM-summarized).
    expect(md.indexOf('get_inventory_overview')).toBeLessThan(md.indexOf('analyze_aging'));
  });

  it('renders an explicit "no tools matched" message when nothing prefetched', () => {
    const md = renderToolResultsAsMarkdown('xyzzy nonsense', []);
    expect(md).toMatch(/no.*tool/i);
    expect(md).toContain('xyzzy nonsense');
  });
});

describe('keyword fallback responder removal', () => {
  it('does not export the legacy keyword-matching local responder', () => {
    expect((service as Record<string, unknown>).generateLocalResponse).toBeUndefined();
  });

  it('does not declare the legacy responder anywhere in copilot-service.ts', async () => {
    // Source-text scan — a declaration that exists but is unexported would
    // pass the export-shape assertion above. Per parity plan AD4 the
    // function must be deleted, not bypassed.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../copilot-service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/function\s+generateLocalResponse/);
  });
});
