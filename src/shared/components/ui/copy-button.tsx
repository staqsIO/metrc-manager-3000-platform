'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Copy } from 'lucide-react'

export function CopyButton({ value, label, compact }: { value: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono transition-colors group',
        compact
          ? 'text-xs text-muted-foreground hover:text-foreground'
          : 'px-2 py-1 rounded-md text-sm bg-muted/50 hover:bg-muted',
      )}
      title={`Copy ${label || value}`}
    >
      {copied ? <span className="text-emerald-500">Copied!</span> : value}
      {!copied && (
        <Copy className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  )
}
