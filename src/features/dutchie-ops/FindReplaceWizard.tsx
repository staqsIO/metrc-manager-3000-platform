'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ArrowLeft, Eye, Play, AlertTriangle } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import type { FindReplaceRule, FindReplacePreview } from '@/services/dutchie/types'

const FIELD_OPTIONS = [
  { value: 'name', label: 'Product Name' },
  { value: 'description', label: 'Description' },
  { value: 'unitPrice', label: 'Unit Price' },
  { value: 'categoryId', label: 'Category ID' },
  { value: 'brandId', label: 'Brand ID' },
  { value: 'isActive', label: 'Active Status' },
  { value: 'isVisible', label: 'Visibility' },
] as const

interface Props {
  previews: FindReplacePreview[]
  isLoadingPreview: boolean
  onPreview: (rule: FindReplaceRule) => void
  onConfirm: () => void
  onBack: () => void
}

export default function FindReplaceWizard({
  previews,
  isLoadingPreview,
  onPreview,
  onConfirm,
  onBack,
}: Props) {
  const [field, setField] = useState<FindReplaceRule['field']>('name')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [caseInsensitive, setCaseInsensitive] = useState(true)
  const [hasConfirmed, setHasConfirmed] = useState(false)

  const totalChanges = previews.reduce((sum, p) => sum + p.changes.length, 0)
  const hasPreviews = previews.length > 0

  const handlePreview = () => {
    setHasConfirmed(false)
    onPreview({
      field,
      find,
      replace,
      isRegex,
      caseInsensitive,
    })
  }

  const handleConfirm = () => {
    if (!hasConfirmed) {
      setHasConfirmed(true)
      return
    }
    onConfirm()
  }

  return (
    <div className="space-y-4">
      {/* Rule builder */}
      <div className="card-modern p-4">
        <h3 className="text-sm font-medium mb-3">Find &amp; Replace Rule</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Field selector */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Target Field</label>
            <select
              value={field}
              onChange={e => setField(e.target.value as FindReplaceRule['field'])}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {FIELD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Find */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Find</label>
            <input
              type="text"
              value={find}
              onChange={e => setFind(e.target.value)}
              placeholder={field === 'unitPrice' ? 'e.g. 29.99' : 'Search text...'}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          {/* Replace */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Replace With</label>
            <input
              type="text"
              value={replace}
              onChange={e => setReplace(e.target.value)}
              placeholder={field === 'unitPrice' ? 'e.g. 34.99' : 'Replacement text...'}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
        </div>

        {/* Options */}
        {(field === 'name' || field === 'description') && (
          <div className="flex items-center gap-4 mt-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={caseInsensitive}
                onChange={e => setCaseInsensitive(e.target.checked)}
                className="rounded border-border"
              />
              Case insensitive
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={e => setIsRegex(e.target.checked)}
                className="rounded border-border"
              />
              Regex
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <button
            onClick={handlePreview}
            disabled={!find || isLoadingPreview}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
              find && !isLoadingPreview
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <Eye className="h-3.5 w-3.5" />
            {isLoadingPreview ? 'Loading...' : 'Preview Changes'}
          </button>
        </div>
      </div>

      {/* Preview results */}
      {hasPreviews && (
        <div className="space-y-4">
          <div className="card-modern p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">
                Preview: {totalChanges} change{totalChanges !== 1 ? 's' : ''} across {previews.length} store{previews.length !== 1 ? 's' : ''}
              </h3>
              <button
                onClick={handleConfirm}
                className={cn(
                  'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  hasConfirmed
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700',
                )}
              >
                {hasConfirmed ? (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Confirm — Execute {totalChanges} Changes
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Execute Changes
                  </>
                )}
              </button>
            </div>

            {hasConfirmed && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs mb-3">
                This will modify {totalChanges} product{totalChanges !== 1 ? 's' : ''} in Dutchie. This action uses GET-before-POST safety, but changes are real. Click again to confirm.
              </div>
            )}
          </div>

          {previews.map(preview => (
            <div key={preview.facilityId} className="card-modern overflow-hidden">
              <div className="px-4 py-2 bg-muted/30 border-b flex items-center justify-between">
                <span className="text-sm font-medium">
                  {preview.facilityName}
                </span>
                <Badge variant="outline" className="text-xs">
                  {preview.changes.length} change{preview.changes.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Current Value</TableHead>
                    <TableHead>New Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.changes.map((change, i) => (
                    <TableRow key={`${change.productId}-${i}`}>
                      <TableCell className="font-medium text-sm">{change.productName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{change.field}</Badge>
                      </TableCell>
                      <TableCell className="text-red-500 text-sm">{change.oldValue || '(empty)'}</TableCell>
                      <TableCell className="text-emerald-500 text-sm">{change.newValue || '(empty)'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
