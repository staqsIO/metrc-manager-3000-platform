'use client'

import { Button } from '@/shared/components/ui/button'
import { cn } from '@/lib/utils'
import type { MetrcEnvironment } from '@/lib/facility-context'
import { ENV_CONFIG } from '../constants'

export function EnvironmentSelector({
  value,
  onChange,
  onTestConnection,
  isChanging,
  isTesting,
  options = ['mock', 'sandbox', 'production'],
}: {
  value: MetrcEnvironment
  onChange: (env: MetrcEnvironment) => void
  onTestConnection: () => void
  isChanging: boolean
  isTesting: boolean
  options?: MetrcEnvironment[]
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">Environment:</span>
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {options.map(envOption => {
          const cfg = ENV_CONFIG[envOption]
          const isActive = value === envOption
          return (
            <button
              key={envOption}
              type="button"
              onClick={() => { if (!isActive) onChange(envOption) }}
              disabled={isChanging}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? cn(cfg.bgColor, cfg.color)
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {cfg.label}
            </button>
          )
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onTestConnection}
        disabled={isTesting}
        className="ml-auto"
      >
        {isTesting ? 'Testing...' : 'Test Connection'}
      </Button>
    </div>
  )
}
