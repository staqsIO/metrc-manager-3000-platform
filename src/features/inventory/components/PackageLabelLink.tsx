'use client'

import { usePackageModal } from '@/features/inventory/PackageModalContext'
import { cn } from '@/lib/utils'

interface PackageLabelLinkProps {
  label: string
  className?: string
}

export default function PackageLabelLink({ label, className }: PackageLabelLinkProps) {
  const { openPackageModal } = usePackageModal()

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        openPackageModal(label)
      }}
      title={label}
      className={cn(
        'font-mono text-xs hover:text-primary hover:underline transition-colors text-left',
        className,
      )}
    >
      {label}
    </button>
  )
}
