import { describe, it, expect } from 'vitest';
import { __selectToolsForQueryForTest } from '../copilot-service';
import type { ToolDefinition } from '../openrouter-client';

function defineTools(names: string[]): ToolDefinition[] {
  return names.map(name => ({
    type: 'function' as const,
    function: {
      name,
      description: '',
      parameters: { type: 'object' as const, properties: {}, required: [] },
    },
  }));
}

describe('selectToolsForQuery', () => {
  it('returns an empty list when no keyword category matches the query', () => {
    const tools = defineTools(['get_inventory_overview', 'analyze_aging', 'compare_strains']);
    const result = __selectToolsForQueryForTest('xyzzy plover quux', tools);
    expect(result).toEqual([]);
  });

  it('returns the matched category tools (not the whole catalog) when a keyword fires', () => {
    // "fragmentation" should match the consolidation/fragmentation category
    const tools = defineTools([
      'detect_fragmentation',
      'get_consolidation_recommendations',
      'find_sample_out_candidates',
      'analyze_aging',
      'get_inventory_overview',
    ]);
    const result = __selectToolsForQueryForTest('detect fragmentation in vault', tools);
    const names = result.map(t => t.function.name);
    expect(names).toContain('detect_fragmentation');
    // Tools from unrelated categories should NOT appear when a category matched
    expect(names).not.toContain('analyze_aging');
  });
});
