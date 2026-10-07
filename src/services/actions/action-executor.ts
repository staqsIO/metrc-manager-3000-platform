import type { AdjustmentInput } from './action-types'

/**
 * Build adjustment input from selected packages.
 * Each package gets the same reason; quantity is set individually.
 */
export function buildAdjustments(
  packages: Array<{ Label: string; Quantity: number; UnitOfMeasureName: string }>,
  quantities: Record<string, number>,
  reason: string
): AdjustmentInput[] {
  return packages.map(pkg => ({
    Label: pkg.Label,
    Quantity: quantities[pkg.Label] ?? pkg.Quantity,
    UnitOfMeasureName: pkg.UnitOfMeasureName,
    AdjustmentReason: reason,
  }))
}

/**
 * Build finish payload from selected labels.
 */
export function buildFinishPayload(labels: string[]) {
  return labels
}
