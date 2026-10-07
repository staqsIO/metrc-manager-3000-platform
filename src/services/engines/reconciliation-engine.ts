// ---------------------------------------------------------------------------
// Reconciliation Engine
//
// Parses CSV / XLSX files containing external inventory records and matches
// them against Metrc active packages.  Returns diff rows ready for the
// BulkEditGrid UI.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import type { MetrcPackage } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedRow {
  label: string;
  quantity: number | null;
  category: string | null;
  location: string | null;
  /** Original 1-based row in the source file (for error messages) */
  sourceRow: number;
}

export type RowStatus = 'match' | 'mismatch' | 'missing_in_metrc' | 'missing_in_external';

export interface ReconciliationRow {
  label: string;
  metrcQuantity: number | null;
  externalQuantity: number | null;
  delta: number | null;
  unitOfMeasure: string;
  itemName: string;
  status: RowStatus;
  adjustmentReason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
  detectedColumns: Record<string, string>;
}

export interface AdjustmentPayloadItem {
  Label: string;
  Quantity: number; // delta (not absolute)
  UnitOfMeasureName: string;
  AdjustmentReason: string;
  AdjustmentDate: string;
}

// ---------------------------------------------------------------------------
// Column aliases — case-insensitive header detection
// ---------------------------------------------------------------------------

const LABEL_ALIASES = new Set([
  'label', 'package label', 'package tag', 'pkg label', 'tag', 'tag #',
  'tag number', 'package id', 'packagelabel', 'packagetag', 'pkglabel',
]);
const QUANTITY_ALIASES = new Set([
  'quantity', 'qty', 'amount', 'count', 'external qty', 'external quantity',
  'externalqty', 'externalquantity',
]);
const CATEGORY_ALIASES = new Set([
  'category', 'item category', 'itemcategory', 'type',
]);
const LOCATION_ALIASES = new Set([
  'location', 'room', 'locationname', 'room name', 'roomname',
]);

function matchAlias(header: string, aliases: Set<string>): boolean {
  return aliases.has(header.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// parseReconciliationFile
// ---------------------------------------------------------------------------

export function parseReconciliationFile(
  buffer: ArrayBuffer,
  filename: string,
): ParseResult {
  const errors: string[] = [];
  const detectedColumns: Record<string, string> = {};

  const ext = filename.toLowerCase().split('.').pop();
  if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
    return { rows: [], errors: ['Unsupported file type. Please upload .csv, .xlsx, or .xls'], detectedColumns };
  }

  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ['File contains no sheets'], detectedColumns };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (jsonRows.length === 0) {
    return { rows: [], errors: ['File is empty or has no data rows'], detectedColumns };
  }

  // Detect columns from headers
  const headers = Object.keys(jsonRows[0]!);
  let labelCol: string | null = null;
  let qtyCol: string | null = null;
  let categoryCol: string | null = null;
  let locationCol: string | null = null;

  for (const h of headers) {
    if (!labelCol && matchAlias(h, LABEL_ALIASES)) labelCol = h;
    if (!qtyCol && matchAlias(h, QUANTITY_ALIASES)) qtyCol = h;
    if (!categoryCol && matchAlias(h, CATEGORY_ALIASES)) categoryCol = h;
    if (!locationCol && matchAlias(h, LOCATION_ALIASES)) locationCol = h;
  }

  if (!labelCol) {
    // Fallback: first column is label
    labelCol = headers[0] ?? null;
    if (labelCol) {
      errors.push(`Could not detect a "Label" column — using first column "${labelCol}"`);
    } else {
      return { rows: [], errors: ['No columns found in file'], detectedColumns };
    }
  }

  detectedColumns['label'] = labelCol;
  if (qtyCol) detectedColumns['quantity'] = qtyCol;
  if (categoryCol) detectedColumns['category'] = categoryCol;
  if (locationCol) detectedColumns['location'] = locationCol;

  const rows: ParsedRow[] = [];
  const seenLabels = new Set<string>();

  for (let i = 0; i < jsonRows.length; i++) {
    const raw = jsonRows[i]!;
    const label = String(raw[labelCol] ?? '').trim();
    if (!label) {
      errors.push(`Row ${i + 2}: Empty label — skipped`);
      continue;
    }

    if (seenLabels.has(label)) {
      errors.push(`Row ${i + 2}: Duplicate label "${label}" — skipped`);
      continue;
    }
    seenLabels.add(label);

    let quantity: number | null = null;
    if (qtyCol) {
      const rawQty = raw[qtyCol];
      const parsed = typeof rawQty === 'number' ? rawQty : parseFloat(String(rawQty));
      if (!isNaN(parsed)) {
        quantity = parsed;
      } else if (String(rawQty).trim() !== '') {
        errors.push(`Row ${i + 2}: Invalid quantity "${rawQty}" for label "${label}"`);
      }
    }

    rows.push({
      label,
      quantity,
      category: categoryCol ? String(raw[categoryCol] ?? '').trim() || null : null,
      location: locationCol ? String(raw[locationCol] ?? '').trim() || null : null,
      sourceRow: i + 2,
    });
  }

  return { rows, errors, detectedColumns };
}

// ---------------------------------------------------------------------------
// matchRows — join parsed rows with Metrc packages
// ---------------------------------------------------------------------------

export function matchRows(
  parsed: ParsedRow[],
  metrcPackages: MetrcPackage[],
): ReconciliationRow[] {
  const metrcMap = new Map<string, MetrcPackage>();
  for (const pkg of metrcPackages) {
    metrcMap.set(pkg.Label, pkg);
  }

  const result: ReconciliationRow[] = [];
  const matchedLabels = new Set<string>();

  // Process each parsed row
  for (const row of parsed) {
    const pkg = metrcMap.get(row.label);
    matchedLabels.add(row.label);

    if (!pkg) {
      result.push({
        label: row.label,
        metrcQuantity: null,
        externalQuantity: row.quantity,
        delta: null,
        unitOfMeasure: '',
        itemName: '',
        status: 'missing_in_metrc',
        adjustmentReason: '',
      });
      continue;
    }

    const delta = row.quantity !== null ? row.quantity - pkg.Quantity : null;
    const isMatch = delta !== null && Math.abs(delta) < 0.01;

    result.push({
      label: row.label,
      metrcQuantity: pkg.Quantity,
      externalQuantity: row.quantity,
      delta: delta !== null ? Math.round(delta * 100) / 100 : null,
      unitOfMeasure: pkg.UnitOfMeasureName,
      itemName: pkg.ItemName,
      status: isMatch ? 'match' : 'mismatch',
      adjustmentReason: '',
    });
  }

  // Metrc packages not in external data
  for (const pkg of metrcPackages) {
    if (!matchedLabels.has(pkg.Label)) {
      result.push({
        label: pkg.Label,
        metrcQuantity: pkg.Quantity,
        externalQuantity: null,
        delta: null,
        unitOfMeasure: pkg.UnitOfMeasureName,
        itemName: pkg.ItemName,
        status: 'missing_in_external',
        adjustmentReason: '',
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// getAdjustableRows — shared filter for rows that can be adjusted
// ---------------------------------------------------------------------------

export function getAdjustableRows(rows: ReconciliationRow[]): ReconciliationRow[] {
  return rows.filter(
    r => r.metrcQuantity !== null &&
      r.externalQuantity !== null &&
      r.delta !== null &&
      Math.abs(r.delta) >= 0.01 &&
      r.adjustmentReason,
  );
}

// ---------------------------------------------------------------------------
// buildAdjustmentPayload — create Metrc-ready adjustment objects
// ---------------------------------------------------------------------------

export function buildAdjustmentPayload(
  rows: ReconciliationRow[],
): AdjustmentPayloadItem[] {
  const adjustments: AdjustmentPayloadItem[] = [];
  const today = new Date().toISOString().split('T')[0]!;

  for (const row of rows) {
    if (
      row.metrcQuantity === null ||
      row.externalQuantity === null ||
      row.delta === null ||
      Math.abs(row.delta) < 0.01
    ) {
      continue;
    }

    if (!row.adjustmentReason) continue;

    adjustments.push({
      Label: row.label,
      Quantity: row.delta, // Metrc expects delta
      UnitOfMeasureName: row.unitOfMeasure,
      AdjustmentReason: row.adjustmentReason,
      AdjustmentDate: today,
    });
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// CSV template
// ---------------------------------------------------------------------------

export function generateCsvTemplate(): string {
  return 'Label,Quantity,Category,Location\n';
}
