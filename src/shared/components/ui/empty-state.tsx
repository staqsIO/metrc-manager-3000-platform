import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ElementType
  title: string
  description?: string
  variant?: 'onboarding' | 'filtered'
  colSpan?: number
  children?: React.ReactNode
}

function EmptyStateContent({
  icon: Icon,
  title,
  description,
  variant = 'onboarding',
  children,
}: Omit<EmptyStateProps, 'colSpan'>) {
  const isOnboarding = variant === 'onboarding'

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isOnboarding ? 'py-16' : 'py-8'
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'text-muted-foreground mx-auto mb-3',
            isOnboarding ? 'h-12 w-12' : 'h-8 w-8'
          )}
        />
      )}
      <h3
        className={cn(
          isOnboarding
            ? 'text-lg font-semibold'
            : 'text-sm font-medium text-muted-foreground'
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-4 flex items-center gap-3">{children}</div>
      )}
    </div>
  )
}

export function EmptyState({ colSpan, ...props }: EmptyStateProps) {
  if (colSpan != null) {
    return (
      <tr>
        <td colSpan={colSpan} className="border-0">
          <EmptyStateContent {...props} />
        </td>
      </tr>
    )
  }

  return <EmptyStateContent {...props} />
}
