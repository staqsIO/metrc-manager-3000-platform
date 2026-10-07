import { cn } from '@/lib/utils'
import { Package, FlaskConical, CheckCircle2, Warehouse, Archive } from 'lucide-react'

type LifecycleStage = 'created' | 'testing' | 'in-stock' | 'finished' | 'archived'

interface PackageLifecycleStepperProps {
  packagedDate: string | null
  labTestingState: string | null
  quantity: number | null
  finishedDate?: string | null
  archivedDate?: string | null
  isOnHold?: boolean
  className?: string
}

const STAGES: { id: LifecycleStage; label: string; icon: React.ElementType; dotActive: string; ringActive: string; textActive: string; lineActive: string }[] = [
  { id: 'created', label: 'Created', icon: Package, dotActive: 'bg-blue-500', ringActive: 'ring-blue-500/30', textActive: 'text-blue-500', lineActive: 'bg-blue-500' },
  { id: 'testing', label: 'Testing', icon: FlaskConical, dotActive: 'bg-purple-500', ringActive: 'ring-purple-500/30', textActive: 'text-purple-500', lineActive: 'bg-purple-500' },
  { id: 'in-stock', label: 'In Stock', icon: Warehouse, dotActive: 'bg-emerald-500', ringActive: 'ring-emerald-500/30', textActive: 'text-emerald-500', lineActive: 'bg-emerald-500' },
  { id: 'finished', label: 'Finished', icon: CheckCircle2, dotActive: 'bg-muted-foreground', ringActive: 'ring-muted-foreground/30', textActive: 'text-muted-foreground', lineActive: 'bg-muted-foreground' },
  { id: 'archived', label: 'Archived', icon: Archive, dotActive: 'bg-muted-foreground', ringActive: 'ring-muted-foreground/30', textActive: 'text-muted-foreground', lineActive: 'bg-muted-foreground' },
]

const STAGE_INDEX: Record<LifecycleStage, number> = {
  created: 0, testing: 1, 'in-stock': 2, finished: 3, archived: 4,
}

function resolveStage(props: PackageLifecycleStepperProps): LifecycleStage {
  if (props.archivedDate) return 'archived'
  if (props.finishedDate || (props.quantity != null && props.quantity <= 0)) return 'finished'
  if (
    props.labTestingState &&
    props.labTestingState !== 'NotSubmitted' &&
    props.labTestingState !== 'NotRequired'
  ) {
    if (props.labTestingState === 'TestPassed' || props.labTestingState === 'TestFailed') {
      return 'in-stock'
    }
    return 'testing'
  }
  if (props.packagedDate) return 'in-stock'
  return 'created'
}

export function PackageLifecycleStepper(props: PackageLifecycleStepperProps) {
  const currentStage = resolveStage(props)
  const currentIdx = STAGE_INDEX[currentStage]

  return (
    <div className={cn('flex items-center', props.className)}>
      {STAGES.map((stage, i) => {
        const isCompleted = i < currentIdx
        const isCurrent = i === currentIdx
        const isPending = i > currentIdx

        return (
          <div key={stage.id} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  'h-0.5 w-6',
                  isCompleted || isCurrent ? stage.lineActive : 'bg-muted-foreground/20'
                )}
              />
            )}

            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex items-center justify-center rounded-full transition-colors',
                  isCurrent && cn('h-7 w-7 ring-2 ring-offset-2 ring-offset-background', stage.dotActive, stage.ringActive),
                  isCompleted && cn('h-6 w-6', stage.dotActive),
                  isPending && 'h-6 w-6 bg-muted-foreground/20',
                )}
              >
                <stage.icon
                  className={cn(
                    'h-3 w-3',
                    isCompleted || isCurrent ? 'text-white' : 'text-muted-foreground/50'
                  )}
                />
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium whitespace-nowrap',
                  isCurrent && stage.textActive,
                  isCompleted && 'text-muted-foreground',
                  isPending && 'text-muted-foreground/50',
                )}
              >
                {stage.label}
              </span>
            </div>
          </div>
        )
      })}

      {props.isOnHold && (
        <span className="ml-3 inline-flex items-center rounded-full bg-yellow-500/10 text-yellow-500 px-2 py-0.5 text-[10px] font-medium">
          On Hold
        </span>
      )}
    </div>
  )
}
