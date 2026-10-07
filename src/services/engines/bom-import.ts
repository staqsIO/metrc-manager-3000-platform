/**
 * bom-import.ts — BOM Spreadsheet Import
 *
 * Parses .xlsx files with BOM data. Expected columns:
 *   Metrc Item Name | Category | Component Name | Qty Per Unit | Unit
 */

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BOMImportLine {
  metrcItemName: string
  metrcItemCategory: string | null
  componentName: string
  quantityPerUnit: number
  unit: string
}

export interface BOMImportResult {
  lines: BOMImportLine[]
  warnings: string[]
  errors: string[]
  stats: {
    totalRows: number
    validRows: number
    skippedRows: number
  }
}

// ---------------------------------------------------------------------------
// Column header matching
// ---------------------------------------------------------------------------

const HEADER_PATTERNS: Record<string, RegExp> = {
  metrcItemName: /metrc\s*item\s*name|output\s*item|product\s*name|item\s*name/i,
  category: /category|item\s*category|type/i,
  componentName: /component\s*name|component|input\s*item|material|ingredient/i,
  quantityPerUnit: /qty\s*per\s*unit|quantity\s*per\s*unit|ratio|qty|quantity/i,
  unit: /unit|uom|unit\s*of\s*measure/i,
};

function matchHeaders(
  row: (string | number | undefined)[],
): Record<string, number> | null {
  const mapping: Record<string, number> = {};

  for (let col = 0; col < row.length; col++) {
    const cellVal = String(row[col] ?? '').trim();
    if (!cellVal) continue;

    for (const [field, pattern] of Object.entries(HEADER_PATTERNS)) {
      if (!mapping[field] && pattern.test(cellVal)) {
        mapping[field] = col;
      }
    }
  }

  // Require at least metrcItemName, componentName, quantityPerUnit
  if (mapping.metrcItemName == null || mapping.componentName == null || mapping.quantityPerUnit == null) {
    return null;
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parseBOMXlsx(buffer: ArrayBuffer): BOMImportResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const lines: BOMImportLine[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, {
      header: 1,
      defval: undefined,
    });

    if (rows.length < 2) {
      warnings.push(`Sheet "${sheetName}": too few rows, skipped`);
      continue;
    }

    // Find header row (try first 3 rows)
    let headerMap: Record<string, number> | null = null;
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      headerMap = matchHeaders(rows[i]);
      if (headerMap) {
        headerRowIdx = i;
        break;
      }
    }

    if (!headerMap) {
      errors.push(
        `Sheet "${sheetName}": could not find required columns (Metrc Item Name, Component Name, Qty Per Unit)`,
      );
      continue;
    }

    const MAX_ROWS = 1000;
    const dataRowEnd = Math.min(rows.length, headerRowIdx + MAX_ROWS + 1);

    if (rows.length > headerRowIdx + MAX_ROWS + 1) {
      warnings.push(`Sheet "${sheetName}": truncated at ${MAX_ROWS} rows (${rows.length - headerRowIdx - 1} total)`);
    }

    for (let i = headerRowIdx + 1; i < dataRowEnd; i++) {
      const row = rows[i];
      totalRows++;

      const metrcItemName = String(row[headerMap.metrcItemName] ?? '').trim();
      const componentName = String(row[headerMap.componentName] ?? '').trim();
      const rawQty = row[headerMap.quantityPerUnit];
      const qty = typeof rawQty === 'number' ? rawQty : parseFloat(String(rawQty ?? ''));

      if (!metrcItemName || !componentName) {
        skippedRows++;
        continue;
      }

      if (isNaN(qty) || qty <= 0) {
        warnings.push(`Row ${i + 1}: invalid quantity "${rawQty}" for ${metrcItemName} → ${componentName}, skipped`);
        skippedRows++;
        continue;
      }

      const category = headerMap.category != null
        ? String(row[headerMap.category] ?? '').trim() || null
        : null;
      const unit = headerMap.unit != null
        ? String(row[headerMap.unit] ?? '').trim() || 'Each'
        : 'Each';

      lines.push({
        metrcItemName,
        metrcItemCategory: category,
        componentName,
        quantityPerUnit: qty,
        unit,
      });
    }
  }

  return {
    lines,
    warnings,
    errors,
    stats: {
      totalRows,
      validRows: lines.length,
      skippedRows,
    },
  };
}
