import type { MetrcPackage } from '@/services/metrc/types';
import { calculateAgeDays } from '@/services/metrc/types';
import { computeDataFidelity, buildFidelityPromptBlock } from '@/services/engines/data-fidelity';
import { createAnonymizer } from '@/services/copilot/anonymizer';

// Sync point: metrc-mcp skills/ directory
// Pin: metrc-mcp commit — update when Dan adds new skills
// Last synced: 2026-02-25

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CopilotSuggestion {
  label: string;
  prompt: string;
}

export interface CopilotSkill {
  id: string;
  name: string;
  description: string;
  shortDescription: string;
  toolSequence: string[];
  triggerPhrases: string[];
  category: 'compliance' | 'inventory' | 'operations';
  icon: string;
  /** When set, skill only shows for these facility types. Omit for universal skills. */
  facilityTypes?: string[];
  /** Display tier. 'primary' shows in the default 6-card grid; 'secondary' lives behind "Show more". Defaults to 'secondary' when omitted. */
  priority?: 'primary' | 'secondary';
  /** When set, this template is appended to the system prompt when the user invokes this skill via card click. Locks response shape for deterministic skills. */
  responseTemplate?: string;
}

export const COPILOT_SKILLS: CopilotSkill[] = [
  {
    id: 'needs-attention',
    name: 'Needs Attention',
    description: 'Identify the most urgent compliance and inventory issues that need immediate action — aging packages, failed lab tests, holds, and transfer problems.',
    shortDescription: 'What needs my attention?',
    toolSequence: ['get_harvest_summary', 'get_transfer_summary', 'run_compliance_audit', 'get_aging_recommendations'],
    triggerPhrases: ['What needs my attention?', 'What are the most urgent issues?', 'What should I prioritize today?', 'What should I do today?', 'What do I need to do?'],
    category: 'compliance',
    icon: 'AlertTriangle',
    priority: 'primary',
  },
  {
    id: 'facility-summary',
    name: 'Facility Summary',
    description: 'Get a comprehensive overview of the facility — inventory counts, harvest status, plant batches, active strains, and transfer activity.',
    shortDescription: 'Full facility overview',
    toolSequence: ['get_inventory_overview', 'get_harvest_summary', 'get_plant_batch_summary', 'get_active_strains', 'get_transfer_summary'],
    triggerPhrases: ['Give me a full facility summary', 'What does my facility look like right now?', 'Facility overview'],
    category: 'operations',
    icon: 'Building2',
    priority: 'secondary',
  },
  {
    id: 'inventory-summary',
    name: 'Inventory Summary',
    description: 'Deep dive into current inventory — package counts, category breakdown, aging analysis, and search capabilities.',
    shortDescription: 'Inventory breakdown',
    toolSequence: ['get_inventory_overview', 'search_packages', 'analyze_aging'],
    triggerPhrases: ['Show me my inventory summary', 'What does my inventory look like?', 'Inventory breakdown'],
    category: 'inventory',
    icon: 'Package',
    priority: 'primary',
    responseTemplate: [
      '## Response shape — Inventory Summary',
      'Lead with one bold headline that captures the inventory\'s shape (e.g., **"Inventory is heavily skewed toward Flower (62%) with 89 packages crossing the 90-day mark."**).',
      'Section 1 — `### Snapshot` — markdown table: Category | Packages | Total Qty | Unit (top 8 categories by package count).',
      'Section 2 — `### Aging Distribution` — markdown table: Bucket | Packages | Notes (use buckets 0-30, 31-60, 61-90, 91-180, 180+).',
      'Section 3 — `### Key Takeaways` — 3-5 bullets, each one actionable.',
      'No filler prose. Every number must come from a tool result.',
    ].join('\n'),
  },
  {
    id: 'audit-ready-snapshot',
    name: 'Audit-Ready Snapshot',
    description: 'Generate a compliance audit score with lab testing, aging, holds, location tracking, and data completeness checks. Includes business rule evaluation.',
    shortDescription: 'Am I audit-ready?',
    toolSequence: ['run_compliance_audit', 'evaluate_business_rules', 'get_lab_test_results'],
    triggerPhrases: ['Am I audit-ready?', 'Run a compliance audit', 'What is my audit score?'],
    category: 'compliance',
    icon: 'ShieldCheck',
    priority: 'primary',
    responseTemplate: [
      '## Response shape — Audit-Ready Snapshot',
      'Lead with **`<score>/100 — <label>`** as the very first line (label: Ready / Watch / Not Ready).',
      'Section 1 — `### 🚨 Critical Issues` — bullet list of the top 3 blockers (omit section if zero).',
      'Section 2 — `### Findings by Category` — markdown table: Category | Score | Status | Notes.',
      'Section 3 — `### Next Actions` — numbered list of 3-5 concrete actions, most urgent first.',
      'Skip prose paragraphs. Every number must come from a tool result.',
    ].join('\n'),
  },
  {
    id: 'fifo-aging-pull',
    name: 'FIFO / Aging Pull',
    description: 'Detect FIFO violations and get prioritized recommendations for which aging packages to pull, discount, or destroy first.',
    shortDescription: 'What to pull first?',
    toolSequence: ['detect_fifo_violations', 'analyze_aging', 'get_aging_recommendations'],
    triggerPhrases: ['What should I pull first?', 'Show FIFO violations', 'Which packages are aging out?'],
    category: 'inventory',
    icon: 'ArrowDownUp',
    priority: 'secondary',
  },
  {
    id: 'fragmentation-detection',
    name: 'Fragmentation Detection',
    description: 'Find items split across many small packages that could be consolidated to reduce package count and improve efficiency.',
    shortDescription: 'Find fragmented packages',
    toolSequence: ['detect_fragmentation', 'get_consolidation_recommendations'],
    triggerPhrases: ['Find fragmented inventory', 'Which packages can be consolidated?', 'Detect fragmentation'],
    category: 'inventory',
    icon: 'Layers',
    priority: 'secondary',
  },
  {
    id: 'sample-out-candidates',
    name: 'Sample-Out Candidates',
    description: 'Identify packages suitable for sampling out as trade samples or promotional samples based on low quantity and age.',
    shortDescription: 'What can be sampled out?',
    toolSequence: ['find_sample_out_candidates'],
    triggerPhrases: ['What can I sample out?', 'Find sample-out candidates', 'Which packages are good for trade samples?'],
    category: 'inventory',
    icon: 'FlaskConical',
    priority: 'secondary',
    responseTemplate: `Format your response with these sections:

### Sample-Out Summary
1-2 sentences: total candidates, top categories by count, urgency note (e.g. "X packages are 300+ days old").

### Top Candidates
A markdown table with columns: \`#\` | \`Package\` | \`Product\` | \`Category\` | \`Qty\` | \`Age (d)\`.
Show ALL candidates the tool returned (up to 25 rows), sorted by age descending. Do not truncate the list — operators need every row to make a complete call. If the tool returned more than 25, list 25 and add a final italic line "(and N more — open the Copilot canvas to see the full sortable list)". Show the FULL package label exactly as the tool returned it — do not truncate, abbreviate, or modify it in any way.

### Recommendations for Operator Review
3-5 short bullets. Each bullet names specific packages (by full label) and the recommended NEXT STEP the operator should take in Metrc. Frame as review actions, not commands the system will execute. Examples:
- "Recommended for destruction (review in Metrc) — [labels], [reason]. → Destruction queue."
- "Recommended for trade sampling (log in Metrc Disposition) — [labels], [reason]. → Trade Sample log."
- "Recommended for vendor day (mark in Metrc) — [labels], [reason]. → Vendor day batch."
Lead with the most urgent. Never say "Destroy", "Sample out", "Send", "Move", or any imperative verb that implies the system is performing the action.`,
  },
  {
    id: 'slow-moving-inventory',
    name: 'Slow-Moving Inventory',
    description: 'Detect slow-moving, stagnant, and dead stock packages that haven\'t moved in 45+, 75+, or 120+ days.',
    shortDescription: 'Find idle inventory',
    toolSequence: ['detect_slow_moving', 'analyze_aging'],
    triggerPhrases: ['Show me slow-moving inventory', 'What inventory is sitting idle?', 'Find dead stock'],
    category: 'inventory',
    icon: 'Clock',
    priority: 'secondary',
  },
  {
    id: 'aging-discount-sampling',
    name: 'Aging Discount/Sampling',
    description: 'Get specific recommendations for aging inventory — discounting, sampling out, destruction, remediation, and expedited testing.',
    shortDescription: 'Aging action plan',
    toolSequence: ['get_aging_recommendations', 'find_sample_out_candidates'],
    triggerPhrases: ['What should I do with aging inventory?', 'Aging action plan', 'Which packages should be discounted?', 'What products are aging and need discounts?', 'What products need markdowns?', 'Which inventory needs discounting?'],
    category: 'inventory',
    icon: 'Timer',
    facilityTypes: ['Dispensary', 'Microbusiness'],
    priority: 'primary',
  },
  {
    id: 'package-consolidation',
    name: 'Package Consolidation',
    description: 'Analyze fragmented packages and get specific consolidation recommendations to reduce package counts and improve efficiency.',
    shortDescription: 'Consolidation plan',
    toolSequence: ['detect_fragmentation', 'get_consolidation_recommendations'],
    triggerPhrases: ['How can I consolidate packages?', 'Package consolidation plan', 'Reduce my package count'],
    category: 'operations',
    icon: 'Combine',
    facilityTypes: ['Cultivator', 'Manufacturer', 'Microbusiness'],
    priority: 'secondary',
  },
  {
    id: 'traceability-lineage',
    name: 'Traceability / Lineage',
    description: 'Trace product lineage from seed to sale — search packages, view active harvests, plant batches, and strain information.',
    shortDescription: 'Trace product lineage',
    toolSequence: ['search_packages', 'get_active_harvests', 'get_active_plant_batches', 'get_active_strains'],
    triggerPhrases: ['Trace the lineage of a package', 'Show me seed-to-sale traceability', 'Where did this product come from?'],
    category: 'compliance',
    icon: 'GitBranch',
    facilityTypes: ['Cultivator', 'Manufacturer', 'Microbusiness'],
    priority: 'secondary',
  },
  {
    id: 'executive-overview',
    name: 'Executive Overview',
    description: 'Get a cross-facility executive summary — operations metrics, financial P&L, run-rate comparison, and compliance posture across all your facilities.',
    shortDescription: 'Big picture across facilities',
    toolSequence: ['get_operations_summary', 'get_consolidated_pnl', 'get_run_rate_comparison'],
    triggerPhrases: ['Give me the big picture', 'Executive summary', 'How is the business doing?', 'Cross-facility overview', 'How are all my facilities?'],
    category: 'operations',
    icon: 'BarChart3',
    priority: 'secondary',
  },
  {
    id: 'sales-analysis',
    name: 'Sales Analysis',
    description: 'Analyze this facility\'s sales performance — revenue trends, category breakdown, and auto-discount impact.',
    shortDescription: 'Revenue & sales analysis',
    toolSequence: ['get_category_margins', 'get_daily_sales', 'get_auto_discount_dashboard_stats'],
    triggerPhrases: ['How are the finances?', 'Show me revenue', 'What are my sales?', 'Sales breakdown', 'Sales analysis'],
    category: 'operations',
    icon: 'DollarSign',
    facilityTypes: ['Dispensary', 'Microbusiness'],
    priority: 'primary',
  },
  {
    id: 'auto-discount-review',
    name: 'Auto-Discount Review',
    description: 'Review the auto-discount engine — check if it is enabled, see active discount performance, and preview what new discounts would be recommended.',
    shortDescription: 'Discount engine status',
    toolSequence: ['get_auto_discount_dashboard_stats', 'preview_auto_discounts'],
    triggerPhrases: ['How are my discounts?', 'Is auto-discount working?', 'What discounts would the engine apply?', 'Preview auto-discounts', 'Show me discount performance'],
    category: 'operations',
    icon: 'Tag',
    facilityTypes: ['Dispensary', 'Microbusiness'],
    priority: 'secondary',
  },
  {
    id: 'tolling-reconciliation',
    name: 'Tolling Reconciliation',
    description: 'Reconcile a tolling agreement — material flow, fee breakdown, yield guarantee variance, and cost-per-gram analysis.',
    shortDescription: 'Reconcile processor fees',
    toolSequence: ['get_tolling_reconciliation'],
    triggerPhrases: ['Reconcile my tolling agreement', 'How much do I owe the processor?', 'Tolling reconciliation', 'Show me the tolling statement'],
    category: 'operations',
    icon: 'Receipt',
    facilityTypes: ['Manufacturer', 'Microbusiness'],
    priority: 'primary',
  },
  {
    id: 'audit-readiness',
    name: 'Full Audit Readiness',
    description: 'Comprehensive audit readiness check — package compliance, employee analysis, recent action history, and reconciliation status with a weighted readiness score.',
    shortDescription: 'Am I ready for an audit?',
    toolSequence: ['get_audit_readiness_report', 'run_compliance_audit', 'evaluate_business_rules'],
    triggerPhrases: ['Am I ready for an audit?', 'Full audit readiness', 'Comprehensive compliance check', 'Audit prep'],
    category: 'compliance',
    icon: 'ClipboardCheck',
    priority: 'secondary',
    responseTemplate: [
      '## Response shape — Full Audit Readiness',
      'Lead with **`<score>/100 — <label>`** as the very first line.',
      'Section 1 — `### 🚨 Critical Findings` — bullet list of blockers with package counts (omit if none).',
      'Section 2 — `### Component Scores` — markdown table: Component | Weight | Score | Notes.',
      'Section 3 — `### Recommended Remediation` — numbered list of 3-5 actions ordered by impact.',
      'Skip prose introductions. Tables only for tabular data.',
    ].join('\n'),
  },
  {
    id: 'disposition-tracking',
    name: 'Disposition Budget Review',
    description: 'Review monthly disposition budget utilization — samples, vendor days, promos, damage, and waste with budget limits, remaining budget, and alerts for categories approaching or exceeding limits.',
    shortDescription: 'How are my disposition budgets?',
    toolSequence: ['get_disposition_summary', 'find_sample_out_candidates'],
    triggerPhrases: ['How are my disposition budgets?', 'Show disposition summary', 'How many samples have I given out?', 'Disposition tracking', 'Sample budget'],
    category: 'compliance',
    icon: 'ClipboardList',
    facilityTypes: ['Manufacturer', 'Dispensary', 'Microbusiness'],
    priority: 'secondary',
  },
  {
    id: 'farm-to-cash',
    name: 'Farm-to-Cash Pipeline',
    description: 'Full pipeline overview from harvest to cash register. Shows product at each stage (post-harvest, testing, processed, retail-ready, in-transit, sold), harvest-to-cash conversion rates, and per-harvest revenue tracking.',
    shortDescription: 'Show my farm-to-cash pipeline',
    toolSequence: ['get_pipeline_summary', 'get_harvest_cash_tracker', 'analyze_inventory_run_rate'],
    triggerPhrases: ['Farm to cash pipeline', 'Show pipeline', 'Where is my product?', 'Harvest to cash', 'Pipeline summary', 'What\'s converting to cash?', 'Product flow'],
    category: 'operations',
    icon: 'GitBranch',
    facilityTypes: ['Cultivator', 'Manufacturer', 'Microbusiness'],
    priority: 'primary',
    responseTemplate: [
      '## Response shape — Farm-to-Cash Pipeline',
      'Lead with one bold sentence stating where the bottleneck is (e.g., **"Pipeline is healthy through processing; 1,840 lbs are stalled at retail-ready awaiting transfer."**).',
      'Section 1 — `### Pipeline Stages` — markdown table: Stage | Quantity | Unit | Avg Age. Stages in order: Post-Harvest, Testing, Processed, Retail-Ready, In-Transit, Sold (last 30d).',
      'Section 2 — `### Conversion Rate` — markdown table: From → To | Conversion % | Notes (harvest→processed, processed→sold).',
      'Section 3 — `### Where to Focus` — 2-3 bullets identifying the choke points and recommended actions.',
      'No paragraphs. Numbers only from tool results.',
    ].join('\n'),
  },
  {
    id: 'waste-analysis',
    name: 'Waste Analysis',
    description: 'Comprehensive waste/loss analysis across all sources — harvest waste, plant batch waste, package adjustments, and plant destruction. Includes waste rate, top reasons, source breakdown, and compliance alerts.',
    shortDescription: 'Analyze waste & loss',
    toolSequence: ['get_waste_analysis', 'get_compliance_alerts'],
    triggerPhrases: ['Show waste analysis', 'How much waste do we have?', 'Waste report', 'What is our waste rate?', 'Waste and loss', 'Analyze waste'],
    category: 'compliance',
    icon: 'Trash2',
    facilityTypes: ['Cultivator', 'Manufacturer', 'Microbusiness'],
    priority: 'secondary',
  },
  // -------------------------------------------------------------------
  // Operator Question Framework v5 — Composite Skills
  // -------------------------------------------------------------------
  {
    id: 'morning-check',
    name: 'Morning Check',
    description: 'Quick daily overview: what do you have, what needs attention, are you compliant, and where are you losing. Combines inventory valuation, slow-moving detection, compliance audit, and loss analysis into a single morning briefing.',
    shortDescription: 'Daily ops briefing',
    toolSequence: ['get_inventory_valuation', 'detect_slow_moving', 'run_compliance_audit', 'get_loss_analysis'],
    triggerPhrases: ['Morning check', 'Daily briefing', 'What do I need to know today?', 'Start of day', 'Daily check-in', 'What happened overnight?'],
    category: 'operations',
    icon: 'Sun',
    priority: 'primary',
    responseTemplate: [
      '## Response shape — Morning Check',
      'Lead with one bold sentence summarizing today\'s posture (e.g., **"You\'re running healthy with one watch item: 12 packages crossed the 90-day FIFO line overnight."**).',
      'Section 1 — `### Today\'s Numbers` — markdown table with 4 rows: Active Packages, Audit Score, Avg Age, Days of Supply (Value column).',
      'Section 2 — `### What Changed Overnight` — bullet list, max 5 items, each prefixed with severity emoji (🚨 / ⚠️ / ✅).',
      'Section 3 — `### Top 3 Actions` — numbered list, ordered by urgency.',
      'No multi-paragraph prose. Every claim must reference a tool result.',
    ].join('\n'),
  },
  {
    id: 'harvest-planning',
    name: 'Harvest Planning',
    description: 'Comprehensive harvest planning: current harvest status, what to make next, yield analysis, and upcoming harvest forecast. Helps plan the next 2 weeks of harvest and processing activity.',
    shortDescription: 'Plan harvests & processing',
    toolSequence: ['get_harvest_summary', 'get_throughput_analysis', 'get_harvest_forecast', 'get_cycle_time_analysis'],
    triggerPhrases: ['Harvest planning', 'What should we harvest?', 'Plan next harvest', 'Harvest schedule', 'What is ready to harvest?', 'Processing plan'],
    category: 'operations',
    icon: 'Sprout',
    facilityTypes: ['Cultivator', 'Microbusiness'],
    priority: 'primary',
  },
  {
    id: 'financial-health',
    name: 'Financial Health',
    description: 'Full financial picture: inventory valuation, pipeline value by stage, loss analysis with dollar impact. Shows operational metrics always, adds dollar values when cost data is connected. Progressive — useful even without financial integrations.',
    shortDescription: 'Financial overview',
    toolSequence: ['get_inventory_valuation', 'get_pipeline_valuation', 'get_loss_analysis'],
    triggerPhrases: ['Financial health', 'Show me the money', 'What is everything worth?', 'Financial overview', 'P&L', 'Value of inventory', 'Where is the money?'],
    category: 'operations',
    icon: 'DollarSign',
    priority: 'secondary',
  },
  {
    id: 'inventory-optimization',
    name: 'Inventory Optimization',
    description: 'Find inventory optimization opportunities: idle packages, expiring material, fragmented inventory, FIFO violations, and top-moving products. Prioritizes actions that recover the most value.',
    shortDescription: 'Optimize inventory',
    toolSequence: ['detect_slow_moving', 'get_expiring_material', 'detect_fragmentation', 'detect_fifo'],
    triggerPhrases: ['Optimize inventory', 'Inventory optimization', 'What should I move?', 'Clean up inventory', 'Reduce waste', 'Inventory action plan'],
    category: 'inventory',
    icon: 'PackageSearch',
    priority: 'secondary',
  },
];

export interface FacilityContext {
  facilityName: string;
  licenseNumber: string;
  stateCode: string;
  /** Facility type — used to gate facility-type-specific suggestion chips. */
  facilityType?: string;
  totalPackages: number;
  totalQuantity: number;
  categoryBreakdown: { category: string; count: number }[];
  agingBreakdown: { bucket: string; count: number }[];
  onHoldCount: number;
  labTestingBreakdown: { state: string; count: number }[];
  topStrains: { strain: string; count: number }[];
  /** Data fidelity prompt block — injected into system prompt when available */
  fidelityBlock?: string;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildFacilityContext(
  facilityName: string,
  licenseNumber: string,
  stateCode: string,
  packages: MetrcPackage[],
  facilityType?: string,
): FacilityContext {
  const categoryMap = new Map<string, number>();
  const labTestMap = new Map<string, number>();
  const strainMap = new Map<string, number>();
  let totalQuantity = 0;
  let onHoldCount = 0;
  const ageBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '180+': 0 };

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];

    // Category
    const cat = pkg.ItemCategory || 'Unknown';
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);

    // Quantity
    totalQuantity += pkg.Quantity || 0;

    // On hold
    if (pkg.IsOnHold) onHoldCount++;

    // Lab testing
    const labState = pkg.LabTestingState || 'Unknown';
    labTestMap.set(labState, (labTestMap.get(labState) || 0) + 1);

    // Strain
    const strain = pkg.ItemStrainName || 'Unknown';
    strainMap.set(strain, (strainMap.get(strain) || 0) + 1);

    // Aging
    const age = calculateAgeDays(pkg.PackagedDate);
    if (age <= 30) ageBuckets['0-30']++;
    else if (age <= 60) ageBuckets['31-60']++;
    else if (age <= 90) ageBuckets['61-90']++;
    else if (age <= 180) ageBuckets['91-180']++;
    else ageBuckets['180+']++;
  }

  // Sort categories by count descending
  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const labTestingBreakdown = Array.from(labTestMap.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);

  const topStrains = Array.from(strainMap.entries())
    .map(([strain, count]) => ({ strain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const agingBreakdown = Object.entries(ageBuckets).map(([bucket, count]) => ({ bucket, count }));

  return {
    facilityName,
    licenseNumber,
    stateCode,
    facilityType,
    totalPackages: packages.length,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    categoryBreakdown,
    agingBreakdown,
    onHoldCount,
    labTestingBreakdown,
    topStrains,
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(context: FacilityContext, options?: { hasDocsTools?: boolean }): string {
  const lines: string[] = [];
  lines.push(`You are the ${getBrand().name} Copilot, an AI-powered assistant for cannabis compliance and inventory management.`);
  lines.push('You help licensed cannabis operators understand their Metrc inventory data, identify compliance risks, and optimize operations.');
  lines.push('');
  lines.push('## Behavior');
  lines.push('- Be concise and actionable. Lead with the most important insight.');
  lines.push('- When the user asks about inventory, aging, compliance, or operations, USE YOUR TOOLS to get real-time data rather than guessing.');
  lines.push('- When recommending actions, be specific about which packages or categories to prioritize.');
  lines.push('- CRITICAL: When the user asks you to DO something (create strains, add plants, create items, make transfers, etc.), USE YOUR ACTION TOOLS to do it for them. Do NOT give manual instructions, API payloads, or tell them to use the Metrc UI. You have action tools — use them. The whole point of this assistant is to execute actions on behalf of the operator.');
  lines.push('');
  lines.push('## Data Accuracy (STRICT)');
  lines.push('- NEVER fabricate, estimate, or round numbers. If a tool did not return a specific number, say "I don\'t have that data" rather than guessing.');
  lines.push('- When presenting numerical breakdowns, every number MUST come directly from a tool result. If the breakdown is not available from tools, say so explicitly.');
  lines.push('- Always state which tool provided each number (e.g., "According to get_inventory_overview, there are 342 active packages").');
  lines.push('- Do NOT fill gaps in data with estimates. If a category or metric is missing from tool results, report it as unavailable.');
  lines.push('- If you cannot answer a question with the available tool data, say "I don\'t have the data to answer that" — never synthesize plausible-sounding numbers.');
  lines.push('- If you need information to complete an action (e.g., strain ID, location name), look it up yourself using read-only tools first. Only ask the user if the information cannot be found in the data.');
  lines.push('');
  lines.push('## Knowledge Enrichment (ask_knowledge_base) — MANDATORY for these query types');
  lines.push('You have a `ask_knowledge_base` tool that queries ' + getBrand().name + '\'s expert KB (compliance regulations, formulation science, manufacturing processes, cultivation best practices, extraction methods). The facility tools alone CANNOT answer formulation, regulatory, or domain-expertise questions — you MUST chain ask_knowledge_base after them for these queries. An answer that only cites inventory tools for a formulation question is INCOMPLETE.');
  lines.push('');
  lines.push('### MUST CALL ask_knowledge_base when the user asks ANY of:');
  lines.push('- Formulation / product development: "what can we make?", "what could we make?", "what should we formulate?", "what products are commercially viable?", "how do I infuse this?", "what new product should we launch?"');
  lines.push('- Biomass utilization: "what can I do with this biomass?", "how should I process this trim?", "what extraction method is best for X?"');
  lines.push('- Process recommendations: "should we do BHO or ethanol?", "what extraction yields are typical?", "what\'s the right cure time?"');
  lines.push('- Regulatory: "is this compliant in MA?", "what are the testing requirements?", "max THC for edibles?", "can we do X?"');
  lines.push('- Industry best practices: "how should we structure pricing?", "what\'s the typical margin on distillate?"');
  lines.push('- Anything where domain expertise (not just facility data) is required to answer well.');
  lines.push('');
  lines.push('### Required call sequence');
  lines.push('1. First call your facility tools (analyze_biomass, get_inventory_overview, etc.) to gather concrete context.');
  lines.push('2. Then ALWAYS call ask_knowledge_base. The question MUST start with the user\'s original intent phrasing verbatim ("I want to formulate", "What can we make", "Is X compliant", etc.) so the multiagent router picks the right specialist agent. Then append the gathered inventory/context. Do not stop after step 1 for these query types.');
  lines.push('   GOOD: "I want to formulate new products. We have 12kg of MA-grown trim and 3kg of fresh frozen. Which extraction methods are commercially viable in MA?"');
  lines.push('   BAD:  "We have 12kg of trim and 3kg of fresh frozen in MA. What is commercially viable?" (lost the intent verb — router can\'t tell formulation from operations)');
  lines.push('   BAD:  "What can we make?" (too generic — KB returns textbook answers)');
  lines.push('3. Always pass the state code via the `state` parameter for compliance/regulatory questions.');
  lines.push('4. Synthesize the KB response WITH your facility data into a single grounded recommendation. Cite both sources.');
  lines.push('');
  lines.push('### If ask_knowledge_base errors');
  lines.push('If the tool returns a JSON object with an `error` field, you MUST paste the literal error string verbatim into your response, inside triple backticks. Do not paraphrase, summarize, or omit the error.');
  lines.push('Required format:');
  lines.push('  > Knowledge base returned an error and could not enrich this answer:');
  lines.push('  > ```');
  lines.push('  > <paste the exact error string from the tool response, character-for-character>');
  lines.push('  > ```');
  lines.push('  > My answer below is grounded in inventory data only.');
  lines.push('Then continue with your facility-data-only answer. NEVER silently skip enrichment, and NEVER abstract the error to "an error occurred" — the literal text is needed for diagnostics.');
  lines.push('');
  lines.push('## Formatting Rules');
  lines.push('Your responses are rendered in a chat panel. Follow these formatting rules strictly:');
  lines.push('');
  lines.push('### Structure');
  lines.push('- Start EVERY response with a **1-2 sentence summary** of the key finding or answer.');
  lines.push('- Use `---` horizontal rules between major sections to create visual breathing room.');
  lines.push('- Use `###` headers (not `##`) for section titles — keep them short (3-5 words).');
  lines.push('- Use bullet points for lists, NOT numbered lists with long explanations.');
  lines.push('- Keep paragraphs to 1-2 sentences max. Avoid multi-sentence blocks of text.');
  lines.push('');
  lines.push('### Data Presentation');
  lines.push('- Use **markdown tables** whenever presenting counts, quantities, or comparisons.');
  lines.push('- Tables are much more scannable than dense paragraphs. Use them liberally.');
  lines.push('- When listing numbers (package counts, percentages, quantities), prefer tables over bullet lists.');
  lines.push('');
  lines.push('### Read-Only Mode');
  lines.push('- You ANALYZE and RECOMMEND. The user executes in Metrc — you never do.');
  lines.push('- Frame every recommendation as a step the operator should take in Metrc, never as something the system will do.');
  lines.push('- Use review-language, not imperatives:');
  lines.push('  • Say "Recommended for destruction (review and confirm in Metrc)" — NOT "Destroy now" or "Destroy immediately".');
  lines.push('  • Say "Flag for sampling (log in Metrc Disposition)" — NOT "Sample out today".');
  lines.push('  • Say "Mark for vendor day (record in Metrc)" — NOT "Send to vendor day".');
  lines.push('- Where possible, name the destination so operators see *where* to act next, e.g. "→ Destruction queue", "→ Trade Sample log", "→ Disposition tracking".');
  lines.push('- Never imply the system has acted, will act, or has scheduled an action. The user owns every Metrc mutation.');
  lines.push('');
  lines.push('### Package Labels');
  lines.push('- Package labels are long (24+ chars). In prose and tables, truncate to the last 8 characters: write `…00000077` instead of `AAAFF0B00000B69000000077`.');
  lines.push('- **EXCEPT**: any string matching the pattern `__TYPE_NNN__` (e.g. `__TAG_0017__`, `__FAC_001__`, `__MFST_005__`, `__STRAIN_023__`) is an internal identifier — preserve it VERBATIM in your response. Never truncate, abbreviate, prefix with `…`/`...`, drop the leading or trailing underscores, or wrap in `*`/`_` formatting.');
  lines.push('- **CRITICAL**: When calling action tools (flag_packages_for_discount, flag_packages_for_testing, etc.), ALWAYS pass the FULL label string (e.g., `AAAFF0B00000B69000000077`), NOT the truncated display form. The tool looks up packages by exact label.');
  lines.push('- If listing 3+ packages, ALWAYS use a table. Show at most 3-5 examples, then say "(and X more)".');
  lines.push('');
  lines.push('### Brevity');
  lines.push('- Maximum 3 examples per finding. Summarize the rest with a count.');
  lines.push('- Do NOT repeat information from the summary in the details section.');
  lines.push('- If tool returns 50+ items, do NOT list them. Give the count, top 3, and a recommendation.');
  lines.push('- Favor a single recommendation with a clear action over listing every option.');
  lines.push('');
  lines.push('## Search Behavior');
  lines.push('- When a user asks about specific products (e.g., "distillate bulk", "live rosin", "gummies"), call search_packages with their exact words in the `query` parameter.');
  lines.push('- Do NOT use get_inventory_overview to answer product-specific questions — it only returns category-level summaries with limited examples.');
  lines.push('- Do NOT guess or decompose the user\'s search into category names. Metrc category names (e.g., "Concentrate (Bulk)") often don\'t match how users describe products (e.g., "distillate bulk"). The `query` parameter searches across ALL fields and is much more accurate.');
  lines.push('');
  lines.push('## Available Capabilities');
  lines.push('You have access to tools that analyze the live Metrc inventory for this facility:');
  lines.push('- Inventory overview and package search');
  lines.push('- Aging distribution analysis and recommendations (discount, sample-out, destroy)');
  lines.push('- FIFO violation detection');
  lines.push('- Slow-moving/stagnant/dead stock detection');
  lines.push('- Compliance audit scoring (lab testing, aging, holds, location, data completeness)');
  lines.push('- Business rule evaluation');
  lines.push('- Package fragmentation and consolidation recommendations');
  lines.push('- Sample-out candidate identification');
  lines.push('- Biomass/waste utilization analysis');
  lines.push('- Fulfillment risk assessment with transfer velocity');
  lines.push('- Employee activity pattern analysis and training needs');
  lines.push('- Tolling economics calculator');
  lines.push('- OpEx model listing and KPI summaries (revenue, cost, margin, profit)');
  lines.push('- OpEx model detail inspection (all cell values by section)');
  lines.push('- OpEx what-if simulation (change inputs, see recalculated KPIs without saving)');
  lines.push('- Auto-discount engine monitoring (enabled status, active discounts, revenue impact, preview plan)');
  lines.push('- Consolidated P&L across all facilities (revenue, cost, margin by facility/state/type)');
  lines.push('- Per-category margin analysis from POS data (revenue, COGS, margin %)');
  lines.push('- Tolling reconciliation statements (material flow, fee breakdown, yield guarantee variance)');
  lines.push('- Cross-facility operations summary (executive-level KPI aggregation)');
  lines.push('- Cross-facility run-rate comparison (weeks of supply by category across facilities)');
  lines.push('- Cross-facility inventory summary (total weight/quantity by category across all facilities)');
  lines.push('- Comprehensive audit readiness reports (employee analysis, action log, reconciliation status)');
  lines.push('- Daily sales breakdown from POS (revenue trend, transaction count, avg order value)');
  lines.push('- Tolling breakeven analysis (find yield % where two partners cost the same)');
  lines.push('');
  lines.push('## Action Capabilities');
  lines.push('You can also EXECUTE actions on the user\'s behalf in Metrc:');
  lines.push('- Flag packages for discount (add note)');
  lines.push('- Flag packages for expedited lab testing (add note)');
  lines.push('- Flag packages for remediation');
  lines.push('- Finish/destroy packages (remove from active inventory)');
  lines.push('- Adjust package quantities (sample out)');
  lines.push('- Finish harvests (mark as complete)');
  lines.push('- Create packages from harvest (harvest → package conversion)');
  lines.push('- Record harvest waste (log waste/trim)');
  lines.push('- Destroy plant batches (remove plant batches)');
  lines.push('- Create plant batches (start new seed/clone batches)');
  lines.push('');
  lines.push('## Entity Management Tools');
  lines.push('You can create and manage Metrc entities directly using these action tools:');
  lines.push('- create_strain_action: Create new strains with genetics info (indica/sativa %, THC/CBD levels)');
  lines.push('- create_item_action: Create product items (requires category + unit of measure)');
  lines.push('- create_location_action: Create rooms/locations (requires location type)');
  lines.push('- change_plant_growth_phase_action: Move plant batches between growth phases (Vegetative/Flowering)');
  lines.push('- create_incoming_transfer_action: Create incoming transfer manifests (packages shipped to this facility)');
  lines.push('- record_lab_test_action: Record lab test results on packages');
  lines.push('- create_processing_package_action: Create packages from source packages (processing/manufacturing)');
  lines.push('All require confirmed=false first (preview), then confirmed=true after user confirms.');
  lines.push('');
  lines.push('IMPORTANT RULES for actions:');
  lines.push('- When an action requires data you do not have (e.g., strain ID, location names), use read-only tools to look it up AUTOMATICALLY — do not ask the user to find it for you or give them manual steps.');
  lines.push('- Briefly describe what you plan to do, then CALL THE ACTION TOOL with confirmed=false to preview. Do not stop at just describing — always proceed to the tool call.');
  lines.push('- For DESTRUCTIVE actions (finish/destroy packages, destroy plant batches), you MUST describe the impact and ask "Should I proceed?" BEFORE calling the tool. Wait for explicit confirmation.');
  lines.push('- For CREATION actions (create packages from harvest, create plant batches, create strains/items/locations, create transfers, processing packages), call with confirmed=false first to preview, then confirmed=true after user confirms.');
  lines.push('- After a CREATION action succeeds, tell the user it was created successfully. If they say they cannot see it, tell them to refresh the page — do NOT call the create action again. Use the read-only tool (e.g., get_active_strains) to verify it exists before attempting to re-create.');
  lines.push('- NEVER re-create an entity that was just successfully created. If the user says "I don\'t see it", the data is cached — advise them to refresh the page or wait a moment.');
  lines.push('- For non-destructive actions (flagging, notes, recording waste), you may execute after describing what you\'ll do.');
  lines.push('- Always report results: how many items were affected and what changed.');
  lines.push('- Maximum 50 items per action call.');
  if (options?.hasDocsTools) {
    lines.push('');
    lines.push('## Metrc Documentation Search');
    lines.push('You have access to tools prefixed with `docs__` that search official Metrc compliance documentation across 17 states.');
    lines.push('Use these tools when the user asks about:');
    lines.push('- State-specific regulations, compliance requirements, or labeling rules');
    lines.push('- "How does Metrc handle X?" or "What are the rules for Y in Colorado?"');
    lines.push('- API endpoint documentation or field definitions');
    lines.push('- Differences between state programs');
  }
  lines.push('');
  lines.push('## Tool Selection Guide');
  lines.push('- **Read-only tools** (no suffix): Use for analytics, intelligence, scoring — analyze_aging, detect_fifo, run_compliance_audit, etc.');
  lines.push('- **Action tools** (_action suffix): Use for creating/modifying Metrc entities — strains, items, locations, plant batches, transfers, lab tests, processing packages.');
  if (options?.hasDocsTools) {
    lines.push('- **docs__ tools**: Use for regulatory questions, compliance rules, "how does Metrc handle X?" questions.');
  }
  lines.push('- When in doubt, prefer read-only tools for analysis. Use action tools for Metrc entity management.');
  lines.push('');
  lines.push('### Common Question Routing');
  lines.push('- "What products are aging/need discounts?" → detect_slow_moving + get_aging_recommendations (NOT get_inventory_overview)');
  lines.push('- "What should I do today?" / "What needs attention?" → get_harvest_summary + get_transfer_summary + run_compliance_audit + get_aging_recommendations');
  lines.push('- "Find packages that need lab testing" → search_packages (with lab_testing_state="NotSubmitted") or get_lab_test_results (NOT flag_packages_for_testing, which is an ACTION that writes notes)');
  lines.push('- "What inventory is sitting idle?" → detect_slow_moving');
  lines.push('- "Am I compliant?" / "Run an audit" → run_compliance_audit + evaluate_business_rules');
  lines.push('- "How are my discounts doing?" / "Is auto-discount on?" → get_auto_discount_dashboard_stats');
  lines.push('- "Show me the P&L" / "Revenue by state" → get_consolidated_pnl (with group_by)');
  lines.push('- "Which categories make the most money?" → get_category_margins');
  lines.push('- "How are sales this week?" → get_daily_sales');
  lines.push('- "Give me the big picture" / "Executive summary" → get_operations_summary');
  lines.push('- "Where should we transfer inventory?" → get_run_rate_comparison');
  lines.push('- "How much total weight/inventory across all facilities?" → get_cross_facility_inventory_summary');
  lines.push('- "Am I ready for an audit?" → get_audit_readiness_report');
  lines.push('- "Reconcile my tolling agreement" → get_tolling_reconciliation (needs agreement_id)');
  lines.push('- "At what yield does Partner A beat Partner B?" → find_tolling_breakeven');
  lines.push('- "What do we have and what is it worth?" / "Inventory value" → get_inventory_valuation');
  lines.push('- "What is the value at each pipeline stage?" → get_pipeline_valuation');
  lines.push('- "Where are we losing money?" / "Loss analysis" → get_loss_analysis');
  lines.push('- "What material is expiring?" / "At risk of expiry" → get_expiring_material');
  lines.push('- "Transfer loss from harvest to product" / "Where is weight lost?" → get_transfer_loss');
  lines.push('- "What batches are ready to harvest?" / "Harvest forecast" → get_harvest_forecast');
  lines.push('- "Average days to harvest by strain" / "Cycle time" → get_cycle_time_analysis');
  lines.push('- "Processing throughput vs harvest intake" / "Am I keeping up?" → get_throughput_analysis');
  lines.push('- "Plant count vs license limit" / "Plant compliance" → get_plant_compliance (needs plant_limit)');
  lines.push('');
  lines.push('## Methodology Reference');
  lines.push('When a user asks "how is this calculated?", "what does this number mean?", or questions about methodology, cite the exact formulas and thresholds below. Never guess — always reference this section.');
  lines.push('');
  lines.push('### Run Rates & Weeks of Supply');
  lines.push('- weeklyRate = totalQuantitySold / (lookbackDays / 7)');
  lines.push('- weeksOfSupply = currentInventory / weeklyRate');
  lines.push('- Supply status: Critical (<1 wk), Low (1-4 wk), Healthy (4-12 wk), Excess (>12 wk)');
  lines.push('- Data source priority: 1) Dutchie POS → 2) Metrc retail sales (synced receipts) → 3) Historical transfers (imported CSV) → 4) Live Metrc transfer API');
  lines.push('- The lookback window is user-selected (7d, 14d, 30d, 60d, 90d, 6mo, 1yr, all-time). Only sales within that window are counted.');
  lines.push('');
  lines.push('### Compliance Audit Score (0-100)');
  lines.push('- Starts at 100, deducts penalty points for each triggered rule');
  lines.push('- Rule severities: CRITICAL (larger penalty) > WARNING (smaller penalty)');
  lines.push('- Categories: aging, inventory, lab testing, transfers, general compliance');
  lines.push('');
  lines.push('### Aging Analysis');
  lines.push('- Age = days since PackagedDate (from Metrc)');
  lines.push('- Buckets: Fresh (0-14d), Normal (15-44d), Aging (45-89d), Critical (90+d)');
  lines.push('- Recommended discount by age: 15% (45-59d), 25% (60-89d), 35% (90-119d), 50% (120+d)');
  lines.push('');
  lines.push('### FIFO Violations');
  lines.push('- Groups packages by (category + strain). When strain is empty (common for manufactured products), falls back to item name');
  lines.push('- Only compares same-product different batches — different strains/products in the same category are NOT compared');
  lines.push('- Category-aware minimum gap: Flower/Buds/Raw Pre-Rolls (7d), Infused Beverages/Infused Pre-Rolls (14d), Concentrates/Vape/Edibles/Tinctures/Topicals (30d), Default (14d)');
  lines.push('- Severity relative to category threshold: Critical (4x+ threshold), High (2x+), Medium (1.5x+), Low (1x+)');
  lines.push('');
  lines.push('### Biomass Value Degradation');
  lines.push('- Exponential decay: value = max(floor, e^(-λt)) where λ = ln(2)/halfLife');
  lines.push('- Half-lives by category: Wet Whole Plants (5d), Shake/Trim (45d), Extraction Buds (60d), Plant/Harvest Waste (30d), Default (45d)');
  lines.push('- Value floors: Wet Plants 10%, Shake/Trim 15%, Extraction Buds 20%, Waste 5%, Default 10%');
  lines.push('- Typical yields: Live Resin ~8%, Extraction 18-22%, Pre-Rolls ~85%');
  lines.push('- Post-processing modifiers: CRC (×0.88), Winterization (×0.92), Distillation (×0.85)');
  lines.push('');
  lines.push('### Testing Risk Assessment');
  lines.push('- Based on historical pass/fail rate per (strain, testType)');
  lines.push('- Risk levels: Critical (≤60% pass rate), High (≤75%), Medium (≤85%), Low (>85%)');
  lines.push('- Confidence: High (≥10 historical tests), Medium (5-9), Low (<5)');
  lines.push('');
  lines.push('### Auto-Discount Scoring (0-110 composite)');
  lines.push('- Components: Age (0-40 pts) + Quantity (0-20) + Velocity (0-20) + Category (0-20) + Margin (0-10)');
  lines.push('- Priority thresholds: Urgent (≥70), High (≥50), Medium (≥30), Low (<30)');
  lines.push('- Guard rail: discount never prices a package below COGS');
  lines.push('');
  lines.push('### Audit Readiness (0-100 weighted)');
  lines.push('- Package audit accuracy: 60% weight');
  lines.push('- Employee activity patterns: 20% weight');
  lines.push('- Recent activity score: 20% weight');
  lines.push('- Levels: Ready (≥80), At Risk (60-79), Not Ready (<60)');
  lines.push('- When Canix ERP is connected, ERP match rate and bypass penalties factor into the activity score');
  lines.push('');
  lines.push('### COGS Waterfall');
  lines.push('- Resolves cost per package using this priority (with confidence scores):');
  lines.push('  1. Canix Purchase Order (1.0) → 2. Canix Standard Cost (0.95) → 3. Canix BOM rollup (0.9) → 4. Dutchie unit cost (0.7) → 5. Manual OpEx (0.5) → 6. Dutchie inferred from sell price (0.3) → 7. None (0)');
  lines.push('- BOM cost = sum of (component quantity × unit cost) for each input ingredient');
  lines.push('');
  lines.push('### Disposition Budget');
  lines.push('- 5 categories: sample, vendor_day, promo, damage, waste');
  lines.push('- Each category has monthly unit and value limits set per facility');
  lines.push('- Status: OK (under limits), Warning (approaching limits), Exceeded (over limits)');
  lines.push('');
  lines.push('### Tolling Reconciliation');
  lines.push('- Yield% = (output weight / input weight) × 100');
  lines.push('- Yield variance = actual yield% − guaranteed yield% from agreement');
  lines.push('- Cost-per-gram = total fees / output weight in grams');
  lines.push('');
  lines.push('### Short Count Detection');
  lines.push('- Infers standard case size per item using the statistical mode (most common quantity)');
  lines.push('- Flags packages where quantity is not an exact multiple of the inferred case size');
  lines.push('- Indicates potential receiving errors or counting discrepancies');
  lines.push('');
  lines.push('## Skills (Recommended Workflows)');
  lines.push('When the user asks a broad question, use these multi-tool workflows:');
  for (const skill of COPILOT_SKILLS) {
    lines.push('');
    lines.push('### ' + skill.name);
    lines.push('Triggers: ' + skill.triggerPhrases.map(p => '"' + p + '"').join(', '));
    lines.push('Tools to call in sequence: ' + skill.toolSequence.join(' → '));
  }
  lines.push('');
  lines.push('## Response Format');
  lines.push('- End every response with a hidden suggestion block containing 2-4 follow-up actions:');
  lines.push('  <!-- suggestions: ["suggestion 1", "suggestion 2", "suggestion 3"] -->');
  lines.push('- Suggestions should be natural follow-up questions or actionable next steps.');
  lines.push('- Examples: "Run compliance audit", "Show me aging packages", "Flag these for discount", "What are the FIFO violations?"');
  lines.push('- Make suggestions contextually relevant to what you just discussed.');
  lines.push('- ALWAYS include this block at the very end of your response.');
  lines.push('');
  if (context.fidelityBlock) {
    lines.push('## Data Availability');
    lines.push(context.fidelityBlock);
    lines.push('');
  }
  lines.push('## Current Facility Context');
  lines.push('- Facility: ' + context.facilityName);
  lines.push('- License: ' + context.licenseNumber);
  lines.push('- State: ' + context.stateCode);
  lines.push('- Total Active Packages: ' + context.totalPackages);
  lines.push('- Total Quantity: ' + context.totalQuantity);
  lines.push('- On Hold: ' + context.onHoldCount);
  lines.push('');
  lines.push('## Category Breakdown');
  for (let i = 0; i < context.categoryBreakdown.length; i++) {
    const c = context.categoryBreakdown[i];
    lines.push('- ' + c.category + ': ' + c.count + ' packages');
  }
  lines.push('');
  lines.push('## Aging Distribution');
  for (let i = 0; i < context.agingBreakdown.length; i++) {
    const a = context.agingBreakdown[i];
    lines.push('- ' + a.bucket + ' days: ' + a.count + ' packages');
  }
  lines.push('');
  lines.push('## Lab Testing Status');
  for (let i = 0; i < context.labTestingBreakdown.length; i++) {
    const l = context.labTestingBreakdown[i];
    lines.push('- ' + l.state + ': ' + l.count + ' packages');
  }
  lines.push('');
  lines.push('## Top Strains');
  for (let i = 0; i < context.topStrains.length; i++) {
    const s = context.topStrains[i];
    lines.push('- ' + s.strain + ': ' + s.count + ' packages');
  }

  return lines.join('\n');
}

/**
 * Compact system prompt for self-hosted LLMs (Llama 3.3 etc.).
 * ~800 tokens vs ~3,500 tokens for the full prompt. Focuses on tool-use
 * behavior and facility context, strips verbose capability lists and skills.
 */
function buildCompactSystemPrompt(context: FacilityContext): string {
  const lines: string[] = [];
  lines.push(`You are the ${getBrand().name} Copilot, an AI assistant for cannabis compliance and inventory management.`);
  lines.push('');
  lines.push('## Instructions');
  lines.push('- ALWAYS use your tools to get real data. NEVER guess or fabricate numbers.');
  lines.push('- Call MULTIPLE tools to give thorough answers. For example, if asked for an inventory summary, call get_inventory_overview AND analyze_aging AND run_compliance_audit.');
  lines.push('- After each tool result, decide if you need more data before answering. Keep calling tools until you have enough information.');
  lines.push('- SEARCH RULE: When a user asks about specific products (e.g., "distillate bulk", "live rosin", "gummies"), call search_packages with their exact words in the `query` parameter. Do NOT use get_inventory_overview to answer product-specific questions — it only shows category-level summaries. Do NOT guess category names — use the `query` field for free-text search.');
  lines.push('- Be concise. Use markdown tables for data. Truncate package labels to last 8 chars in prose.');
  lines.push('- Start responses with a 1-2 sentence summary.');
  lines.push('- End responses with: <!-- suggestions: ["suggestion 1", "suggestion 2"] -->');
  lines.push('');
  lines.push('## Facility Context');
  lines.push(`- Facility: ${context.facilityName} | License: ${context.licenseNumber} | State: ${context.stateCode}`);
  lines.push(`- Active Packages: ${context.totalPackages} | Quantity: ${context.totalQuantity} | On Hold: ${context.onHoldCount}`);
  if (context.categoryBreakdown.length > 0) {
    lines.push('- Categories: ' + context.categoryBreakdown.map(c => `${c.category}(${c.count})`).join(', '));
  }
  if (context.agingBreakdown.length > 0) {
    lines.push('- Aging: ' + context.agingBreakdown.map(a => `${a.bucket}d(${a.count})`).join(', '));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Contextual suggestions
// ---------------------------------------------------------------------------

export function getContextualSuggestions(context: FacilityContext): CopilotSuggestion[] {
  const suggestions: CopilotSuggestion[] = [];
  const facilityType = context.facilityType;
  const isDispensary = facilityType === 'Dispensary' || facilityType === 'Microbusiness';
  const isCultivator = facilityType === 'Cultivator' || facilityType === 'Microbusiness';

  // Always include general suggestions
  suggestions.push({
    label: 'Inventory overview',
    prompt: 'Give me an overview of my current inventory status.',
  });

  // Aging-specific
  const aging180 = context.agingBreakdown.find(a => a.bucket === '180+');
  if (aging180 && aging180.count > 0) {
    suggestions.push({
      label: 'Critical aging',
      prompt: 'I have ' + aging180.count + ' packages over 180 days old. What should I do?',
    });
  }

  const aging90 = context.agingBreakdown.find(a => a.bucket === '91-180');
  if (aging90 && aging90.count > 0) {
    suggestions.push({
      label: 'Aging inventory',
      prompt: 'What inventory is aging past 90 days and what actions should I take?',
    });
  }

  // On hold
  if (context.onHoldCount > 0) {
    suggestions.push({
      label: 'On hold packages',
      prompt: 'I have ' + context.onHoldCount + ' packages on hold. Can you help me understand the implications?',
    });
  }

  // Lab testing
  const notSubmitted = context.labTestingBreakdown.find(l =>
    l.state === 'NotSubmitted' || l.state === 'NotRequired'
  );
  if (notSubmitted && notSubmitted.count > 0) {
    suggestions.push({
      label: 'Lab testing gaps',
      prompt: 'Which packages haven\'t been submitted for lab testing yet?',
    });
  }

  // Compliance
  suggestions.push({
    label: 'Compliance check',
    prompt: 'Are there any compliance risks I should be aware of right now?',
  });

  // FIFO
  suggestions.push({
    label: 'FIFO analysis',
    prompt: 'Help me identify FIFO violations in my current inventory.',
  });

  // Cultivator-only: harvest planning
  if (isCultivator || !facilityType) {
    suggestions.push({
      label: 'Harvest planning',
      prompt: 'What should I harvest next and how is the pipeline?',
    });
  }

  // Dispensary-only: sales trend (this was the v4 leak — never show to Cultivator/Manufacturer)
  if (isDispensary) {
    suggestions.push({
      label: 'Sales trend',
      prompt: 'How were sales this week?',
    });
  }

  // Facility summary — universal fallback
  suggestions.push({
    label: 'Facility summary',
    prompt: 'Give me a full facility summary',
  });

  return suggestions.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Shared copilot orchestration — used by both the tRPC router and the
// streaming API route so the tool-loop logic lives in one place.
// ---------------------------------------------------------------------------

import type { MetrcFacility } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { callLLM, runToolLoop } from '@/services/copilot/openrouter-client';
import { resolveLlm } from '@/services/llm/registry';
import { LlmProviderError, type ResolvedLlm } from '@/services/llm/types';
import type { ChatMessage, ToolCallEvent, ToolDefinition } from '@/services/copilot/openrouter-client';
import { isAgentRunsEnabled, startAgentRun, completeAgentRun, failAgentRun, type RunHandle } from '@/services/copilot/agent-runs';
import { getCopilotToolDefs } from '@/services/copilot/copilot-tool-defs';
import { ALL_COPILOT_TOOLS, ORG_COMPATIBLE_TOOLS, createToolExecutor } from '@/services/copilot/copilot-tools';
import { getMCPToolDefinitions, callMCPTool, isMCPTool } from '@/services/copilot/mcp-client';
import type { RuleDefinition } from '@/services/engines/rules-engine';
import { getBrand } from '@/lib/brand';

// ---------------------------------------------------------------------------
// Org-level context (no single facility selected)
// ---------------------------------------------------------------------------

export interface OrgContext {
  facilities: { name: string; stateCode: string; facilityType: string | null; licenseNumber: string; id: string }[];
  totalFacilities: number;
  stateBreakdown: { state: string; count: number }[];
}

export function buildOrgContext(facilities: MetrcFacility[]): OrgContext {
  const stateMap = new Map<string, number>();
  for (const f of facilities) {
    stateMap.set(f.stateCode, (stateMap.get(f.stateCode) || 0) + 1);
  }
  return {
    facilities: facilities.map(f => ({
      name: f.name,
      stateCode: f.stateCode,
      facilityType: f.facilityType,
      licenseNumber: f.licenseNumber,
      id: f.id,
    })),
    totalFacilities: facilities.length,
    stateBreakdown: Array.from(stateMap.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function buildOrgSystemPrompt(context: OrgContext, options?: { hasDocsTools?: boolean }): string {
  const lines: string[] = [];
  lines.push(`You are the ${getBrand().name} Copilot, an AI-powered assistant for cannabis compliance and inventory management.`);
  lines.push('You are currently in ORGANIZATION MODE — the user is viewing a cross-facility dashboard, not a specific facility.');
  lines.push('');
  lines.push('## Behavior');
  lines.push('- Be concise and actionable. Lead with the most important insight.');
  lines.push('- Focus on cross-facility comparisons, org-wide trends, and executive-level insights.');
  lines.push('- When the user asks about a specific facility, suggest they navigate to that facility page for detailed analysis.');
  lines.push('- USE YOUR TOOLS to get real-time data rather than guessing.');
  lines.push('');
  lines.push('## Data Accuracy (STRICT)');
  lines.push('- NEVER fabricate, estimate, or round numbers. If a tool did not return a specific number, say "I don\'t have that data" rather than guessing.');
  lines.push('- When presenting numerical breakdowns, every number MUST come directly from a tool result. If the breakdown is not available from tools, say so explicitly.');
  lines.push('- Always state which tool provided each number (e.g., "According to get_operations_summary, there are 1,200 active packages across 5 facilities").');
  lines.push('- Do NOT fill gaps in data with estimates. If a category or metric is missing from tool results, report it as unavailable.');
  lines.push('- If you cannot answer a question with the available tool data, say "I don\'t have the data to answer that" — never synthesize plausible-sounding numbers.');
  lines.push('');
  lines.push('## Knowledge Enrichment (ask_knowledge_base)');
  lines.push('You have a `ask_knowledge_base` tool that queries ' + getBrand().name + '\'s expert KB (compliance regulations, formulation science, manufacturing processes, cultivation best practices). USE IT to enrich answers — chain it AFTER your cross-facility tools whenever the question asks for expertise the operational data alone cannot answer.');
  lines.push('- Call it for formulation/product-development questions ("what can we make?"), regulatory questions ("compliant in MA?"), best-practice questions, and any domain-expertise question.');
  lines.push('- First gather org-level context with your tools (operations summary, run-rate comparison, etc.). Then call ask_knowledge_base with the context EMBEDDED in the question — generic questions get generic answers.');
  lines.push('- Always include the state code via the `state` parameter for compliance/regulatory questions; rules vary widely by state.');
  lines.push('');
  lines.push('## Formatting Rules');
  lines.push('Your responses are rendered in a chat panel. Follow these formatting rules strictly:');
  lines.push('');
  lines.push('### Structure');
  lines.push('- Start EVERY response with a **1-2 sentence summary** of the key finding or answer.');
  lines.push('- Use `---` horizontal rules between major sections to create visual breathing room.');
  lines.push('- Use `###` headers (not `##`) for section titles — keep them short (3-5 words).');
  lines.push('- Use bullet points for lists, NOT numbered lists with long explanations.');
  lines.push('- Keep paragraphs to 1-2 sentences max.');
  lines.push('');
  lines.push('### Data Presentation');
  lines.push('- Use **markdown tables** whenever presenting counts, quantities, or comparisons.');
  lines.push('- Tables are much more scannable than dense paragraphs. Use them liberally.');
  lines.push('');
  lines.push('### Brevity');
  lines.push('- Maximum 3 examples per finding. Summarize the rest with a count.');
  lines.push('- If tool returns 50+ items, do NOT list them. Give the count, top 3, and a recommendation.');
  lines.push('');
  lines.push('## Available Capabilities (Organization Mode)');
  lines.push('In org mode, you can use cross-facility tools:');
  lines.push('- Consolidated P&L across all facilities (revenue, cost, margin by facility/state/type)');
  lines.push('- Cross-facility operations summary (executive-level KPI aggregation)');
  lines.push('- Cross-facility run-rate comparison (weeks of supply by category across facilities)');
  lines.push('- Cross-facility inventory summary (total weight/quantity by category across all facilities)');
  lines.push('- Cross-facility strain comparison (yield, lab pass rates, growth days across facilities)');
  lines.push('');
  lines.push('Facility-specific tools (inventory analysis, compliance audit, actions) require navigating to a specific facility page.');
  lines.push('When the user asks for facility-specific data, let them know which facility page to visit.');
  if (options?.hasDocsTools) {
    lines.push('');
    lines.push('## Metrc Documentation Search');
    lines.push('You have access to tools prefixed with `docs__` that search official Metrc compliance documentation across 17 states.');
    lines.push('Use these tools when the user asks about state-specific regulations, compliance requirements, or API documentation.');
  }
  lines.push('');
  lines.push('## Skills (Recommended Workflows)');
  lines.push('When the user asks a broad question, use these multi-tool workflows:');
  lines.push('');
  lines.push('### Executive Overview');
  lines.push('Triggers: "Give me the big picture", "Executive summary", "How is the business doing?"');
  lines.push('Tools: get_operations_summary -> get_consolidated_pnl -> get_run_rate_comparison');
  lines.push('');
  lines.push('### Financial Health');
  lines.push('Triggers: "How are the finances?", "Show me revenue", "P&L breakdown"');
  lines.push('Tools: get_consolidated_pnl (with group_by)');
  lines.push('');
  lines.push('## Response Format');
  lines.push('- End every response with a hidden suggestion block containing 2-4 follow-up actions:');
  lines.push('  <!-- suggestions: ["suggestion 1", "suggestion 2", "suggestion 3"] -->');
  lines.push('- Suggestions should be natural follow-up questions or actionable next steps.');
  lines.push('- ALWAYS include this block at the very end of your response.');
  lines.push('');
  lines.push('## Organization Context');
  lines.push('- Total Facilities: ' + context.totalFacilities);
  lines.push('');
  if (context.stateBreakdown.length > 0) {
    lines.push('### State Breakdown');
    for (const s of context.stateBreakdown) {
      lines.push('- ' + s.state + ': ' + s.count + ' facilities');
    }
    lines.push('');
  }
  lines.push('### Facilities');
  for (const f of context.facilities.slice(0, 20)) {
    lines.push('- ' + f.name + ' (' + f.stateCode + ', ' + f.licenseNumber + ')' + (f.facilityType ? ' [' + f.facilityType + ']' : ''));
  }
  if (context.facilities.length > 20) {
    lines.push('- ... and ' + (context.facilities.length - 20) + ' more');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared copilot params + orchestration
// ---------------------------------------------------------------------------

export interface ExecuteCopilotParams {
  facility?: MetrcFacility;        // Present in facility mode, absent in org mode
  orgFacilities?: MetrcFacility[]; // Present in org mode
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  userId: string;
  /** FOR-1491: user's role on this facility — gates action tools at the executor. */
  userFacilityRole?: string;
  prisma: PrismaClient;
  dashboardPrisma?: PrismaClient;
  onToolCall?: (event: ToolCallEvent) => void;
  model?: string;
  /** When set, looks up COPILOT_SKILLS[skillId].responseTemplate and appends it to the system prompt. Used when the user clicks a skill card so deterministic skills render with consistent shape. */
  skillId?: string;
  /** When true, returns the anonymizer mappings + per-message audit log so the UI can render a "what we send to the LLM" view. */
  captureAudit?: boolean;
  /** Multi-turn Conversation this turn belongs to. Persisted on Run for resume + transcript. */
  conversationId?: string | null;
}

// ---------------------------------------------------------------------------
// Dynamic Tool Router for self-hosted LLMs
// Selects 8-12 relevant tools per query based on keyword matching.
// Zero latency (no extra API call), deterministic, works on any GPU.
// ---------------------------------------------------------------------------

interface ToolCategory {
  /** Tools in this category */
  tools: string[];
  /** Keywords that trigger this category (matched against lowercased query) */
  keywords: string[];
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    tools: ['get_inventory_overview', 'analyze_aging', 'get_aging_recommendations', 'detect_fifo_violations', 'detect_slow_moving', 'search_packages', 'detect_short_counts'],
    keywords: ['inventory', 'package', 'aging', 'fifo', 'old', 'pull first', 'slow moving', 'short count', 'stock', 'search'],
  },
  {
    tools: ['run_compliance_audit', 'get_audit_readiness_report', 'evaluate_business_rules', 'get_disposition_summary', 'log_disposition'],
    keywords: ['compliance', 'audit', 'alert', 'violation', 'rule', 'regulation', 'disposition', 'sample', 'waste', 'damage'],
  },
  {
    tools: ['get_harvest_summary', 'get_active_harvests', 'get_plant_batch_summary', 'get_active_plant_batches', 'get_active_plants', 'record_harvest_waste', 'create_packages_from_harvest'],
    keywords: ['harvest', 'plant', 'batch', 'grow', 'cultivation', 'flower', 'veg', 'clone'],
  },
  {
    tools: ['get_transfer_summary', 'get_transfer_chain', 'assess_fulfillment_risk', 'create_incoming_transfer_action'],
    keywords: ['transfer', 'shipment', 'manifest', 'fulfillment', 'inbound', 'outbound', 'deliver'],
  },
  {
    tools: ['get_lab_test_results', 'assess_testing_risk', 'get_potency_trends', 'flag_packages_for_testing', 'record_lab_test_action'],
    keywords: ['lab', 'test', 'potency', 'thc', 'cbd', 'terpene', 'coa', 'result', 'fail', 'pass'],
  },
  {
    tools: ['get_sales_summary', 'get_top_products', 'analyze_inventory_run_rate', 'get_daily_sales', 'get_category_margins', 'reconcile_package_sales'],
    keywords: ['sale', 'sales', 'revenue', 'sell', 'product', 'top', 'run rate', 'margin', 'pos', 'dutchie'],
  },
  {
    tools: ['flag_packages_for_discount', 'get_auto_discount_dashboard_stats', 'preview_auto_discounts'],
    keywords: ['discount', 'price', 'markdown', 'clearance', 'promo'],
  },
  {
    tools: ['get_pipeline_summary', 'get_harvest_cash_tracker'],
    keywords: ['pipeline', 'stage', 'harvest to cash', 'flow', 'lifecycle'],
  },
  {
    tools: ['calculate_tolling', 'calculate_advanced_tolling', 'compare_tolling_partners', 'get_tolling_reconciliation', 'find_tolling_breakeven'],
    keywords: ['toll', 'tolling', 'processor', 'co-pack', 'breakeven', 'yield'],
  },
  {
    tools: ['analyze_biomass', 'recommend_biomass_usage'],
    keywords: ['biomass', 'trim', 'shake', 'extraction', 'processing', 'crude', 'distillate'],
  },
  {
    tools: ['get_consolidated_pnl', 'get_org_financials', 'get_opex_models', 'get_opex_model_detail', 'simulate_opex_change'],
    keywords: ['financial', 'p&l', 'pnl', 'profit', 'loss', 'opex', 'cost', 'expense', 'budget', 'margin'],
  },
  {
    tools: ['get_operations_summary', 'get_run_rate_comparison', 'get_cross_facility_inventory_summary', 'compare_strains'],
    keywords: ['cross facility', 'all facilities', 'compare', 'operations', 'overview', 'summary', 'strain comparison'],
  },
  {
    tools: ['detect_fragmentation', 'get_consolidation_recommendations', 'find_sample_out_candidates'],
    keywords: ['fragment', 'consolidat', 'merge', 'combine', 'sample out'],
  },
  {
    tools: ['get_package_provenance', 'trace_package_journey', 'get_waste_analysis'],
    keywords: ['trace', 'provenance', 'lineage', 'journey', 'history', 'origin', 'waste analysis'],
  },
  {
    tools: ['analyze_employee_patterns', 'identify_training_needs'],
    keywords: ['employee', 'staff', 'training', 'worker', 'pattern'],
  },
  {
    tools: ['get_active_strains', 'get_active_items', 'create_strain_action', 'create_item_action', 'create_location_action'],
    keywords: ['strain', 'item', 'location', 'catalog', 'create strain', 'create item', 'create location'],
  },
  {
    tools: ['get_tag_inventory', 'search_tags'],
    keywords: ['tag', 'metrc tag', 'plant tag', 'package tag'],
  },
  {
    tools: ['query_supply_inventory', 'check_production_feasibility', 'get_low_stock_alerts', 'record_supply_receipt'],
    keywords: ['supply', 'reorder', 'low stock', 'feasibility', 'production', 'ingredient', 'bom'],
  },
  {
    tools: ['ask_knowledge_base'],
    keywords: [
      // Regulatory / legal
      'regulation', 'regulatory', 'compliance rule', 'law', 'legal', 'federal', 'state law',
      'limit', 'restriction', 'permitted', 'allowed', 'violation',
      // Industry guidance / best practice
      'best practice', 'industry', 'how to', 'what should', 'should we', 'recommend',
      'guidance', 'advise', 'suggest',
      // Formulation / product development
      'formulation', 'formulate', 'formulating', 'recipe', 'product development',
      'what can we make', 'what could we make', 'what should we make', 'new product',
      'develop a product', 'create a product', 'launch',
      // Biomass / processing
      'convert', 'biomass', 'excess material', 'utilize', 'repurpose', 'what can i do with',
      'process', 'processing path', 'yield',
      // Extraction / manufacturing methods
      'extraction', 'distillate', 'concentrate', 'edible', 'topical', 'tincture',
      'infuse', 'infusion', 'cure', 'curing', 'remediation', 'BHO', 'CO2', 'rosin', 'live resin',
    ],
  },
];

/** Truly universal tool — useful for any query type */
const ALWAYS_INCLUDE = new Set([
  'search_packages',
]);

const MAX_ROUTED_TOOLS = 12;

function selectToolsForQuery(query: string, allTools: ToolDefinition[]): ToolDefinition[] {
  const q = query.toLowerCase();
  const matchedNames = new Set<string>();

  for (const cat of TOOL_CATEGORIES) {
    if (cat.keywords.some(kw => q.includes(kw))) {
      for (const tool of cat.tools) matchedNames.add(tool);
    }
  }

  // No keyword matched → empty list. Avoids silent "all tools" fallthrough
  // that would crowd out the relevant tool when the model picks one to call.
  if (matchedNames.size === 0) return [];

  const toolMap = new Map(allTools.map(t => [t.function.name, t]));
  const result: ToolDefinition[] = [];

  for (const name of Array.from(matchedNames)) {
    if (result.length >= MAX_ROUTED_TOOLS) break;
    const tool = toolMap.get(name);
    if (tool) result.push(tool);
  }
  for (const name of Array.from(ALWAYS_INCLUDE)) {
    if (result.length >= MAX_ROUTED_TOOLS) break;
    if (matchedNames.has(name)) continue;
    const tool = toolMap.get(name);
    if (tool) result.push(tool);
  }

  return result;
}

/** Test hook — do not use outside of tests. */
export const __selectToolsForQueryForTest = selectToolsForQuery;

// ---------------------------------------------------------------------------
// Pre-fetch strategy for self-hosted LLMs
// Open-source models (Llama 3.3 etc.) tend to call one tool then summarize,
// instead of chaining multiple tool calls like GPT-4o. To work around this,
// we pre-fetch relevant zero-arg read tools in parallel, inject the results
// into the conversation, and let the model synthesize all data in one shot.
// ---------------------------------------------------------------------------

/** Tool names that must NEVER be pre-fetched (writes, expensive cross-facility calls) */
const PREFETCH_EXCLUDE = new Set([
  // Action tools (writes)
  'flag_packages_for_discount', 'flag_packages_for_testing', 'remediate_packages_action',
  'finish_packages_action', 'adjust_package_quantity', 'log_disposition',
  'finish_harvests_action', 'create_packages_from_harvest', 'record_harvest_waste',
  'destroy_plant_batches_action', 'create_plant_batch_action', 'change_plant_growth_phase_action',
  'create_strain_action', 'create_item_action', 'create_location_action',
  'create_incoming_transfer_action', 'record_lab_test_action', 'create_processing_package_action',
  // Expensive cross-facility tools
  'get_operations_summary', 'get_run_rate_comparison', 'get_cross_facility_inventory_summary',
  'compare_strains', 'get_consolidated_pnl',
]);

// ---------------------------------------------------------------------------
// Per-tool truncation budgets (parity plan AD3).
// Aggregate tools the user reads off the dashboard get more headroom; free-text
// tools keep the default and emit `truncated`/`totalRows` flags when cut so the
// LLM knows it is summarizing a partial view.
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATION_BUDGET = 4_000;

const TRUNCATION_BUDGET_BY_TOOL: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const t of ALL_COPILOT_TOOLS) {
    if (typeof t.function.truncationBudget === 'number') {
      m.set(t.function.name, t.function.truncationBudget);
    }
  }
  return m;
})();

/**
 * Trim a tool result so it fits its declared char budget without losing
 * top-level summary fields. Drops tail rows from arrays (already-sorted
 * payloads stay coherent) and stamps `truncated: true` + `totalRows` on
 * the result so the LLM knows the view is partial. Falls back to a hard
 * slice when the payload isn't a JSON object.
 */
export function truncateToolResult(toolName: string, raw: string): string {
  const budget = TRUNCATION_BUDGET_BY_TOOL.get(toolName) ?? DEFAULT_TRUNCATION_BUDGET;
  if (raw.length <= budget) return raw;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Capture original row counts before any trimming so the LLM sees the
      // true scale of the dataset (not the post-trim length).
      const originalRowCounts: Record<string, number> = {};
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) originalRowCounts[key] = (obj[key] as unknown[]).length;
      }
      let dropped = false;

      while (JSON.stringify(obj).length > budget) {
        let biggestKey: string | null = null;
        let biggestLen = 0;
        for (const key of Object.keys(obj)) {
          const v = obj[key];
          if (Array.isArray(v) && v.length > biggestLen) {
            biggestKey = key;
            biggestLen = v.length;
          }
        }
        if (!biggestKey || biggestLen <= 1) break;
        const arr = obj[biggestKey] as unknown[];
        // Halve the array (drop tail). Crude but converges quickly.
        obj[biggestKey] = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
        dropped = true;
      }

      if (dropped) {
        obj.truncated = true;
        const totalRows = Object.values(originalRowCounts).reduce((s, n) => s + n, 0);
        if (totalRows > 0) obj.totalRows = totalRows;
      }

      const out = JSON.stringify(obj);
      if (out.length <= budget) return out;
      return out.slice(0, budget) + '\n... (truncated)';
    }
  } catch {
    // not JSON
  }
  return raw.slice(0, budget) + '\n... (truncated)';
}

/** Test hook — do not use outside of tests. */
export const __truncateToolResultForTest = truncateToolResult;

/**
 * Deterministic Markdown rendering of prefetched tool results — used by the
 * fallback (no-OpenRouter) path so users see real numbers from real tools
 * instead of canned keyword responses. See parity plan Step 6 / R7.
 */
export function renderToolResultsAsMarkdown(
  query: string,
  results: Array<{ name: string; result: string }>,
): string {
  if (results.length === 0) {
    return [
      `No tools matched the query *${query}*.`,
      '',
      'Ask a super admin to configure an LLM provider (Super Admin → LLM Providers) for full chat synthesis, or rephrase your question to mention a specific area (inventory, aging, sales, compliance, transfers, etc.).',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`Here is what the tools returned for *${query}*:`);
  lines.push('');
  for (const { name, result } of results) {
    lines.push(`### ${name}`);
    lines.push('```json');
    lines.push(result);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function prefetchToolsForQuery(
  query: string,
  allTools: ToolDefinition[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  onToolCall?: (event: ToolCallEvent) => void,
  maxPrefetch = 5,
): Promise<{ messages: ChatMessage[]; toolsUsed: string[]; results: Array<{ name: string; result: string }> }> {
  const selected = selectToolsForQuery(query, allTools);

  // Filter to zero-arg read-only tools
  const prefetchable = selected.filter(t => {
    if (PREFETCH_EXCLUDE.has(t.function.name)) return false;
    const params = t.function.parameters as { required?: string[] };
    return !params.required || params.required.length === 0;
  });

  const toFetch = prefetchable.slice(0, maxPrefetch);
  if (toFetch.length === 0) return { messages: [], toolsUsed: [], results: [] };

  // Execute in parallel
  const settled = await Promise.allSettled(
    toFetch.map(async (tool) => {
      onToolCall?.({ tool: tool.function.name, status: 'start' });
      const result = await executeTool(tool.function.name, {});
      onToolCall?.({ tool: tool.function.name, status: 'end' });
      return { name: tool.function.name, result };
    }),
  );

  const succeeded = settled
    .filter((r): r is PromiseFulfilledResult<{ name: string; result: string }> => r.status === 'fulfilled')
    .map(r => r.value);

  if (succeeded.length === 0) return { messages: [], toolsUsed: [], results: [] };

  const truncated = succeeded.map(s => ({ ...s, result: truncateToolResult(s.name, s.result) }));

  // Build a single user-style data dump instead of tool_calls format.
  // vLLM llama3_json parser can choke on pre-injected tool_calls it didn't
  // generate. A plain-text data block avoids all parsing issues.
  const dataBlock = truncated.map(t =>
    `### ${t.name}\n\`\`\`json\n${t.result}\n\`\`\``
  ).join('\n\n');

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `[SYSTEM: The following tool results were gathered for your analysis. Use this data to answer the user's question.]\n\n${dataBlock}`,
    },
  ];

  return { messages, toolsUsed: truncated.map(s => s.name), results: truncated };
}

/**
 * The prefetch strategy sends raw tool results without the anonymizer, so it is only allowed for
 * providers that keep data on our infrastructure.
 */
export function assertPrefetchSafe(llm: ResolvedLlm): void {
  if (llm.dataLeavesHost) {
    throw new LlmProviderError(`Provider "${llm.provider?.name ?? llm.model}" sends data to a third party and cannot use the prefetch strategy (tool results would not be anonymized).`);
  }
}

export async function executeCopilotQuery(params: ExecuteCopilotParams): Promise<{
  content: string;
  toolsUsed: string[];
  context: { facilityName: string; totalPackages: number };
  audit?: import('@/services/copilot/openrouter-client').AnonymizationAudit;
  /** Set when AGENT_RUNS_ENABLED — durable Run row id for resume/share */
  runId?: string;
  /** Set when AGENT_RUNS_ENABLED — Artifact id for shareable URLs */
  artifactId?: string;
}> {
  const { facility, orgFacilities, message, history, userId, prisma, onToolCall, skillId } = params;
  const llm = await resolveLlm(params.model);

  // Auto-detect skill from typed phrases — when the user types a known
  // trigger phrase (e.g. "What can I sample out?") instead of clicking the
  // skill card, resolve the matching skillId so the responseTemplate fires
  // and the response shape stays consistent across both entry paths.
  // Exact match preferred over substring; first match wins.
  const resolvedSkillId = skillId ?? (() => {
    const normalized = message.trim().toLowerCase();
    if (!normalized) return undefined;
    let substringMatch: string | undefined;
    for (const s of COPILOT_SKILLS) {
      for (const phrase of s.triggerPhrases ?? []) {
        const p = phrase.toLowerCase();
        if (normalized === p) return s.id;
        if (!substringMatch && normalized.includes(p)) substringMatch = s.id;
      }
    }
    return substringMatch;
  })();

  // Optional response-shape template — applied when the user clicks a skill
  // card OR types a phrase that matches a skill's triggerPhrases.
  const skillTemplate = resolvedSkillId
    ? COPILOT_SKILLS.find(s => s.id === resolvedSkillId)?.responseTemplate
    : undefined;
  const appendTemplate = (basePrompt: string) =>
    skillTemplate ? `${basePrompt}\n\n${skillTemplate}` : basePrompt;

  // -----------------------------------------------------------------------
  // ORG MODE — no single facility, cross-facility tools only
  // -----------------------------------------------------------------------
  if (!facility && orgFacilities) {
    const orgContext = buildOrgContext(orgFacilities);

    if (!llm) {
      return {
        content: 'AI is disabled — ask a super admin to configure an LLM provider in Super Admin → LLM Providers.',
        toolsUsed: [],
        context: { facilityName: 'Organization', totalPackages: 0 },
      };
    }

    const mcpTools = await getMCPToolDefinitions();
    const hasDocsTools = mcpTools.some(t => t.function.name.startsWith('docs__'));
    const systemPrompt = appendTemplate(buildOrgSystemPrompt(orgContext, { hasDocsTools }));

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (history) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: message });

    const accessibleFacilityIds = orgFacilities.map(f => f.id);

    // Org mode: no packages, no client, no facility-specific rules
    const localExecuteTool = createToolExecutor({
      packages: [],
      // client intentionally omitted — org-compatible tools use per-facility clients via getMetrcClient()
      facilityId: undefined,
      userId,
      facility: undefined,
      accessibleFacilityIds,
      prisma,
      dashboardPrisma: params.dashboardPrisma,
    });

    // Org mode: only expose cross-facility tools + MCP docs tools.
    // Hiding facility-specific tools saves ~5,000 tokens and improves LLM tool selection accuracy.
    const orgTools = getCopilotToolDefs().filter(t => ORG_COMPATIBLE_TOOLS.has(t.function.name));
    const docsOnlyMcpTools = mcpTools.filter(t => t.function.name.startsWith('docs__'));
    const allTools = [...orgTools, ...docsOnlyMcpTools];
    const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (isMCPTool(name)) return callMCPTool(name, args, '');
      return localExecuteTool(name, args);
    };

    const orgMaxIter = llm.toolStrategy === 'prefetch' ? 3 : 8;
    // Pull distinct strain names across the org from the snapshot DB
    // (StrainSnapshot is the strain catalog — small table, single SELECT
    // DISTINCT). Skipped on failure so the anonymizer never blocks a query.
    const orgStrainRows = await prisma.strainSnapshot.findMany({
      where: {
        facilityId: { in: orgFacilities.map(f => f.id) },
        isActive: true,
      },
      select: { name: true },
      distinct: ['name'],
    }).catch((err: unknown) => {
      console.warn('[COPILOT] Failed to load org-wide strains for anonymizer:', err instanceof Error ? err.message : err);
      return [] as Array<{ name: string }>;
    });
    const orgStrains = orgStrainRows
      .map((r: { name: string }) => r.name)
      .filter((s): s is string => typeof s === 'string' && s.length >= 2);

    const orgAnonymizer = llm.dataLeavesHost ? createAnonymizer({
      orgFacilities: orgFacilities.map(f => ({ name: f.name, licenseNumber: f.licenseNumber })),
      strains: orgStrains,
    }) : undefined;

    // Optional Run write-through (Phase 1c). Failures here never block the
    // user-facing response — see agent-runs.ts.
    const orgWriteThroughId = orgFacilities[0]?.organizationId ?? null;
    let orgRun: RunHandle | null = null;
    if (isAgentRunsEnabled() && orgWriteThroughId) {
      orgRun = await startAgentRun({
        prisma,
        organizationId: orgWriteThroughId,
        facilityId: null,
        userId,
        skillId: params.skillId,
        prompt: message,
        model: llm.model,
        conversationId: params.conversationId ?? null,
      });
    }

    let result;
    try {
      result = await runToolLoop(messages, allTools, executeTool, orgMaxIter, onToolCall, llm, orgAnonymizer, params.captureAudit);
    } catch (err) {
      if (orgRun) await failAgentRun({ prisma, handle: orgRun, error: err });
      throw err;
    }

    let orgArtifactId: string | undefined;
    if (orgRun && orgWriteThroughId) {
      const completed = await completeAgentRun({
        prisma,
        handle: orgRun,
        organizationId: orgWriteThroughId,
        facilityId: null,
        content: result.content,
        toolsUsed: result.toolsUsed,
        audit: result.audit,
        toolResults: result.toolResults,
      });
      orgArtifactId = completed?.artifactId;
    }

    return {
      content: result.content,
      toolsUsed: result.toolsUsed,
      context: { facilityName: 'Organization', totalPackages: 0 },
      ...(result.audit ? { audit: result.audit } : {}),
      ...(orgRun ? { runId: orgRun.runId } : {}),
      ...(orgArtifactId ? { artifactId: orgArtifactId } : {}),
    };
  }

  // -----------------------------------------------------------------------
  // FACILITY MODE — existing behavior (unchanged)
  // -----------------------------------------------------------------------
  if (!facility) {
    return {
      content: 'No facility or organization context provided. Please navigate to a facility or organization page.',
      toolsUsed: [],
      context: { facilityName: 'Unknown', totalPackages: 0 },
    };
  }

  // Read packages from snapshot DB — same source as dashboard routers
  const { getActivePackagesFromDb } = await import('@/services/metrc/snapshot-utils');
  const client = getMetrcClient(facility); // kept for write operations + sales receipts
  const packages = await getActivePackagesFromDb(prisma, facility.id);
  const context = buildFacilityContext(
    facility.name,
    facility.licenseNumber,
    facility.stateCode,
    packages,
  );

  // Inject data fidelity context for progressive enhancement awareness
  const fidelityProfile = computeDataFidelity(facility);
  context.fidelityBlock = buildFidelityPromptBlock(fidelityProfile);

  // If an LLM provider is configured, use LLM with tool-use
  if (llm) {
    // Fetch MCP tool definitions
    const mcpTools = await getMCPToolDefinitions();
    const hasDocsTools = mcpTools.some(t => t.function.name.startsWith('docs__'));
    const systemPrompt = llm.toolStrategy === 'prefetch'
      ? appendTemplate(buildCompactSystemPrompt(context))
      : appendTemplate(buildSystemPrompt(context, { hasDocsTools }));

    // Build conversation messages
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (history) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: message });

    // Load facility business rules
    let facilityRules: RuleDefinition[] | undefined;
    try {
      const dbRules = await prisma.businessRule.findMany({
        where: { facilityId: facility.id, isActive: true },
      });
      if (dbRules.length > 0) {
        facilityRules = dbRules.map(r => ({
          id: r.id,
          name: r.name,
          description: r.description || '',
          category: r.category,
          severity: r.severity,
          isActive: r.isActive,
          conditions: r.conditions as unknown[],
          actionType: r.actionType,
          metadata: r.metadata as Record<string, unknown> | undefined,
        })) as RuleDefinition[];
      }
    } catch (err) {
      console.warn('[COPILOT] Failed to load business rules:', err instanceof Error ? err.message : err);
    }

    // Resolve accessible facility IDs for cross-facility cache scoping
    // Applies FOR-1172 facility-level access control: if FacilityAccess grants
    // exist for this user, scope to only those facilities.
    let accessibleFacilityIds: string[] = [];
    try {
      const orgFacilitiesForScope = await prisma.metrcFacility.findMany({
        where: { organizationId: facility.organizationId, isActive: true },
        select: { id: true },
      });
      accessibleFacilityIds = orgFacilitiesForScope.map((f: { id: string }) => f.id);

      // Check if user has explicit facility access grants
      const grants = await prisma.facilityAccess.findMany({
        where: { userId, facilityId: { in: accessibleFacilityIds } },
        select: { facilityId: true },
      });
      // If any grants exist, restrict to only granted facilities (FOR-1172 backward compat)
      if (grants.length > 0) {
        const grantedIds = new Set(grants.map((g: { facilityId: string }) => g.facilityId));
        accessibleFacilityIds = accessibleFacilityIds.filter(id => grantedIds.has(id));
      }
    } catch (err) {
      console.warn('[COPILOT] Failed to resolve accessible facilities:', err instanceof Error ? err.message : err);
    }

    // Create tool executor
    const localExecuteTool = createToolExecutor({
      packages,
      client,
      rules: facilityRules,
      facilityId: facility.id,
      userId,
      userFacilityRole: params.userFacilityRole,
      facility,
      accessibleFacilityIds,
      createActionLog: async (data) => {
        await prisma.actionLog.create({
          data: {
            facilityId: data.facilityId,
            userId: data.userId,
            actionType: data.actionType,
            status: data.status,
            targetType: data.targetType,
            targetIds: data.targetIds,
            targetCount: data.targetCount,
            executedAt: data.executedAt,
          },
        });
      },
      prisma,
      dashboardPrisma: params.dashboardPrisma,
    });

    // Self-hosted LLMs: dynamic tool routing selects 8-12 relevant tools per query.
    // Open-source models fail with 85+ tool defs (output tool calls as plain text).
    // OpenAI models: cap at 128 tools (API limit). All others: no limit.
    const isCustomLLM = llm.toolStrategy === 'prefetch';
    const effectiveModel = llm.model;
    const isOpenAIModel = effectiveModel.startsWith('openai/');
    const maxTools = isOpenAIModel ? 128 : Infinity;
    const combinedTools = isCustomLLM
      ? selectToolsForQuery(params.message, getCopilotToolDefs())
      : [...getCopilotToolDefs(), ...mcpTools];
    const allTools = combinedTools.length > maxTools
      ? combinedTools.slice(0, maxTools)
      : combinedTools;
    const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (isMCPTool(name)) return callMCPTool(name, args, facility.licenseNumber);
      return localExecuteTool(name, args);
    };

    if (isCustomLLM) {
      // Prefetched tool output is sent raw (no anonymizer) — never to a third party.
      assertPrefetchSafe(llm);
      // Self-hosted LLMs: pre-fetch + synthesize strategy.
      // 1. Execute relevant tools in parallel (no LLM call)
      // 2. Inject results as plain text (avoids vLLM tool_calls parsing issues)
      // 3. Call LLM once WITHOUT tool definitions to synthesize
      // This is faster and more reliable than tool-loop with open-source models.
      const prefetched = await prefetchToolsForQuery(
        params.message, allTools, executeTool, onToolCall, 5,
      );
      messages.push(...prefetched.messages);

      // Single synthesis call — no tool definitions, just summarize the data
      onToolCall?.({ tool: '_thinking', status: 'start' });
      const response = await callLLM(messages, undefined, {
        llm,
        maxTokens: 4096,
      });
      onToolCall?.({ tool: '_thinking', status: 'end' });

      return {
        content: response.content || 'I gathered data but could not generate a summary. Please try again.',
        toolsUsed: prefetched.toolsUsed,
        context: { facilityName: context.facilityName, totalPackages: context.totalPackages },
      };
    }

    // Build anonymizer from facility context — strips sensitive fields before they reach OpenRouter
    const orgFacilitiesForAnon = await prisma.metrcFacility.findMany({
      where: { organizationId: facility.organizationId, isActive: true },
      select: { name: true, licenseNumber: true },
    }).catch(() => []);
    // Pull strain names from the strain catalog (covers strains with no active
    // packages too) and union with strains from already-loaded packages as a
    // safety net for legacy data where catalog wasn't synced.
    const facilityStrainRows = await prisma.strainSnapshot.findMany({
      where: { facilityId: facility.id, isActive: true },
      select: { name: true },
      distinct: ['name'],
    }).catch((err: unknown) => {
      console.warn('[COPILOT] Failed to load facility strain catalog:', err instanceof Error ? err.message : err);
      return [] as Array<{ name: string }>;
    });
    const strainSet = new Set<string>(
      facilityStrainRows
        .map((r: { name: string }) => r.name)
        .filter((s): s is string => typeof s === 'string' && s.length >= 2),
    );
    for (const p of packages) {
      const s = (p as { itemStrainName?: string | null; strainName?: string | null }).itemStrainName
        ?? (p as { strainName?: string | null }).strainName;
      if (typeof s === 'string' && s.length >= 2) strainSet.add(s);
    }
    const anonymizer = llm.dataLeavesHost ? createAnonymizer({
      facilityName: facility.name,
      licenseNumber: facility.licenseNumber,
      stateCode: facility.stateCode,
      orgFacilities: orgFacilitiesForAnon,
      strains: Array.from(strainSet),
    }) : undefined;

    // Optional Run write-through (Phase 1c). Failures here never block the
    // user-facing response — see agent-runs.ts.
    let facilityRun: RunHandle | null = null;
    if (isAgentRunsEnabled()) {
      facilityRun = await startAgentRun({
        prisma,
        organizationId: facility.organizationId,
        facilityId: facility.id,
        userId,
        skillId: params.skillId,
        prompt: message,
        model: llm.model,
        conversationId: params.conversationId ?? null,
      });
    }

    // OpenRouter: full tool loop (8 iterations, model chains tools reliably).
    let result;
    try {
      result = await runToolLoop(messages, allTools, executeTool, 8, onToolCall, llm, anonymizer, params.captureAudit);
    } catch (err) {
      if (facilityRun) await failAgentRun({ prisma, handle: facilityRun, error: err });
      throw err;
    }

    let facilityArtifactId: string | undefined;
    if (facilityRun) {
      const completed = await completeAgentRun({
        prisma,
        handle: facilityRun,
        organizationId: facility.organizationId,
        facilityId: facility.id,
        content: result.content,
        toolsUsed: result.toolsUsed,
        audit: result.audit,
        toolResults: result.toolResults,
      });
      facilityArtifactId = completed?.artifactId;
    }

    return {
      content: result.content,
      toolsUsed: result.toolsUsed,
      context: { facilityName: context.facilityName, totalPackages: context.totalPackages },
      ...(result.audit ? { audit: result.audit } : {}),
      ...(facilityRun ? { runId: facilityRun.runId } : {}),
      ...(facilityArtifactId ? { artifactId: facilityArtifactId } : {}),
    };
  }

  // Fallback (no LLM provider configured): run the same prefetch as the self-hosted
  // path and render the JSON results as deterministic Markdown — no LLM. The
  // user sees real numbers from real tools, not canned keyword responses.
  // NOTE: degraded mode — `rules` and `accessibleFacilityIds` aren't wired,
  // so business-rule and cross-facility tools degrade. Configure an LLM
  // provider (Super Admin → LLM Providers) for the full experience.
  const fallbackExecutor = createToolExecutor({
    packages,
    client,
    facilityId: facility.id,
    userId,
    userFacilityRole: params.userFacilityRole,
    facility,
    prisma,
    dashboardPrisma: params.dashboardPrisma,
  });

  const prefetched = await prefetchToolsForQuery(
    message, getCopilotToolDefs(), fallbackExecutor, onToolCall, 5,
  );

  const markdown = renderToolResultsAsMarkdown(message, prefetched.results);
  return {
    content: markdown,
    toolsUsed: prefetched.toolsUsed,
    context: { facilityName: context.facilityName, totalPackages: context.totalPackages },
  };
}

// ---------------------------------------------------------------------------
// Shared rate limiter — used by both tRPC router and streaming API route.
// Single bucket per user so the two endpoints share a limit.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitMap = new Map<string, number[]>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of Array.from(rateLimitMap.entries())) {
    const filtered = timestamps.filter((t: number) => now - t < RATE_LIMIT_WINDOW_MS);
    if (filtered.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, filtered);
    }
  }
}, 300_000);

/**
 * Check rate limit for a user. Returns true if the request is allowed.
 * Throws an error string if rate limit is exceeded.
 */
export function checkCopilotRateLimit(userId: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(userId);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(userId, timestamps);
  }
  const filtered = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(userId, filtered);
  if (filtered.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  filtered.push(now);
  return true;
}
