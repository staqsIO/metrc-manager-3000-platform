/**
 * Suggestion-chip extraction from assistant content + fallbacks when the LLM
 * doesn't emit any. The LLM contract is an HTML comment block at the end of
 * the response: `<!--suggestions:["foo","bar"]-->`. parseSuggestions strips
 * the comment from the rendered content and returns the parsed array.
 */

const FALLBACK_SUGGESTIONS: Record<string, string[]> = {
  analyze_aging: ['Show FIFO violations', 'Flag aging packages for discount'],
  run_compliance_audit: ['Show detailed findings', 'What needs immediate action?'],
  detect_fifo_violations: ['Show aging recommendations', 'Flag oldest packages'],
  get_inventory_overview: ['Run compliance audit', 'Analyze aging distribution'],
  detect_slow_moving: ['Show aging action plan', 'Find sample-out candidates'],
  detect_fragmentation: ['Show consolidation recommendations', 'Which packages can be merged?'],
  get_consolidation_recommendations: ['Start consolidating packages', 'Show fragmented groups'],
  find_sample_out_candidates: ['Adjust quantities for sampling', 'Show aging packages'],
  get_aging_recommendations: ['Flag packages for discount', 'Flag for expedited testing'],
  evaluate_business_rules: ['Run compliance audit', 'Show rule violations'],
  assess_fulfillment_risk: ['Show transfer summary', 'Check aging inventory'],
  analyze_employee_patterns: ['Identify training needs', 'Show compliance risks'],
  get_harvest_summary: ['Show active harvests', 'Create packages from harvest'],
  get_transfer_summary: ['Assess fulfillment risk', 'Show inventory overview'],
  search_packages: ['Analyze aging for these results', 'Run compliance audit'],
  get_lab_test_results: ['Flag for expedited testing', 'Show compliance status'],
  get_active_strains: ['Show inventory by strain', 'Analyze strain performance'],
};

export function parseSuggestions(content: string): { cleanContent: string; suggestions: string[] } {
  const match = content.match(/<!--\s*suggestions:\s*(\[[\s\S]*?\])\s*-->/);
  if (!match) return { cleanContent: content, suggestions: [] };
  try {
    const suggestions = JSON.parse(match[1]) as string[];
    const cleanContent = content.replace(match[0], '').trimEnd();
    return { cleanContent, suggestions };
  } catch {
    return { cleanContent: content, suggestions: [] };
  }
}

export function getFallbackSuggestions(toolsUsed?: string[]): string[] {
  if (!toolsUsed || toolsUsed.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tool of toolsUsed) {
    const suggestions = FALLBACK_SUGGESTIONS[tool];
    if (suggestions) {
      for (const s of suggestions) {
        if (!seen.has(s)) {
          seen.add(s);
          result.push(s);
        }
      }
    }
  }
  return result.slice(0, 4);
}
