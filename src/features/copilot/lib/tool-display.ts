/**
 * Tool-name → human-readable display + visual category for Copilot UI.
 * Action tools (mutations) get an emerald badge; read-only Metrc tools get
 * an amber badge; docs tools (MCP-served Metrc API docs) are purple;
 * `_thinking` is blue; everything else falls back to the brand color.
 */

export const ACTION_TOOL_NAMES = new Set([
  'flag_packages_for_discount',
  'flag_packages_for_testing',
  'remediate_packages_action',
  'finish_packages_action',
  'adjust_package_quantity',
  'finish_harvests_action',
  'create_packages_from_harvest',
  'record_harvest_waste',
  'destroy_plant_batches_action',
  'create_plant_batches_action',
]);

export const METRC_READ_TOOL_NAMES = new Set([
  'get_inventory_overview',
  'analyze_aging',
  'get_aging_recommendations',
  'detect_fifo_violations',
  'detect_slow_moving',
  'run_compliance_audit',
  'evaluate_business_rules',
  'detect_fragmentation',
  'get_consolidation_recommendations',
  'find_sample_out_candidates',
  'analyze_biomass',
  'assess_fulfillment_risk',
  'analyze_employee_patterns',
  'identify_training_needs',
  'calculate_tolling',
  'search_packages',
  'get_harvest_summary',
  'get_active_harvests',
  'get_plant_batch_summary',
  'get_active_plant_batches',
  'get_active_plants',
  'get_transfer_summary',
  'get_lab_test_results',
  'get_active_strains',
  'get_active_items',
]);

export type ToolCategory = 'action' | 'metrc' | 'docs' | 'thinking' | 'other';

export function getToolDisplayName(tool: string): string {
  if (tool === '_thinking') return 'Thinking';
  if (tool.startsWith('mcp__')) return tool.slice(5).replace(/_/g, ' ');
  if (tool.startsWith('docs__')) return tool.slice(6).replace(/_/g, ' ');
  return tool.replace(/_/g, ' ');
}

export function getToolCategory(tool: string): ToolCategory {
  if (tool === '_thinking') return 'thinking';
  if (ACTION_TOOL_NAMES.has(tool)) return 'action';
  if (METRC_READ_TOOL_NAMES.has(tool) || tool.startsWith('mcp__')) return 'metrc';
  if (tool.startsWith('docs__')) return 'docs';
  return 'other';
}

export function getToolBadgeClass(category: ToolCategory): string {
  switch (category) {
    case 'action': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'metrc': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'docs': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'thinking': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    default: return 'bg-primary/10 text-primary';
  }
}

export function getToolPrefix(category: ToolCategory): string {
  switch (category) {
    case 'action': return 'action: ';
    case 'metrc': return 'metrc: ';
    case 'docs': return 'docs: ';
    default: return '';
  }
}
