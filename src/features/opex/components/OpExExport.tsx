'use client'

import { useCallback } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Download } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpExExportProps {
  facilityId: string
  modelId: string
  modelName: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OpExExport({ facilityId, modelId, modelName }: OpExExportProps) {
  const { data: model } = trpc.opex.getModel.useQuery(
    { facilityId, modelId },
    { enabled: !!facilityId && !!modelId, staleTime: 30_000 },
  )

  const handleExport = useCallback(() => {
    if (!model) return

    const rows: string[][] = [
      ['Section', 'Group', 'Label', 'Key', 'Type', 'Value', 'Unit', 'Formula'],
    ]

    for (const section of model.sections) {
      for (const group of section.cellGroups) {
        for (const cell of group.cells) {
          rows.push([
            section.name,
            group.label,
            cell.label,
            cell.key,
            cell.cellType,
            cell.value !== null ? String(cell.value) : '',
            cell.unit || '',
            cell.formula || '',
          ])
        }
      }
      for (const child of section.children) {
        for (const group of child.cellGroups) {
          for (const cell of group.cells) {
            rows.push([
              `${section.name} > ${child.name}`,
              group.label,
              cell.label,
              cell.key,
              cell.cellType,
              cell.value !== null ? String(cell.value) : '',
              cell.unit || '',
              cell.formula || '',
            ])
          }
        }
      }
    }

    const csv = rows
      .map((row) => row.map((val) => `"${val.replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${modelName.replace(/[^a-z0-9]/gi, '_')}_export.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [model, modelName])

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleExport}
      disabled={!model}
      className="gap-1.5"
    >
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </Button>
  )
}
