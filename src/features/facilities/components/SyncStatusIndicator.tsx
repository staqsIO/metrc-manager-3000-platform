import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { formatDistanceToNow } from '@/shared/utils/date'

interface SyncStatusIndicatorProps {
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  /**
   * When true, renders shorter labels suitable for table cells:
   * "Never" instead of "Never synced", "Failed" instead of "Sync failed".
   */
  compact?: boolean
}

export function SyncStatusIndicator({
  lastSyncAt,
  lastSyncStatus,
  compact = false,
}: SyncStatusIndicatorProps) {
  if (!lastSyncAt) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {compact ? 'Never' : 'Never synced'}
      </span>
    )
  }

  if (lastSyncStatus === 'error' || lastSyncStatus === 'failed') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <XCircle className="h-3 w-3" />
        {compact ? 'Failed' : 'Sync failed'}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      {formatDistanceToNow(lastSyncAt)}
    </span>
  )
}
