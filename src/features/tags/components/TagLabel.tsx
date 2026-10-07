'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { abbreviateTag } from '@/features/tags/utils'

interface TagLabelProps {
  label: string
  showFull?: boolean
  copyable?: boolean
  className?: string
}

export default function TagLabel({ label, showFull = false, copyable = false, className }: TagLabelProps) {
  const [copied, setCopied] = useState(false)
  const shortLabel = abbreviateTag(label)
  const display = showFull ? label : shortLabel

  const handleCopy = async () => {
    if (!copyable) return
    try {
      await navigator.clipboard.writeText(label)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable or permission denied
    }
  }

  return (
    <span
      title={label}
      onClick={copyable ? handleCopy : undefined}
      className={cn(
        'font-mono text-sm',
        copyable && 'cursor-pointer hover:text-primary transition-colors',
        copied && 'text-emerald-500',
        className,
      )}
    >
      {copied ? 'Copied!' : display}
    </span>
  )
}
