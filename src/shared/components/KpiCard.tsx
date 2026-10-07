'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color?: string
  prefix?: string
  suffix?: string
  isText?: boolean
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  color = 'text-foreground',
  prefix,
  suffix,
  isText,
}: KpiCardProps) {
  const formattedValue = isText
    ? value
    : typeof value === 'number'
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value

  return (
    <div className="card-modern p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('h-4 w-4', color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-bold', color)}>
        {prefix}{formattedValue}{suffix && <span className="text-sm font-normal ml-1">{suffix}</span>}
      </p>
    </div>
  )
}
