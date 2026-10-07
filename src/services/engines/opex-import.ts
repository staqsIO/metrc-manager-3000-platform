// ---------------------------------------------------------------------------
// OpEx Spreadsheet Import Service
//
// Parses .xlsx files and maps them to OpEx model data structures.
// Each sheet becomes a section. Rows with labels in col A and values in col B.
// Excel formulas are translated to our formula syntax (with whitelist).
// Unsupported formulas fall back to INPUT with the computed value.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import { parseDependencies } from './opex-engine';

// Excel formula whitelist -- only these Excel functions are translatable
const FORMULA_WHITELIST = ['SUM', 'IF', 'ROUND', 'MIN', 'MAX', 'ABS', 'FLOOR', 'CEIL', 'CEILING'];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ImportedCell {
  key: string;        // Generated from sheet!cellRef, e.g., "sheet1.b5"
  label: string;      // Cell label from column A or generated
  cellType: 'INPUT' | 'COMPUTED' | 'CONSTANT';
  dataType: 'number' | 'currency' | 'percent' | 'text';
  value: number | null;
  textValue: string | null;
  formula: string | null;  // Translated formula using our syntax
  dependsOn: string[];
  unit: string | null;
  sourceSheet: string;
  sourceCell: string;   // e.g., "B12"
}

export interface ImportedGroup {
  label: string;
  cells: ImportedCell[];
}

export interface ImportedSection {
  name: string;
  slug: string;
  sortOrder: number;
  groups: ImportedGroup[];
}

export interface ImportResult {
  sections: ImportedSection[];
  warnings: string[];     // Non-fatal issues
  errors: string[];       // Fatal issues
  stats: {
    totalSheets: number;
    totalCells: number;
    inputCells: number;
    computedCells: number;
    skippedFormulas: number;  // Formulas that couldn't be translated
  };
}

// ---------------------------------------------------------------------------
// parseXlsxBuffer
// ---------------------------------------------------------------------------

/**
 * Parse an .xlsx buffer and extract OpEx model data.
 * Each sheet becomes a section. Rows with labels in col A and values in col B+.
 *
 * Key behaviors:
 * - Sheets are mapped to sections
 * - Column A = labels, Column B = values
 * - Excel formulas are translated to our formula syntax (with whitelist)
 * - Unsupported formulas fall back to INPUT with the computed value
 * - Currency detection: cells formatted as currency
 * - Percent detection: cells formatted as percentage
 */
export function parseXlsxBuffer(buffer: ArrayBuffer, filename: string): ImportResult {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
  });

  const sections: ImportedSection[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let totalCells = 0;
  let inputCells = 0;
  let computedCells = 0;
  let skippedFormulas = 0;

  for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
    const sheetName = workbook.SheetNames[sheetIdx];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const slug = sheetName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const section: ImportedSection = {
      name: sheetName,
      slug: slug || 'sheet_' + sheetIdx,
      sortOrder: sheetIdx,
      groups: [],
    };

    // Get sheet range
    const ref = sheet['!ref'];
    if (!ref) continue;

    const range = XLSX.utils.decode_range(ref);
    let currentGroupLabel = sheetName;
    let currentGroupCells: ImportedCell[] = [];

    for (let row = range.s.r; row <= range.e.r; row++) {
      const labelAddr = XLSX.utils.encode_cell({ r: row, c: 0 });
      const valueAddr = XLSX.utils.encode_cell({ r: row, c: 1 });
      const labelCell = sheet[labelAddr] as XLSX.CellObject | undefined;
      const valueCell = sheet[valueAddr] as XLSX.CellObject | undefined;

      // Skip completely empty rows
      if (!labelCell && !valueCell) {
        // Flush current group if it has cells
        if (currentGroupCells.length > 0) {
          section.groups.push({ label: currentGroupLabel, cells: currentGroupCells.slice() });
          currentGroupCells = [];
        }
        continue;
      }

      // If label exists but no value, treat as group header
      const label = labelCell ? String(labelCell.v ?? '') : '';
      if (label && !valueCell) {
        if (currentGroupCells.length > 0) {
          section.groups.push({ label: currentGroupLabel, cells: currentGroupCells.slice() });
          currentGroupCells = [];
        }
        currentGroupLabel = label;
        continue;
      }

      if (!valueCell) continue;

      // Determine cell properties
      const cellRef = XLSX.utils.encode_cell({ r: row, c: 1 });
      const key = slug + '.' + cellRef.toLowerCase();

      let cellType: 'INPUT' | 'COMPUTED' | 'CONSTANT' = 'INPUT';
      let formula: string | null = null;
      let value: number | null = null;
      let textValue: string | null = null;
      let dataType: 'number' | 'currency' | 'percent' | 'text' = 'number';

      // Detect data type from format
      const fmt = (valueCell.z as string) || '';
      if (fmt.includes('$') || fmt.includes('"$"')) {
        dataType = 'currency';
      } else if (fmt.includes('%')) {
        dataType = 'percent';
      }

      // Extract value
      if (valueCell.t === 'n') {
        value = valueCell.v as number;
      } else if (valueCell.t === 's') {
        textValue = String(valueCell.v);
        dataType = 'text';
      }

      // Handle formulas
      if (valueCell.f) {
        const translated = translateExcelFormula(valueCell.f, slug);
        if (translated.success) {
          cellType = 'COMPUTED';
          formula = translated.formula;
          computedCells++;
        } else {
          // Cannot translate -- keep as INPUT with the computed value
          cellType = 'INPUT';
          warnings.push(
            filename + ' > Sheet "' + sheetName + '" cell ' + cellRef +
            ': Formula "' + valueCell.f + '" not translatable -- imported as static value'
          );
          skippedFormulas++;
        }
      }

      if (cellType === 'INPUT') inputCells++;
      totalCells++;

      currentGroupCells.push({
        key,
        label: label || 'Cell ' + cellRef,
        cellType,
        dataType,
        value,
        textValue,
        formula,
        dependsOn: formula ? parseDependencies(formula) : [],
        unit: dataType === 'currency' ? '$' : dataType === 'percent' ? '%' : null,
        sourceSheet: sheetName,
        sourceCell: cellRef,
      });
    }

    // Flush last group
    if (currentGroupCells.length > 0) {
      section.groups.push({ label: currentGroupLabel, cells: currentGroupCells });
    }

    if (section.groups.length > 0) {
      sections.push(section);
    }
  }

  return {
    sections,
    warnings,
    errors,
    stats: {
      totalSheets: workbook.SheetNames.length,
      totalCells,
      inputCells,
      computedCells,
      skippedFormulas,
    },
  };
}

// ---------------------------------------------------------------------------
// translateExcelFormula
// ---------------------------------------------------------------------------

/**
 * Translate an Excel formula to our internal formula syntax.
 * Returns { success: true, formula } or { success: false, formula: '' }.
 *
 * Supported translations:
 * - Cell references: B5 -> sheet.b5
 * - Cross-sheet: Sheet2!B5 -> sheet2.b5
 * - SUM, IF, ROUND, MIN, MAX, ABS, FLOOR, CEIL preserved
 * - CEILING -> CEIL
 * - Arithmetic operators preserved
 */
function translateExcelFormula(
  excelFormula: string,
  currentSheet: string,
): { success: boolean; formula: string } {
  try {
    let formula = excelFormula;

    // Check for unsupported functions
    const funcPattern = /[A-Z]+\(/g;
    let match: RegExpExecArray | null;
    while ((match = funcPattern.exec(formula)) !== null) {
      const funcName = match[0].replace('(', '');
      if (!FORMULA_WHITELIST.includes(funcName)) {
        return { success: false, formula: '' };
      }
    }

    // Replace cross-sheet references: Sheet2!B5 -> sheet2.b5
    formula = formula.replace(
      /([A-Za-z0-9_]+)!([A-Z]+)(\d+)/g,
      function (_fullMatch, sheetRef: string, col: string, row: string) {
        const sheetSlug = sheetRef.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return sheetSlug + '.' + col.toLowerCase() + row;
      }
    );

    // Replace cell references in current sheet: B5 -> currentSheet.b5
    // Must not match function names (preceded by letters)
    formula = formula.replace(
      /(?<![A-Za-z_.])([A-Z])(\d+)(?![A-Za-z(])/g,
      function (_fullMatch, col: string, row: string) {
        return currentSheet + '.' + col.toLowerCase() + row;
      }
    );

    // Replace CEILING with CEIL
    formula = formula.replace(/CEILING/g, 'CEIL');

    return { success: true, formula };
  } catch {
    return { success: false, formula: '' };
  }
}
