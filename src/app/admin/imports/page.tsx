'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc-client'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  FileWarning,
  Database,
  Truck,
  ShoppingCart,
  Trash2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { FacilityItem } from '@/features/facilities/types'
import { detectFromFilename, matchFacilityByLicense } from '@/services/import/filename-detect'

/**
 * Admin Imports — single surface for backfilling new clients from Metrc
 * UI exports (Reports Control Panel → Excel/CSV).
 *
 * Why this exists: Metrc REST API caps historical reads at 20 records per
 * call. Years of inventory for a new client through the API alone takes
 * 100,000s of calls; the UI exports thousands of rows in one CSV.
 *
 * Each report type targets a specific endpoint with the same dry-run →
 * commit handshake. Adding a new report type is additive: drop a parser
 * + endpoint + a row in REPORT_TYPES below.
 */

interface ReportType {
  id: 'packages' | 'transfers-affiliated' | 'transfers-wholesale' | 'sales'
  label: string
  description: string
  endpoint: string
  /** Extra body fields beyond { csvText, facilityId, confirmed }. */
  extraBody?: Record<string, string>
  icon: LucideIcon
  iconColor: string
}

const REPORT_TYPES: ReportType[] = [
  {
    id: 'packages',
    label: 'Packages Inventory',
    description: 'Metrc Reports → Packages Inventory → Excel/CSV. Lands rows in package_snapshots.',
    endpoint: '/api/import/packages-csv',
    icon: Database,
    iconColor: 'text-emerald-500',
  },
  {
    id: 'transfers-affiliated',
    label: 'Transfers (affiliated)',
    description: 'Metrc Reports → Transfers → Excel/CSV. Affiliated/internal transfers only.',
    endpoint: '/api/import/transfers',
    extraBody: { csvType: 'affiliated' },
    icon: Truck,
    iconColor: 'text-blue-500',
  },
  {
    id: 'transfers-wholesale',
    label: 'Transfers (wholesale)',
    description: 'Metrc Reports → Wholesale Transfers → Excel/CSV. External / B2B sales transfers.',
    endpoint: '/api/import/transfers',
    extraBody: { csvType: 'wholesale' },
    icon: Truck,
    iconColor: 'text-purple-500',
  },
  {
    id: 'sales',
    label: 'Sales Transactions',
    description: 'Metrc Reports → Sales Transactions → Excel/CSV. Per-package retail line items.',
    endpoint: '/api/import/sales-csv',
    icon: ShoppingCart,
    iconColor: 'text-amber-500',
  },
]

interface PreviewResponse {
  status: 'preview'
  preview: {
    totalParsed: number
    parseErrors?: Array<{ row: number; message: string }>
    detectedHeaders?: string[]
    sample?: unknown[]
    categories?: Record<string, number>
    strains?: Record<string, number>
    matched?: number
    unmatched?: number
  }
}

interface CompleteResponse {
  status: 'completed'
  result?: {
    totalParsed: number
    inserted: number
    skipped: number
    parseErrors: number
  }
  insertedCount?: number
  skippedDuplicates?: number
}

type ServerResponse = PreviewResponse | CompleteResponse | { error: string; parseErrors?: unknown[]; detectedHeaders?: string[] }

export default function AdminImportsPage() {
  const { status } = useSession()
  const [reportTypeId, setReportTypeId] = useState<ReportType['id']>('packages')
  const [facilityId, setFacilityId] = useState<string>('')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [previewData, setPreviewData] = useState<PreviewResponse['preview'] | null>(null)
  const [completeData, setCompleteData] = useState<CompleteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<{ headers?: string[]; rows?: Array<{ row: number; message: string }> } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'commit' | 'parsing' | null>(null)
  // Stash filename-derived detection so the UI can confirm what it auto-
  // applied + show overrides without losing the inference.
  const [detection, setDetection] = useState<{
    licenseNumber: string | null
    inferredFacilityType: 'Cultivator' | 'Manufacturer' | 'Dispensary' | null
    matchedFacilityName: string | null
    inactivePackages: boolean
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const reportType = useMemo(
    () => REPORT_TYPES.find((r) => r.id === reportTypeId)!,
    [reportTypeId],
  )

  const { data: facilities } = trpc.facility.list.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: 60_000,
  })
  const allFacilities = useMemo(() => (facilities ?? []) as FacilityItem[], [facilities])

  const reset = useCallback(() => {
    setCsvText('')
    setFileName('')
    setPreviewData(null)
    setCompleteData(null)
    setError(null)
    setErrorDetails(null)
    setDetection(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  /**
   * Convert an .xlsx ArrayBuffer to CSV text using SheetJS. Loaded lazily
   * so the 700KB lib only ships when an xlsx file is actually dropped.
   */
  const xlsxToCsv = useCallback(async (buf: ArrayBuffer): Promise<string> => {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buf, { type: 'array' })
    const firstSheet = wb.Sheets[wb.SheetNames[0]!]
    if (!firstSheet) throw new Error('Workbook has no sheets')
    return XLSX.utils.sheet_to_csv(firstSheet)
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      setErrorDetails(null)
      setPreviewData(null)
      setCompleteData(null)
      if (file.size > 50 * 1024 * 1024) {
        setError('File is larger than 50 MB. Split the export into smaller date ranges.')
        return
      }

      setBusy('parsing')
      try {
        const isXlsx =
          file.name.toLowerCase().endsWith('.xlsx') ||
          file.type ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        const text = isXlsx ? await xlsxToCsv(await file.arrayBuffer()) : await file.text()
        setCsvText(text)
        setFileName(file.name)

        // Auto-detect facility + report type from filename. Operator can
        // still override either dropdown afterwards.
        const det = detectFromFilename(file.name)
        const matched = matchFacilityByLicense(det.licenseNumber, allFacilities)
        if (det.reportType) {
          setReportTypeId(det.reportType)
        }
        if (matched) {
          setFacilityId(matched.id)
        }
        setDetection({
          licenseNumber: det.licenseNumber,
          inferredFacilityType: det.inferredFacilityType,
          matchedFacilityName: matched?.name ?? null,
          inactivePackages: det.inactivePackages,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read file')
      } finally {
        setBusy(null)
      }
    },
    [allFacilities, xlsxToCsv],
  )

  const submit = useCallback(
    async (confirmed: boolean) => {
      if (!csvText || !facilityId) return
      setBusy(confirmed ? 'commit' : 'preview')
      setError(null)
      setErrorDetails(null)
      try {
        const body: Record<string, string> = {
          csvText,
          facilityId,
          confirmed: confirmed ? 'true' : 'false',
          ...(reportType.extraBody ?? {}),
          ...(reportType.id === 'packages' && detection?.inactivePackages
            ? { packagesScope: 'inactive' }
            : {}),
        }
        const res = await fetch(reportType.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as ServerResponse
        if (!res.ok) {
          const errMsg = 'error' in data ? data.error : `HTTP ${res.status}`
          setError(errMsg)
          if ('parseErrors' in data || 'detectedHeaders' in data) {
            setErrorDetails({
              headers: (data as { detectedHeaders?: string[] }).detectedHeaders,
              rows: (data as { parseErrors?: Array<{ row: number; message: string }> }).parseErrors,
            })
          }
          return
        }
        if ('status' in data && data.status === 'preview') {
          setPreviewData(data.preview)
          setCompleteData(null)
        } else if ('status' in data && data.status === 'completed') {
          setCompleteData(data)
          setPreviewData(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error')
      } finally {
        setBusy(null)
      }
    },
    [csvText, facilityId, reportType, detection],
  )

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (status !== 'authenticated') {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-sm rounded-lg border border-border bg-card p-6 text-center text-sm">
          Sign in required.
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </Link>

        <header className="mb-6 pb-4 border-b border-border">
          <h1 className="text-xl font-semibold inline-flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Imports
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Bulk-load historical data from Metrc UI exports. Use this when onboarding a new
            client — the REST API caps historical reads at 20 records per call, so years of
            inventory through the API alone is prohibitively slow.
          </p>
        </header>

        {/* Report type picker — large cards so admins can scan options */}
        <section className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            1. Pick a report type
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {REPORT_TYPES.map((rt) => {
              const Icon = rt.icon
              const isActive = reportTypeId === rt.id
              return (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => {
                    setReportTypeId(rt.id)
                    reset()
                  }}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/30',
                  )}
                >
                  <Icon className={cn('h-4 w-4 mb-1.5', rt.iconColor)} />
                  <div className="text-xs font-semibold text-foreground">{rt.label}</div>
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">{reportType.description}</p>
        </section>

        {/* Facility picker */}
        <section className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            2. Pick the destination facility
          </div>
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a facility…" />
            </SelectTrigger>
            <SelectContent>
              {allFacilities.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name} {f.licenseNumber ? `(${f.licenseNumber})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        {/* File picker */}
        <section className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            3. Drop the Metrc export (CSV)
          </div>
          <div
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragging(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isDragging) setIsDragging(true)
              // Show the move/copy cursor instead of the no-drop ban icon.
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // Only clear when leaving the dropzone itself, not inner elements
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setIsDragging(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragging(false)
              const file = e.dataTransfer?.files?.[0]
              if (file) void onFile(file)
            }}
            className={cn(
              'rounded-lg border-2 border-dashed transition-colors',
              isDragging
                ? 'border-primary bg-primary/10'
                : csvText
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-border bg-card',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onFile(file)
              }}
            />
            <div className="px-6 py-8 text-center">
              {csvText ? (
                <div className="space-y-2">
                  <FileText className="h-6 w-6 text-emerald-500 mx-auto" />
                  <div className="text-sm font-medium">{fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {(csvText.length / 1024).toFixed(1)} KB · {csvText.split('\n').length - 1} rows
                  </div>
                  {detection && (detection.licenseNumber || detection.matchedFacilityName) && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-[11px] text-primary">
                      <Sparkles className="h-3 w-3" />
                      <span>
                        Auto-detected:
                        {detection.matchedFacilityName ? (
                          <strong className="font-semibold ml-1">{detection.matchedFacilityName}</strong>
                        ) : detection.licenseNumber ? (
                          <strong className="font-semibold ml-1">{detection.licenseNumber}</strong>
                        ) : null}
                        {detection.inferredFacilityType && (
                          <span className="ml-1 text-muted-foreground">({detection.inferredFacilityType})</span>
                        )}
                        {detection.inactivePackages && (
                          <span className="ml-1 text-amber-500">· Inactive</span>
                        )}
                      </span>
                    </div>
                  )}
                  {detection && detection.licenseNumber && !detection.matchedFacilityName && (
                    <div className="text-[11px] text-amber-500 inline-flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      License {detection.licenseNumber} not found in your facilities — pick one manually.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground block mx-auto"
                  >
                    <Trash2 className="h-3 w-3" />
                    Pick a different file
                  </button>
                </div>
              ) : busy === 'parsing' ? (
                <div className="space-y-2">
                  <Loader2 className="h-6 w-6 text-muted-foreground mx-auto animate-spin" />
                  <div className="text-xs text-muted-foreground">Reading file…</div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-6 w-6 text-muted-foreground mx-auto" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose CSV / Excel file
                  </Button>
                  <div className="text-[11px] text-muted-foreground">
                    .csv or .xlsx · up to 50 MB · we&apos;ll auto-detect facility + report type from the filename
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Action row */}
        <section className="mb-6 flex gap-2">
          <Button
            disabled={!csvText || !facilityId || busy !== null}
            onClick={() => void submit(false)}
          >
            {busy === 'preview' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : null}
            Dry-run preview
          </Button>
          {previewData && (
            <Button
              variant="default"
              disabled={busy !== null}
              onClick={() => void submit(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {busy === 'commit' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Commit {previewData.totalParsed.toLocaleString()} rows
            </Button>
          )}
        </section>

        {/* Error surface */}
        {error && (
          <section className="mb-6 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-red-600 dark:text-red-400">{error}</div>
                {errorDetails?.headers && errorDetails.headers.length > 0 && (
                  <div className="mt-3 text-[11px]">
                    <div className="font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      Detected headers
                    </div>
                    <code className="text-[11px] text-muted-foreground break-all">
                      {errorDetails.headers.join(' · ')}
                    </code>
                  </div>
                )}
                {errorDetails?.rows && errorDetails.rows.length > 0 && (
                  <div className="mt-3 text-[11px]">
                    <div className="font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      Parse errors (first 25)
                    </div>
                    <ul className="space-y-0.5">
                      {errorDetails.rows.slice(0, 25).map((e, i) => (
                        <li key={i} className="text-muted-foreground">
                          row {e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Preview surface */}
        {previewData && !completeData && (
          <section className="mb-6 rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-amber-500/5 flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Dry run — nothing written yet</span>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Parsed rows" value={previewData.totalParsed} />
                <Stat
                  label="Parse errors"
                  value={previewData.parseErrors?.length ?? 0}
                  warn={(previewData.parseErrors?.length ?? 0) > 0}
                />
                {typeof previewData.matched === 'number' && (
                  <Stat label="Matched facilities" value={previewData.matched} />
                )}
              </div>
              {previewData.detectedHeaders && previewData.detectedHeaders.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    Detected headers
                  </div>
                  <code className="text-[11px] text-muted-foreground block break-all">
                    {previewData.detectedHeaders.join(' · ')}
                  </code>
                </div>
              )}
              {previewData.categories && Object.keys(previewData.categories).length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    Top categories
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(previewData.categories).slice(0, 10).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-background text-[11px]"
                      >
                        {k}
                        <span className="text-muted-foreground tabular-nums">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {previewData.sample && previewData.sample.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    Sample rows (first {previewData.sample.length})
                  </div>
                  <pre className="bg-muted/30 rounded p-2 text-[10px] overflow-x-auto max-h-48 overflow-y-auto">
                    {JSON.stringify(previewData.sample, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Commit success */}
        {completeData && (
          <section className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  Import complete
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <Stat
                    label="Inserted"
                    value={completeData.result?.inserted ?? completeData.insertedCount ?? 0}
                  />
                  <Stat
                    label="Skipped (dupes)"
                    value={completeData.result?.skipped ?? completeData.skippedDuplicates ?? 0}
                  />
                  <Stat
                    label="Parse errors"
                    value={completeData.result?.parseErrors ?? 0}
                  />
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
                  Import another file
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-base font-semibold tabular-nums mt-0.5',
          warn ? 'text-amber-500' : 'text-foreground',
        )}
      >
        {value.toLocaleString()}
      </div>
    </div>
  )
}
