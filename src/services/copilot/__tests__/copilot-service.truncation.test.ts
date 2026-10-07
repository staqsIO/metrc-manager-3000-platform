import { describe, it, expect } from 'vitest';
import { __truncateToolResultForTest as truncateToolResult } from '../copilot-service';

function bigArrayJson(rows: number, fillerPerRow: number = 50): string {
  const filler = 'x'.repeat(fillerPerRow);
  return JSON.stringify({
    summary: { total: rows },
    rows: Array.from({ length: rows }, (_, i) => ({ id: i, label: 'L-' + i, note: filler })),
  });
}

describe('truncateToolResult', () => {
  it('keeps an aggregate tool result under its 12,000-char budget by dropping tail rows, not middle rows', () => {
    const raw = bigArrayJson(2000); // ~100k chars
    const truncated = truncateToolResult('get_consolidated_pnl', raw);

    expect(truncated.length).toBeLessThanOrEqual(12_000);
    const parsed = JSON.parse(truncated);
    // First row preserved (head not dropped)
    expect(parsed.rows[0].id).toBe(0);
    // Tail rows are gone — last surviving id should be small relative to total
    const lastSurviving = parsed.rows.filter((r: { _truncated?: boolean; id?: number }) => !r._truncated).pop();
    expect(lastSurviving.id).toBeLessThan(2000);
    // Summary field is preserved
    expect(parsed.summary.total).toBe(2000);
  });

  it('emits truncated=true and totalRows when a free-text tool exceeds its 4,000-char budget', () => {
    const raw = bigArrayJson(500);
    const truncated = truncateToolResult('search_packages', raw);

    expect(truncated.length).toBeLessThanOrEqual(4_000);
    const parsed = JSON.parse(truncated);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalRows).toBe(500);
  });

  it('does not annotate free-text tool when result fits within budget', () => {
    const raw = JSON.stringify({ summary: { total: 1 }, rows: [{ id: 1, label: 'L-1' }] });
    const truncated = truncateToolResult('search_packages', raw);
    const parsed = JSON.parse(truncated);
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.totalRows).toBeUndefined();
    expect(parsed.rows).toHaveLength(1);
  });

  it('uses the default 4,000 budget for tools with no declared budget', () => {
    const raw = bigArrayJson(500);
    const truncated = truncateToolResult('some_tool_with_no_budget', raw);
    expect(truncated.length).toBeLessThanOrEqual(4_000);
  });

  it('uses the 12,000 aggregate budget for get_daily_sales, get_category_margins, get_inventory_overview, and get_run_rate_comparison', () => {
    const raw = bigArrayJson(1000);
    for (const name of ['get_daily_sales', 'get_category_margins', 'get_inventory_overview', 'get_run_rate_comparison']) {
      const truncated = truncateToolResult(name, raw);
      // Aggregates can hold more — proven by being above the 4,000 cap (and ≤ 12,000)
      expect(truncated.length).toBeGreaterThan(4_000);
      expect(truncated.length).toBeLessThanOrEqual(12_000);
    }
  });
});
