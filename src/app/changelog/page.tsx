'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Megaphone, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHANGELOG_ENTRIES, type ChangelogEntry } from '@/shared/constants/changelog'
import { useChangelogBadge } from '@/shared/hooks/useChangelogBadge'
import { getBrand } from '@/lib/brand'

const typeBadge: Record<ChangelogEntry['type'], { label: string; className: string }> = {
  feature: { label: 'Feature', className: 'bg-emerald-500/10 text-emerald-500' },
  improvement: { label: 'Improvement', className: 'bg-blue-500/10 text-blue-500' },
  fix: { label: 'Fix', className: 'bg-orange-500/10 text-orange-500' },
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function ChangelogPage() {
  const { markSeen } = useChangelogBadge()

  useEffect(() => {
    markSeen()
  }, [markSeen])

  const grouped = useMemo(() => {
    const map = new Map<string, ChangelogEntry[]>()
    for (const entry of CHANGELOG_ENTRIES) {
      const existing = map.get(entry.date)
      if (existing) {
        existing.push(entry)
      } else {
        map.set(entry.date, [entry])
      }
    }
    return Array.from(map.entries())
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">What&apos;s New</h1>
            <p className="text-sm text-muted-foreground">Latest updates and improvements to {getBrand().name}</p>
          </div>
        </div>

        {/* Entries grouped by date */}
        <div className="space-y-10">
          {grouped.map(([date, entries]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-4">
                {formatDate(date)}
              </h2>
              <div className="space-y-4">
                {entries.map((entry) => {
                  const badge = typeBadge[entry.type]
                  return (
                    <div key={entry.title} className="card-modern p-5">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium shrink-0 mt-0.5',
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                            {entry.description}
                          </p>
                          {entry.link && !entry.link.includes('[facilityId]') && (
                            <Link
                              href={entry.link}
                              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:underline"
                            >
                              View feature
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
