'use client'

import { useState, useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/shared/components/ui/command'
import { Tag, ChevronDown, Zap } from 'lucide-react'
import { abbreviateTag } from '@/features/tags/utils'

interface TagPickerProps {
  facilityId: string
  value: string
  onChange: (tag: string) => void
  autoAssign?: boolean
  tagType?: string
  disabled?: boolean
  className?: string
}

export default function TagPicker({
  facilityId,
  value,
  onChange,
  autoAssign = false,
  tagType,
  disabled = false,
  className,
}: TagPickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { data: inventory } = trpc.tags.getInventory.useQuery(
    { facilityId, pageSize: 100, tagType },
    { enabled: !!facilityId, staleTime: 60_000 },
  )

  const { data: nextAvailable } = trpc.tags.getNextAvailable.useQuery(
    { facilityId, count: 1 },
    { enabled: !!facilityId && autoAssign && !value, staleTime: 60_000 },
  )

  // Auto-assign next available tag on mount (ref avoids re-render loop from unstable onChange)
  useEffect(() => {
    if (autoAssign && !value && nextAvailable?.tags?.[0]) {
      onChangeRef.current(nextAvailable.tags[0].label)
    }
  }, [autoAssign, value, nextAvailable])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const tags = inventory?.tags ?? []
  const availableTags = tags.filter(t => t.status === 'Available')
  const selectedShort = value ? abbreviateTag(value) : null

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          {value ? (
            <span className="font-mono" title={value}>{selectedShort}</span>
          ) : (
            <span className="text-muted-foreground">Select tag...</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <Command>
            <CommandInput placeholder="Search tags..." />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              {/* Quick-pick: next available */}
              {nextAvailable?.tags?.[0] && (
                <CommandGroup heading="Quick Pick">
                  <CommandItem
                    value={`next-${nextAvailable.tags[0].label}`}
                    onSelect={() => {
                      onChange(nextAvailable.tags[0].label)
                      setOpen(false)
                    }}
                  >
                    <Zap className="h-4 w-4 text-yellow-500 mr-2" />
                    <span className="font-mono">{nextAvailable.tags[0].shortLabel}</span>
                    <span className="ml-2 text-xs text-muted-foreground">Next Available</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading={`Available (${availableTags.length})`}>
                {availableTags.map(tag => (
                  <CommandItem
                    key={tag.id}
                    value={tag.label}
                    onSelect={() => {
                      onChange(tag.label)
                      setOpen(false)
                    }}
                  >
                    <span className="font-mono">{tag.shortLabel}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{tag.tagType}</span>
                    {tag.label === value && (
                      <span className="ml-auto text-xs text-primary">Selected</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
