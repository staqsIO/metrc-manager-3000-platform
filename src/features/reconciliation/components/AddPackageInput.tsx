'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'

interface AddPackageInputProps {
  facilityId: string
  existingLabels: Set<string>
  onAdd: (labels: string[]) => void
}

export default function AddPackageInput({
  facilityId,
  existingLabels,
  onAdd,
}: AddPackageInputProps) {
  const [value, setValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Debounce the search query by 300ms
  useEffect(() => {
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 300)
    return () => clearTimeout(timer)
  }, [value])

  const { data: suggestions } = trpc.reconciliation.searchPackages.useQuery(
    { facilityId, query: debouncedQuery },
    {
      enabled: debouncedQuery.length >= 2,
      staleTime: 30_000,
    },
  )

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return

    // Support comma or newline separated labels
    const labels = trimmed
      .split(/[,\n]+/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !existingLabels.has(l))

    if (labels.length > 0) {
      onAdd(labels)
    }
    setValue('')
    setShowSuggestions(false)
  }, [value, existingLabels, onAdd])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleSuggestionClick = useCallback((label: string) => {
    if (!existingLabels.has(label)) {
      onAdd([label])
    }
    setValue('')
    setShowSuggestions(false)
    inputRef.current?.focus()
  }, [existingLabels, onAdd])

  const filteredSuggestions = suggestions?.filter(s => !existingLabels.has(s.label)) ?? []

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder="Type or paste package labels (comma-separated)..."
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className={cn(
            'h-9 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors',
            value.trim()
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {/* Autocomplete dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 top-full left-0 right-12 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredSuggestions.map(s => (
            <button
              key={s.label}
              onClick={() => handleSuggestionClick(s.label)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex justify-between gap-4"
            >
              <span className="font-mono truncate">{s.label}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {s.quantity} {s.unitOfMeasure}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
