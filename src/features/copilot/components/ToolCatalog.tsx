'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Package, ShieldCheck, Leaf, FlaskConical, Truck, BarChart3,
  Zap, Search as SearchIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { COPILOT_TOOLS, COPILOT_ACTION_TOOLS } from '@/services/copilot/copilot-tool-defs'

interface ToolCatalogProps {
  onSelectTool: (query: string) => void
}

interface CatalogTool {
  name: string
  description: string
  isAction: boolean
  category: string
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  inventory: { label: 'Inventory', icon: Package, color: 'text-blue-500' },
  compliance: { label: 'Compliance', icon: ShieldCheck, color: 'text-emerald-500' },
  plants: { label: 'Plants & Harvests', icon: Leaf, color: 'text-green-500' },
  lab: { label: 'Lab Testing', icon: FlaskConical, color: 'text-purple-500' },
  transfers: { label: 'Transfers', icon: Truck, color: 'text-amber-500' },
  analytics: { label: 'Analytics', icon: BarChart3, color: 'text-cyan-500' },
  actions: { label: 'Actions', icon: Zap, color: 'text-orange-500' },
}

function categorize(name: string): string {
  if (/inventory|aging|fifo|slow_moving|package|fragment|consolidat|biomass|sample_out/.test(name)) return 'inventory'
  if (/compliance|audit|rule|business/.test(name)) return 'compliance'
  if (/plant|batch|harvest|strain/.test(name)) return 'plants'
  if (/lab|test/.test(name)) return 'lab'
  if (/transfer|fulfillment/.test(name)) return 'transfers'
  if (/analytic|employee|training|tolling|run_rate|provenance|sales|supply|item/.test(name)) return 'analytics'
  return 'inventory'
}

function toolToQuery(name: string): string {
  return name
    .replace(/_action$/, '')
    .replace(/_/g, ' ')
    .replace(/^(get|analyze|detect|run|assess|evaluate|find|calculate|search)/, (m) => {
      const verbs: Record<string, string> = {
        get: 'Show me',
        analyze: 'Analyze',
        detect: 'Check for',
        run: 'Run a',
        assess: 'Assess',
        evaluate: 'Evaluate',
        find: 'Find',
        calculate: 'Calculate',
        search: 'Search for',
      }
      return verbs[m] || m
    })
}

function buildCatalog(): CatalogTool[] {
  const tools: CatalogTool[] = []

  for (const t of COPILOT_TOOLS) {
    tools.push({
      name: t.function.name,
      description: t.function.description.split('.')[0] || t.function.description,
      isAction: false,
      category: categorize(t.function.name),
    })
  }

  for (const t of COPILOT_ACTION_TOOLS) {
    tools.push({
      name: t.function.name,
      description: t.function.description.split('.')[0] || t.function.description,
      isAction: true,
      category: 'actions',
    })
  }

  return tools
}

const ALL_TOOLS = buildCatalog()

export function ToolCatalog({ onSelectTool }: ToolCatalogProps) {
  const [filter, setFilter] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const filtered = ALL_TOOLS.filter(t => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false
    if (filter) {
      const s = filter.toLowerCase()
      return t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s)
    }
    return true
  })

  const grouped = new Map<string, CatalogTool[]>()
  for (const t of filtered) {
    const group = grouped.get(t.category) || []
    group.push(t)
    grouped.set(t.category, group)
  }

  const categories = ['all', ...Object.keys(CATEGORY_CONFIG)]

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <h3 className="text-sm font-semibold">Tool Catalog</h3>
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tools..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => {
            const config = cat === 'all' ? null : CATEGORY_CONFIG[cat]
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                  selectedCategory === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {cat === 'all' ? 'All' : config?.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        {Array.from(grouped.entries()).map(([category, tools]) => {
          const config = CATEGORY_CONFIG[category]
          if (!config) return null
          const Icon = config.icon

          return (
            <div key={category}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={cn('h-3.5 w-3.5', config.color)} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {config.label}
                </span>
                <span className="text-[10px] text-muted-foreground">({tools.length})</span>
              </div>
              <div className="space-y-1">
                {tools.map((tool) => (
                  <button
                    key={tool.name}
                    onClick={() => onSelectTool(toolToQuery(tool.name))}
                    className="w-full text-left rounded-md border border-border/50 hover:bg-accent px-2.5 py-1.5 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      {tool.isAction && (
                        <Zap className="h-3 w-3 text-orange-500 shrink-0" />
                      )}
                      <span className="text-xs font-medium group-hover:text-foreground">
                        {tool.name.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                      {tool.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No tools match &ldquo;{filter}&rdquo;
          </p>
        )}
      </div>
    </div>
  )
}
