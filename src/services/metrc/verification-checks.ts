/**
 * Per-mutation-type verification functions.
 *
 * Each function compares a "before" state snapshot with a "after" re-read from Metrc
 * and returns { verified, discrepancies }.  Discrepancies describe which fields
 * didn't match the expected post-mutation values.
 */

import type { MetrcPackage, MetrcHarvest, MetrcHarvestWaste, MetrcPlantBatch, MetrcPlant } from './types';

export interface Discrepancy {
  entityId: string;
  field: string;
  expected: string;
  actual: string;
}

export interface VerificationResult {
  verified: boolean;
  discrepancies: Discrepancy[];
}

// ---------------------------------------------------------------------------
// Package checks
// ---------------------------------------------------------------------------

/**
 * After adjustPackages: quantity should equal the target value and LastModified should update.
 */
export function checkPackageAdjustment(
  before: Array<{ Label: string; Quantity: number; LastModified: string }>,
  after: MetrcPackage[],
  expectedQuantities: Record<string, number>,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(after.map(p => [p.Label, p]));

  for (const b of before) {
    const a = afterMap.get(b.Label);
    if (!a) {
      discrepancies.push({ entityId: b.Label, field: 'existence', expected: 'present', actual: 'not found in after-read' });
      continue;
    }
    const expectedQty = expectedQuantities[b.Label];
    if (expectedQty !== undefined && Math.abs(a.Quantity - expectedQty) > 0.01) {
      discrepancies.push({
        entityId: b.Label,
        field: 'Quantity',
        expected: String(expectedQty),
        actual: String(a.Quantity),
      });
    }
    if (a.LastModified === b.LastModified) {
      discrepancies.push({
        entityId: b.Label,
        field: 'LastModified',
        expected: `newer than ${b.LastModified}`,
        actual: a.LastModified,
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After finishPackages: packages should no longer appear in the active list.
 */
export function checkPackageFinish(
  labels: string[],
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const activeLabels = new Set(activeAfter.map(p => p.Label));

  for (const label of labels) {
    if (activeLabels.has(label)) {
      discrepancies.push({
        entityId: label,
        field: 'active status',
        expected: 'removed from active list',
        actual: 'still in active list',
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After changePackageNote: Note field matches expected value, LastModified updated.
 */
export function checkPackageNoteChange(
  before: Array<{ Label: string; LastModified: string }>,
  after: MetrcPackage[],
  expectedNotes: Record<string, string>,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(after.map(p => [p.Label, p]));

  for (const b of before) {
    const a = afterMap.get(b.Label);
    if (!a) {
      discrepancies.push({ entityId: b.Label, field: 'existence', expected: 'present', actual: 'not found in after-read' });
      continue;
    }
    const expectedNote = expectedNotes[b.Label];
    if (expectedNote !== undefined && a.Note !== expectedNote) {
      discrepancies.push({
        entityId: b.Label,
        field: 'Note',
        expected: expectedNote,
        actual: a.Note,
      });
    }
    if (a.LastModified === b.LastModified) {
      discrepancies.push({
        entityId: b.Label,
        field: 'LastModified',
        expected: `newer than ${b.LastModified}`,
        actual: a.LastModified,
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After remediatePackages: ContainsRemediatedProduct = true, LastModified updated.
 */
export function checkPackageRemediation(
  before: Array<{ Label: string; LastModified: string }>,
  after: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(after.map(p => [p.Label, p]));

  for (const b of before) {
    const a = afterMap.get(b.Label);
    if (!a) {
      discrepancies.push({ entityId: b.Label, field: 'existence', expected: 'present', actual: 'not found in after-read' });
      continue;
    }
    if (!a.ContainsRemediatedProduct) {
      discrepancies.push({
        entityId: b.Label,
        field: 'ContainsRemediatedProduct',
        expected: 'true',
        actual: 'false',
      });
    }
    if (a.LastModified === b.LastModified) {
      discrepancies.push({
        entityId: b.Label,
        field: 'LastModified',
        expected: `newer than ${b.LastModified}`,
        actual: a.LastModified,
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After recordLabTests: LabTestingState should match expected pass/fail.
 */
export function checkLabTestRecord(
  packageLabel: string,
  overallPassed: boolean,
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const pkg = activeAfter.find(p => p.Label === packageLabel);

  if (!pkg) {
    discrepancies.push({
      entityId: packageLabel,
      field: 'existence',
      expected: 'present in active packages',
      actual: 'not found',
    });
    return { verified: discrepancies.length === 0, discrepancies };
  }

  const expectedState = overallPassed ? 'TestPassed' : 'TestFailed';
  if (pkg.LabTestingState !== expectedState) {
    discrepancies.push({
      entityId: packageLabel,
      field: 'LabTestingState',
      expected: expectedState,
      actual: pkg.LabTestingState,
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After submitPackagesForTesting: LabTestingState should be 'SubmittedForTesting'.
 */
export function checkSubmitForTesting(
  labels: string[],
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(activeAfter.map(p => [p.Label, p]));

  for (const label of labels) {
    const a = afterMap.get(label);
    if (!a) {
      discrepancies.push({
        entityId: label,
        field: 'existence',
        expected: 'present in active packages',
        actual: 'not found',
      });
      continue;
    }
    if (a.LabTestingState !== 'SubmittedForTesting') {
      discrepancies.push({
        entityId: label,
        field: 'LabTestingState',
        expected: 'SubmittedForTesting',
        actual: a.LabTestingState,
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After changePackageLocations: LocationName should match expected location.
 */
export function checkPackageLocationChange(
  moves: Array<{ label: string; expectedLocation: string }>,
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(activeAfter.map(p => [p.Label, p]));

  for (const move of moves) {
    const a = afterMap.get(move.label);
    if (!a) {
      discrepancies.push({
        entityId: move.label,
        field: 'existence',
        expected: 'present in active packages',
        actual: 'not found',
      });
      continue;
    }
    if (a.LocationName !== move.expectedLocation) {
      discrepancies.push({
        entityId: move.label,
        field: 'LocationName',
        expected: move.expectedLocation,
        actual: a.LocationName,
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After createExternalOutgoingTransfers: outgoing transfer count increased.
 */
export function checkOutgoingTransferCreate(
  beforeCount: number,
  afterCount: number,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  if (afterCount <= beforeCount) {
    discrepancies.push({
      entityId: 'outgoing-transfers',
      field: 'count',
      expected: `> ${beforeCount}`,
      actual: String(afterCount),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After createSalesReceipts: sales receipt count increased.
 */
export function checkSalesReceiptCreate(
  beforeCount: number,
  afterCount: number,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  if (afterCount <= beforeCount) {
    discrepancies.push({
      entityId: 'sales-receipts',
      field: 'count',
      expected: `> ${beforeCount}`,
      actual: String(afterCount),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

// ---------------------------------------------------------------------------
// Harvest checks
// ---------------------------------------------------------------------------

/**
 * After finishHarvests: FinishedDate should now be set.
 */
export function checkHarvestFinish(
  harvestIds: number[],
  after: MetrcHarvest[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(after.map(h => [h.Id, h]));

  for (const id of harvestIds) {
    const a = afterMap.get(id);
    if (!a) {
      // Harvest moved out of active list — expected for finish
      continue;
    }
    if (!a.FinishedDate) {
      discrepancies.push({
        entityId: String(id),
        field: 'FinishedDate',
        expected: 'set (non-null)',
        actual: 'null',
      });
    }
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After recordHarvestWaste: TotalWasteWeight >= before + addedWeight.
 */
export function checkHarvestWaste(
  harvestId: number,
  beforeTotalWaste: number,
  addedWeight: number,
  after: MetrcHarvest,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const expectedMin = Math.round((beforeTotalWaste + addedWeight) * 100) / 100;

  if (after.TotalWasteWeight < expectedMin - 0.01) {
    discrepancies.push({
      entityId: String(harvestId),
      field: 'TotalWasteWeight',
      expected: `>= ${expectedMin}`,
      actual: String(after.TotalWasteWeight),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

// ---------------------------------------------------------------------------
// Plant Batch checks
// ---------------------------------------------------------------------------

/**
 * After destroyPlantBatches: Count decreased by expected amount.
 */
export function checkPlantBatchDestroy(
  batchId: number,
  beforeCount: number,
  destroyedCount: number,
  after: MetrcPlantBatch | null,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  if (!after) {
    // Batch no longer found — could be fully destroyed, which is valid
    if (beforeCount !== destroyedCount) {
      discrepancies.push({
        entityId: String(batchId),
        field: 'existence',
        expected: `still present (destroyed ${destroyedCount} of ${beforeCount})`,
        actual: 'not found',
      });
    }
    return { verified: discrepancies.length === 0, discrepancies };
  }

  const expectedCount = beforeCount - destroyedCount;
  if (Math.abs(after.Count - expectedCount) > 0) {
    discrepancies.push({
      entityId: String(batchId),
      field: 'Count',
      expected: String(expectedCount),
      actual: String(after.Count),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After createPackagesFromHarvest: the output tag should appear in active packages.
 */
export function checkHarvestPackageCreate(
  outputTag: string,
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const found = activeAfter.some(p => p.Label === outputTag);

  if (!found) {
    discrepancies.push({
      entityId: outputTag,
      field: 'existence',
      expected: 'present in active packages',
      actual: 'not found',
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After createPlantBatches: the batch should appear in active batches.
 */
export function checkPlantBatchCreate(
  batchName: string,
  activeAfter: MetrcPlantBatch[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const found = activeAfter.some(b => b.Name === batchName);

  if (!found) {
    discrepancies.push({
      entityId: batchName,
      field: 'existence',
      expected: 'present in active batches',
      actual: 'not found',
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After changePlantBatchGrowthPhase: verify the batch was modified.
 * MetrcPlantBatch does not expose GrowthPhase directly, so we verify
 * that the batch's LastModified timestamp changed (indicating the
 * operation was processed) or the count decreased (plants moved out).
 */
export function checkGrowthPhaseChange(
  batchId: number,
  expectedCount: number,
  before: MetrcPlantBatch | null,
  after: MetrcPlantBatch | null,
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  if (!after) {
    // Batch may have been split or renamed — not necessarily an error
    return { verified: true, discrepancies };
  }

  if (after.Count === 0) {
    // Batch was fully transitioned — expected
    return { verified: true, discrepancies };
  }

  // Verify the batch was actually modified by comparing LastModified
  if (before && after.LastModified === before.LastModified) {
    discrepancies.push({
      entityId: String(batchId),
      field: 'LastModified',
      expected: 'changed after growth phase transition',
      actual: `unchanged (${after.LastModified})`,
    });
  }

  // If we know the expected count to remain, verify it
  if (expectedCount > 0 && after.Count !== expectedCount) {
    discrepancies.push({
      entityId: String(batchId),
      field: 'Count',
      expected: String(expectedCount),
      actual: String(after.Count),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

// ---------------------------------------------------------------------------
// Processing checks
// ---------------------------------------------------------------------------

/**
 * After createProcessingPackages: source package quantities decreased
 * and output tag exists in active packages.
 */
export function checkProcessingCreate(
  sourceBefore: Array<{ Label: string; Quantity: number }>,
  sourceQuantitiesUsed: Record<string, number>,
  outputTag: string,
  activeAfter: MetrcPackage[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(activeAfter.map(p => [p.Label, p]));

  // Check source quantities decreased
  for (const src of sourceBefore) {
    const a = afterMap.get(src.Label);
    if (!a) {
      // Source package may have been fully consumed
      continue;
    }
    const used = sourceQuantitiesUsed[src.Label] ?? 0;
    const expectedQty = Math.round((src.Quantity - used) * 100) / 100;
    if (Math.abs(a.Quantity - expectedQty) > 0.01) {
      discrepancies.push({
        entityId: src.Label,
        field: 'Quantity',
        expected: String(expectedQty),
        actual: String(a.Quantity),
      });
    }
  }

  // Check output tag exists
  if (!afterMap.has(outputTag)) {
    discrepancies.push({
      entityId: outputTag,
      field: 'existence',
      expected: 'present in active packages',
      actual: 'not found',
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

// ---------------------------------------------------------------------------
// Waste & Loss checks
// ---------------------------------------------------------------------------

/**
 * After recordPlantBatchWaste: verify waste records exist for the batch.
 */
export function checkPlantBatchWaste(
  plantBatchId: number,
  beforeWasteCount: number,
  afterWaste: { Id: number }[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  if (afterWaste.length <= beforeWasteCount) {
    discrepancies.push({
      entityId: String(plantBatchId),
      field: 'wasteRecordCount',
      expected: `> ${beforeWasteCount}`,
      actual: String(afterWaste.length),
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After destroyPlants: verify plants have DestroyedDate set.
 */
export function checkPlantDestroy(
  plantIds: number[],
  afterPlants: MetrcPlant[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];
  const afterMap = new Map(afterPlants.map(p => [p.Id, p]));

  for (const id of plantIds) {
    const plant = afterMap.get(id);
    if (plant && !plant.DestroyedDate) {
      discrepancies.push({
        entityId: String(id),
        field: 'DestroyedDate',
        expected: 'not null',
        actual: 'null',
      });
    }
    // Plant not found in active list is also valid (fully destroyed)
  }

  return { verified: discrepancies.length === 0, discrepancies };
}

/**
 * After deleteHarvestWaste: verify waste record no longer exists.
 */
export function checkHarvestWasteDelete(
  wasteId: number,
  afterWaste: MetrcHarvestWaste[],
): VerificationResult {
  const discrepancies: Discrepancy[] = [];

  const stillExists = afterWaste.some(w => w.Id === wasteId);
  if (stillExists) {
    discrepancies.push({
      entityId: String(wasteId),
      field: 'existence',
      expected: 'deleted (not found)',
      actual: 'still present',
    });
  }

  return { verified: discrepancies.length === 0, discrepancies };
}
