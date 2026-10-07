export type ActionStatus = 'idle' | 'previewing' | 'confirming' | 'executing' | 'completed' | 'verified' | 'unverified' | 'error'

export interface AdjustmentInput {
  Label: string
  Quantity: number
  UnitOfMeasureName: string
  AdjustmentReason: string
}

export interface AdjustmentPreview {
  Label: string
  ItemName: string
  currentQuantity: number
  newQuantity: number
  reason: string
}

export interface FinishPreview {
  Label: string
  ItemName: string
  Quantity: number
  action: 'finish'
}

export type BulkActionType = 'adjust' | 'finish'

export interface BulkActionState {
  type: BulkActionType | null
  status: ActionStatus
  selectedLabels: string[]
  previews: AdjustmentPreview[] | FinishPreview[]
  error: string | null
  verified?: boolean
}

// Aging page action types
export type AgingActionType = 'discount' | 'sample_out' | 'destroy' | 'remediate' | 'expedite_testing' | 'fifo_priority'

export interface AgingActionInput {
  actionType: AgingActionType
  packageLabel: string
  packageName: string
  currentQuantity: number
  unitOfMeasure: string
  newQuantity?: number
  note?: string
}
