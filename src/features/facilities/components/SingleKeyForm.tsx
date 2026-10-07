'use client'

import { Button } from '@/shared/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'

export function SingleKeyForm({
  showKey,
  value,
  onChange,
  onToggleShowKey,
  onSave,
  onCancel,
  isSaving,
  placeholder = 'API Key',
}: {
  showKey: boolean
  value: string
  onChange: (v: string) => void
  onToggleShowKey: () => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          placeholder={placeholder}
          className="w-full p-2 pr-10 rounded-md border border-border bg-background text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={onToggleShowKey}
          className="absolute right-2 top-2 text-muted-foreground"
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !value.trim()}
        >
          {isSaving ? 'Saving...' : 'Save API Key'}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
