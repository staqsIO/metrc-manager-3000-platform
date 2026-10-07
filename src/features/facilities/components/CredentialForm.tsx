'use client'

import { Button } from '@/shared/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'

export function CredentialForm({
  showKeys,
  key1,
  key2,
  onKey1Change,
  onKey2Change,
  onToggleShowKeys,
  onSave,
  onCancel,
  isSaving,
  hideKey1 = false,
  placeholder1 = 'Vendor API Key',
  placeholder2 = 'User API Key',
}: {
  showKeys: boolean
  key1: string
  key2: string
  onKey1Change: (v: string) => void
  onKey2Change: (v: string) => void
  onToggleShowKeys: () => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  hideKey1?: boolean
  placeholder1?: string
  placeholder2?: string
}) {
  const canSave = hideKey1 ? !!key2.trim() : !!(key1.trim() && key2.trim())
  return (
    <div className="space-y-2">
      {!hideKey1 && (
        <div className="relative">
          <input
            type={showKeys ? 'text' : 'password'}
            placeholder={placeholder1}
            className="w-full p-2 pr-10 rounded-md border border-border bg-background text-sm"
            value={key1}
            onChange={(e) => onKey1Change(e.target.value)}
          />
          <button
            type="button"
            onClick={onToggleShowKeys}
            className="absolute right-2 top-2 text-muted-foreground"
          >
            {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      )}
      <div className="relative">
        <input
          type={showKeys ? 'text' : 'password'}
          placeholder={placeholder2}
          className="w-full p-2 rounded-md border border-border bg-background text-sm"
          value={key2}
          onChange={(e) => onKey2Change(e.target.value)}
        />
        {hideKey1 && (
          <button
            type="button"
            onClick={onToggleShowKeys}
            className="absolute right-2 top-2 text-muted-foreground"
          >
            {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving || !canSave}
        >
          {isSaving ? 'Saving...' : 'Save Credentials'}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
