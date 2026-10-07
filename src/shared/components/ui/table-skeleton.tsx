import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

interface TableSkeletonRowsProps {
  columns: number
  rows?: number
  columnWidths?: string[]
}

const DEFAULT_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16']

/**
 * Renders skeleton <tr> elements for use inside a <tbody>.
 * The table header stays stable to prevent layout shift.
 */
export function TableSkeletonRows({
  columns,
  rows = 5,
  columnWidths,
}: TableSkeletonRowsProps) {
  const widths = columnWidths ?? DEFAULT_WIDTHS

  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-border/50">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} className="py-3 px-4">
              <Skeleton
                className={cn('h-4', widths[colIdx % widths.length])}
                style={{ animationDelay: `${rowIdx * 75}ms` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
