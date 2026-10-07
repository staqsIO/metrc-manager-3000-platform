'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  Settings,
  Lock,
  Sprout,
  Lightbulb,
  Users,
  Cog,
  FlaskConical,
  Package,
  Building,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Icon mapping for section slugs
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  settings: Settings,
  lock: Lock,
  sprout: Sprout,
  lightbulb: Lightbulb,
  users: Users,
  cog: Cog,
  'flask-conical': FlaskConical,
  package: Package,
  building: Building,
  'trending-up': TrendingUp,
}

function getIcon(iconName: string | null): LucideIcon {
  if (!iconName) return Settings
  return ICON_MAP[iconName] ?? Settings
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChildSectionData {
  id: string
  name: string
  slug: string
  icon: string | null
  sortOrder: number
  cellGroups: Array<{ id: string; label: string; cells: Array<{ id: string }> }>
}

interface SectionData {
  id: string
  name: string
  slug: string
  icon: string | null
  sortOrder: number
  children: ChildSectionData[]
  cellGroups: Array<{ id: string; label: string; cells: Array<{ id: string }> }>
}

interface OpExSidebarProps {
  sections: SectionData[]
  activeSection: string | null
  onSectionClick: (slug: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OpExSidebar({ sections, activeSection, onSectionClick }: OpExSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggleExpand = (sectionId: string) => {
    setExpanded((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  // Count total cells in a section (direct + sub-sections)
  const countCells = (section: SectionData): number => {
    let count = 0
    for (const group of section.cellGroups) {
      count += group.cells.length
    }
    for (const child of section.children) {
      for (const group of child.cellGroups) {
        count += group.cells.length
      }
    }
    return count
  }

  return (
    <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto bg-card/30">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sections
        </h3>
      </div>
      <nav className="p-2 space-y-0.5">
        {sections.map((section) => {
          const Icon = getIcon(section.icon)
          const isActive = activeSection === section.slug
          const hasChildren = section.children.length > 0
          const isExpanded = expanded[section.id] ?? isActive
          const cellCount = countCells(section)

          return (
            <div key={section.id}>
              <button
                onClick={() => {
                  onSectionClick(section.slug)
                  if (hasChildren) {
                    toggleExpand(section.id)
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{section.name}</span>
                <span className="text-[10px] text-muted-foreground">{cellCount}</span>
                {hasChildren && (
                  isExpanded
                    ? <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    : <ChevronRight className="h-3 w-3 flex-shrink-0" />
                )}
              </button>

              {hasChildren && isExpanded && (
                <div className="ml-4 pl-3 border-l border-border/50 mt-0.5 space-y-0.5">
                  {section.children.map((child) => {
                    const isChildActive = activeSection === child.slug
                    return (
                      <button
                        key={child.id}
                        onClick={() => onSectionClick(child.slug)}
                        className={cn(
                          'w-full text-left rounded-md px-3 py-1.5 text-sm transition-colors',
                          isChildActive
                            ? 'text-primary font-medium bg-primary/5'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                        )}
                      >
                        {child.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
