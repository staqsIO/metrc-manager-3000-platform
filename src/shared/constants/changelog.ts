type ChangelogEntryType = 'feature' | 'improvement' | 'fix'

export interface ChangelogEntry {
  date: string
  title: string
  description: string
  type: ChangelogEntryType
  link?: string
}

/** Most-recent first. New entries always inserted at top. */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-02-25',
    title: 'Copilot Intelligence Expansion',
    description:
      'The AI Copilot now understands every major feature shipped in the past week. Ask about auto-discounts, cross-facility financials, tolling reconciliation, audit readiness, run-rate comparisons, and daily sales trends — 10 new tools and 5 multi-tool workflows added.',
    type: 'feature',
    link: '/copilot',
  },
  {
    date: '2026-02-25',
    title: 'Executive Overview Skill',
    description:
      'Ask the Copilot "Give me the big picture" or "How is the business doing?" and it will chain operations summary, P&L, and run-rate data across all your facilities into a single executive briefing.',
    type: 'feature',
    link: '/copilot',
  },
  {
    date: '2026-02-25',
    title: 'Cross-Facility Access Control Fix',
    description:
      'All Copilot tools that query across facilities now properly enforce facility-level access grants. Users only see data from facilities they have been explicitly granted access to.',
    type: 'fix',
  },
  {
    date: '2026-02-24',
    title: 'Cross-Facility Strain Comparison',
    description:
      'Compare how the same strain performs across all your facilities. A new collapsible section on the Strain Analysis page shows yield efficiency, lab pass rate, and growth duration side by side with color-coded badges highlighting meaningful differences.',
    type: 'feature',
    link: '/facilities/[facilityId]/analytics/strains',
  },
  {
    date: '2026-02-24',
    title: 'Smart Strain Name Matching',
    description:
      'Strains are now automatically matched across facilities even when named slightly differently (e.g., "Blue Dream #5" vs "blue dream"). No manual cleanup needed — the platform recognizes the same genetic line regardless of naming conventions.',
    type: 'improvement',
  },
  {
    date: '2026-02-24',
    title: 'Copilot Strain Comparison',
    description:
      'Ask Copilot questions like "How does Blue Dream perform in CO vs OK?" and get structured cross-facility strain comparisons with significance flags directly in the chat.',
    type: 'feature',
    link: '/copilot',
  },
  {
    date: '2026-02-24',
    title: 'Cross-Facility Global Search',
    description:
      'Search package tags, strain names, item names, and locations across all your facilities at once from the Cmd+K palette. Results show the facility name and state for each match, and clicking navigates directly to the package in the correct facility.',
    type: 'feature',
  },
  {
    date: '2026-02-24',
    title: 'Per-Category Discount Caps',
    description:
      'Set different maximum discount percentages for each product category. Flower, concentrates, edibles, and 8 other Metrc categories can each have their own ceiling. Categories without an override use the global max.',
    type: 'feature',
    link: '/facilities/[facilityId]/inventory/discounts/auto-config',
  },
  {
    date: '2026-02-22',
    title: 'Biomass Recommendations',
    description:
      'Ask Copilot for AI-powered processing recommendations for your raw materials. The biomass page now shows strain, lab status, compliance badges, and fresh-frozen urgency alerts.',
    type: 'feature',
    link: '/facilities/[facilityId]/packages/biomass',
  },
  {
    date: '2026-02-22',
    title: 'Labor Calculator',
    description:
      'Manage employee profiles, calculate labor cost per unit with the quick calculator, and create work logs tied to your facility operations.',
    type: 'feature',
    link: '/facilities/[facilityId]/labor',
  },
  {
    date: '2026-02-22',
    title: 'Strain Intelligence',
    description:
      'Analyze yield trends by strain, view genetic correlations and growth duration insights, and get data-driven recommendations for your next cultivation cycle.',
    type: 'feature',
    link: '/facilities/[facilityId]/analytics/yields',
  },
  {
    date: '2026-02-22',
    title: 'Auto-Discount Dashboard',
    description:
      'New stats overview and a "Run Now" button for the discount engine. Approve or revert discount recommendations with confirmation dialogs.',
    type: 'improvement',
  },
  {
    date: '2026-02-22',
    title: 'Per-User Metrc Credentials',
    description:
      'Assign individual Metrc API keys to team members from the Team tab in facility settings. Enable enforcement so each user authenticates with their own credentials.',
    type: 'feature',
  },
  {
    date: '2026-02-22',
    title: 'Transfer Delivery Details',
    description:
      'Expand any transfer row to see per-package delivery details. A new Rejected tab shows rejected deliveries at a glance.',
    type: 'improvement',
    link: '/facilities/[facilityId]/transfers',
  },
  {
    date: '2026-02-22',
    title: 'Consistent Page Layouts',
    description:
      'Unified metric cards, pagination controls, and empty states across all pages for a cleaner, more consistent experience.',
    type: 'improvement',
  },
  {
    date: '2026-02-21',
    title: 'Multi-Organization Switching',
    description:
      'If you belong to multiple organizations, switch between them instantly from the sidebar dropdown without signing out.',
    type: 'feature',
  },
  {
    date: '2026-02-19',
    title: 'Catalog Management',
    description:
      'Create, edit, and search strains, items, and locations directly in the platform. View Metrc IDs and sync status from detail modals.',
    type: 'feature',
    link: '/facilities/[facilityId]/catalog/items',
  },
  {
    date: '2026-02-19',
    title: 'Write Operations',
    description:
      'Adjust, finish, and remediate packages; create processing jobs; finish harvests; record waste; and create transfers — all with a preview-before-you-submit safety flow.',
    type: 'feature',
  },
  {
    date: '2026-02-19',
    title: 'Copilot Model Selector',
    description:
      'Choose which AI model powers your Copilot from the panel header. Switch between models based on your preference for speed or depth.',
    type: 'improvement',
    link: '/copilot',
  },
  {
    date: '2026-02-17',
    title: 'Tag Inventory',
    description:
      'View and manage your Metrc tag inventory. See available tag counts, search by label, and get low-stock warnings. Tags are auto-suggested in FIFO order during processing.',
    type: 'feature',
  },
  {
    date: '2026-02-17',
    title: 'Discount Engine',
    description:
      'Rule-based scoring engine for aging inventory. Automatically recommends discounts, sample-outs, consolidation, and promotions based on configurable rules.',
    type: 'feature',
  },
  {
    date: '2026-02-17',
    title: 'Bulk Reconciliation',
    description:
      'Match Metrc packages against physical counts in bulk. Detect discrepancies and get auto-generated adjustment recommendations.',
    type: 'feature',
  },
  {
    date: '2026-02-17',
    title: 'Audit Readiness Snapshot',
    description:
      'Facility-wide audit readiness score across 5 compliance categories. Includes employee activity analysis and pattern detection.',
    type: 'feature',
  },
  {
    date: '2026-02-16',
    title: 'In-App Feature Guide',
    description:
      'Added a comprehensive feature-by-feature user guide accessible from the sidebar and Cmd+K palette.',
    type: 'feature',
    link: '/guide',
  },
  {
    date: '2026-02-16',
    title: 'What\'s New Changelog',
    description:
      'Track platform updates with an in-app changelog. A notification dot appears when new entries are added.',
    type: 'feature',
    link: '/changelog',
  },
  {
    date: '2026-02-14',
    title: 'Dutchie Ops Multi-Store Management',
    description:
      'Manage multiple Dutchie dispensary locations from a single view. Bulk update menus, sync inventory, and monitor POS discrepancies across stores.',
    type: 'feature',
  },
  {
    date: '2026-02-10',
    title: 'Cross-Facility Comparison',
    description:
      'Compare inventory, compliance, and operational metrics across all your facilities in one unified dashboard.',
    type: 'feature',
    link: '/operations',
  },
  {
    date: '2026-02-07',
    title: 'Financial Dashboard',
    description:
      'Organization-wide financial overview with revenue, cost, and margin analytics across all facilities.',
    type: 'feature',
    link: '/financials',
  },
  {
    date: '2026-02-03',
    title: 'Supply Chain & BOM Tracking',
    description:
      'Track raw materials inventory, manage bill of materials for manufactured products, and get low-stock alerts before you run out.',
    type: 'feature',
  },
  {
    date: '2026-01-28',
    title: 'OpEx Calculator',
    description:
      'Model your operating expenses with configurable cost categories. Compare scenarios and identify cost reduction opportunities.',
    type: 'feature',
  },
  {
    date: '2026-01-22',
    title: 'Harvest & Plant Batch Tracking',
    description:
      'Full cultivation lifecycle tracking from planting through harvest. Monitor active plant batches, track yields, and manage harvest workflows.',
    type: 'feature',
  },
  {
    date: '2026-01-15',
    title: 'Command Palette',
    description:
      'Press Cmd+K to quickly search packages, navigate pages, find compliance alerts, and launch Copilot from anywhere.',
    type: 'improvement',
  },
  {
    date: '2026-01-10',
    title: 'Copilot Tool Improvements',
    description:
      'AI Copilot now supports additional analysis tools including inventory aging queries, compliance rule checks, and fulfillment risk assessment.',
    type: 'improvement',
  },
  {
    date: '2026-01-05',
    title: 'Facility-Type Navigation',
    description:
      'Sidebar navigation now adapts to your facility type. Dispensaries, cultivators, and manufacturers each see only the sections relevant to their operations.',
    type: 'improvement',
  },
  {
    date: '2025-12-20',
    title: 'Metrc-Dutchie Reconciliation',
    description:
      'Automatically compare Metrc package data against Dutchie POS records to catch discrepancies before they become compliance issues.',
    type: 'feature',
  },
]

export function getLatestChangelogDate(): string {
  return CHANGELOG_ENTRIES[0].date
}
