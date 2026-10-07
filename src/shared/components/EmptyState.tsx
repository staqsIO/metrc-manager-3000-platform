'use client'

import type { LucideIcon } from 'lucide-react'
import { PackageOpen, SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  variant?: 'onboarding' | 'filtered'
}

export function EmptyState({
  icon,
  title,
  description,
  variant = 'filtered',
}: EmptyStateProps) {
  const Icon = icon ?? (variant === 'onboarding' ? PackageOpen : SearchX)

  return (
    <tr>
      <td colSpan={99} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2">
          <Icon className={cn(
            'h-8 w-8',
            variant === 'onboarding' ? 'text-muted-foreground/50' : 'text-muted-foreground/40'
          )} />
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground/70">{description}</p>
          )}
        </div>
      </td>
    </tr>
  )
}
