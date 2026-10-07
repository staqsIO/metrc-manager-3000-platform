import type { MetrcPackage, MetrcHarvest, MetrcPlant } from '@/services/metrc/types';
import { calculateAgeDays, getAgeCategory } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ReportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
}

export interface ReportFilter {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in';
  value: string | number | boolean | string[];
}

export interface ReportSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ReportDefinition {
  columns: ReportColumn[];
  filters: ReportFilter[];
  groupBy: string[];
  sortBy: ReportSort[];
}

export interface ReportRow {
  [key: string]: string | number | boolean | null;
}

export interface GroupedResult {
  groupKey: string;
  groupValues: Record<string, string>;
  count: number;
  rows: ReportRow[];
  aggregates: Record<string, number>;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  groups: GroupedResult[];
  totalRows: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Available columns for inventory reports
// ---------------------------------------------------------------------------

export const INVENTORY_COLUMNS: ReportColumn[] = [
  { key: 'label', label: 'Package Label', type: 'string' },
  { key: 'itemName', label: 'Item Name', type: 'string' },
  { key: 'itemCategory', label: 'Category', type: 'string' },
  { key: 'strainName', label: 'Strain', type: 'string' },
  { key: 'quantity', label: 'Quantity', type: 'number' },
  { key: 'unitOfMeasure', label: 'Unit', type: 'string' },
  { key: 'packageType', label: 'Package Type', type: 'string' },
  { key: 'location', label: 'Location', type: 'string' },
  { key: 'room', label: 'Room', type: 'string' },
  { key: 'packagedDate', label: 'Packaged Date', type: 'date' },
  { key: 'ageDays', label: 'Age (days)', type: 'number' },
  { key: 'ageCategory', label: 'Age Category', type: 'string' },
  { key: 'labTestingState', label: 'Lab Testing', type: 'string' },
  { key: 'isOnHold', label: 'On Hold', type: 'boolean' },
  { key: 'productionBatch', label: 'Production Batch', type: 'string' },
  { key: 'lastModified', label: 'Last Modified', type: 'date' },
];

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type ReportType = 'INVENTORY' | 'HARVEST' | 'PLANT' | 'SUPPLY' | 'TOLLING' | 'OPEX';

// ---------------------------------------------------------------------------
// Harvest columns & transformer
// ---------------------------------------------------------------------------

export const HARVEST_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Harvest Name', type: 'string' },
  { key: 'harvestType', label: 'Harvest Type', type: 'string' },
  { key: 'sourceStrainNames', label: 'Strain(s)', type: 'string' },
  { key: 'dryingLocation', label: 'Drying Location', type: 'string' },
  { key: 'currentWeight', label: 'Current Weight', type: 'number' },
  { key: 'totalWasteWeight', label: 'Waste Weight', type: 'number' },
  { key: 'totalPackagedWeight', label: 'Packaged Weight', type: 'number' },
  { key: 'packageCount', label: 'Packages', type: 'number' },
  { key: 'harvestStartDate', label: 'Start Date', type: 'date' },
  { key: 'finishedDate', label: 'Finished Date', type: 'date' },
  { key: 'labTestingState', label: 'Lab Testing', type: 'string' },
  { key: 'ageDays', label: 'Age (days)', type: 'number' },
  { key: 'isOnHold', label: 'On Hold', type: 'boolean' },
];

export function harvestToRow(h: MetrcHarvest): ReportRow {
  const ageDays = calculateAgeDays(h.HarvestStartDate);
  return {
    name: h.Name,
    harvestType: h.HarvestType,
    sourceStrainNames: h.SourceStrainNames,
    dryingLocation: h.DryingLocationName || '',
    currentWeight: h.CurrentWeight,
    totalWasteWeight: h.TotalWasteWeight,
    totalPackagedWeight: h.TotalPackagedWeight,
    packageCount: h.PackageCount,
    harvestStartDate: h.HarvestStartDate,
    finishedDate: h.FinishedDate || null,
    labTestingState: h.LabTestingState,
    ageDays,
    isOnHold: h.IsOnHold,
  };
}

// ---------------------------------------------------------------------------
// Plant columns & transformer
// ---------------------------------------------------------------------------

export const PLANT_COLUMNS: ReportColumn[] = [
  { key: 'label', label: 'Plant Label', type: 'string' },
  { key: 'strainName', label: 'Strain', type: 'string' },
  { key: 'growthPhase', label: 'Growth Phase', type: 'string' },
  { key: 'plantBatchName', label: 'Batch Name', type: 'string' },
  { key: 'plantedDate', label: 'Planted Date', type: 'date' },
  { key: 'vegetativeDate', label: 'Vegetative Date', type: 'date' },
  { key: 'floweringDate', label: 'Flowering Date', type: 'date' },
  { key: 'locationName', label: 'Location', type: 'string' },
  { key: 'roomName', label: 'Room', type: 'string' },
  { key: 'ageDays', label: 'Age (days)', type: 'number' },
  { key: 'isOnHold', label: 'On Hold', type: 'boolean' },
];

export function plantToRow(p: MetrcPlant): ReportRow {
  const ageDays = calculateAgeDays(p.PlantedDate);
  return {
    label: p.Label,
    strainName: p.StrainName,
    growthPhase: p.GrowthPhase,
    plantBatchName: p.PlantBatchName,
    plantedDate: p.PlantedDate,
    vegetativeDate: p.VegetativeDate || null,
    floweringDate: p.FloweringDate || null,
    locationName: p.LocationName || '',
    roomName: p.RoomName || '',
    ageDays,
    isOnHold: p.IsOnHold,
  };
}

// ---------------------------------------------------------------------------
// Supply columns & transformer
// ---------------------------------------------------------------------------

export const SUPPLY_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Item Name', type: 'string' },
  { key: 'sku', label: 'SKU', type: 'string' },
  { key: 'category', label: 'Category', type: 'string' },
  { key: 'currentStock', label: 'Current Stock', type: 'number' },
  { key: 'reorderPoint', label: 'Reorder Point', type: 'number' },
  { key: 'unit', label: 'Unit', type: 'string' },
  { key: 'unitCost', label: 'Unit Cost', type: 'number' },
  { key: 'totalValue', label: 'Total Value', type: 'number' },
  { key: 'vendor', label: 'Vendor', type: 'string' },
  { key: 'stockStatus', label: 'Stock Status', type: 'string' },
  { key: 'isActive', label: 'Active', type: 'boolean' },
];

export interface SupplyItemForReport {
  name: string;
  sku: string | null;
  currentStock: number;
  reorderPoint: number | null;
  unit: string;
  unitCost: number | null;
  vendor: string | null;
  isActive: boolean;
  category: { name: string } | null;
}

export function supplyItemToRow(item: SupplyItemForReport): ReportRow {
  const stock = item.currentStock;
  const reorder = item.reorderPoint;
  const cost = item.unitCost ?? 0;
  const totalValue = Math.round(stock * cost * 100) / 100;

  let stockStatus = 'ok';
  if (stock <= 0) stockStatus = 'out_of_stock';
  else if (reorder != null && stock <= reorder * 0.5) stockStatus = 'critical';
  else if (reorder != null && stock <= reorder) stockStatus = 'low';

  return {
    name: item.name,
    sku: item.sku || '',
    category: item.category?.name || '',
    currentStock: stock,
    reorderPoint: reorder ?? 0,
    unit: item.unit,
    unitCost: cost,
    totalValue,
    vendor: item.vendor || '',
    stockStatus,
    isActive: item.isActive,
  };
}

// ---------------------------------------------------------------------------
// Tolling columns & transformer
// ---------------------------------------------------------------------------

export const TOLLING_COLUMNS: ReportColumn[] = [
  { key: 'batchId', label: 'Batch ID', type: 'string' },
  { key: 'partnerName', label: 'Partner', type: 'string' },
  { key: 'agreementType', label: 'Agreement Type', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'inputWeight', label: 'Input Weight', type: 'number' },
  { key: 'outputWeight', label: 'Output Weight', type: 'number' },
  { key: 'expectedYieldPct', label: 'Expected Yield %', type: 'number' },
  { key: 'actualYieldPct', label: 'Actual Yield %', type: 'number' },
  { key: 'yieldVariance', label: 'Yield Variance', type: 'number' },
  { key: 'wastePct', label: 'Waste %', type: 'number' },
  { key: 'totalFees', label: 'Total Fees', type: 'number' },
  { key: 'costPerGramInput', label: 'Cost/g (Input)', type: 'number' },
  { key: 'costPerGramOutput', label: 'Cost/g (Output)', type: 'number' },
  { key: 'startDate', label: 'Start Date', type: 'date' },
];

export interface TollingBatchForReport {
  id: string;
  status: string;
  inputWeight: number | null;
  outputWeight: number | null;
  expectedYieldPct: number | null;
  actualYieldPct: number | null;
  yieldVariance: number | null;
  wastePct: number | null;
  totalFees: number | null;
  startedAt: Date;
  agreement: {
    partnerName: string;
    agreementType: string;
  };
}

export function tollingBatchToRow(batch: TollingBatchForReport): ReportRow {
  const fees = batch.totalFees ?? 0;
  const inputW = batch.inputWeight ?? 0;
  const outputW = batch.outputWeight ?? 0;
  return {
    batchId: batch.id,
    partnerName: batch.agreement.partnerName,
    agreementType: batch.agreement.agreementType,
    status: batch.status,
    inputWeight: inputW,
    outputWeight: outputW,
    expectedYieldPct: batch.expectedYieldPct ?? 0,
    actualYieldPct: batch.actualYieldPct ?? 0,
    yieldVariance: batch.yieldVariance ?? 0,
    wastePct: batch.wastePct ?? 0,
    totalFees: fees,
    costPerGramInput: inputW > 0 ? Math.round((fees / inputW) * 100) / 100 : 0,
    costPerGramOutput: outputW > 0 ? Math.round((fees / outputW) * 100) / 100 : 0,
    startDate: batch.startedAt.toISOString().substring(0, 10),
  };
}

// ---------------------------------------------------------------------------
// OpEx columns & transformer
// ---------------------------------------------------------------------------

export const OPEX_COLUMNS: ReportColumn[] = [
  { key: 'cellKey', label: 'Cell Key', type: 'string' },
  { key: 'cellLabel', label: 'Label', type: 'string' },
  { key: 'section', label: 'Section', type: 'string' },
  { key: 'group', label: 'Group', type: 'string' },
  { key: 'cellType', label: 'Cell Type', type: 'string' },
  { key: 'dataType', label: 'Data Type', type: 'string' },
  { key: 'value', label: 'Value', type: 'number' },
  { key: 'unit', label: 'Unit', type: 'string' },
  { key: 'formula', label: 'Formula', type: 'string' },
];

export interface OpExCellForReport {
  key: string;
  label: string;
  cellType: string;
  dataType: string;
  value: number | null;
  unit: string | null;
  formula: string | null;
}

export function opexCellToRow(
  cell: OpExCellForReport,
  sectionName: string,
  groupLabel: string,
): ReportRow {
  return {
    cellKey: cell.key,
    cellLabel: cell.label,
    section: sectionName,
    group: groupLabel,
    cellType: cell.cellType,
    dataType: cell.dataType,
    value: cell.value,
    unit: cell.unit || '',
    formula: cell.formula || '',
  };
}

// ---------------------------------------------------------------------------
// Report type registry
// ---------------------------------------------------------------------------

export const REPORT_TYPE_CONFIGS: Record<ReportType, { label: string; description: string; columns: ReportColumn[] }> = {
  INVENTORY: { label: 'Inventory', description: 'Active Metrc packages', columns: INVENTORY_COLUMNS },
  HARVEST: { label: 'Harvests', description: 'Active and finished harvests', columns: HARVEST_COLUMNS },
  PLANT: { label: 'Plants', description: 'Active plants by growth phase', columns: PLANT_COLUMNS },
  SUPPLY: { label: 'Supply', description: 'Non-Metrc supply items and stock levels', columns: SUPPLY_COLUMNS },
  TOLLING: { label: 'Tolling', description: 'Tolling batches and economics', columns: TOLLING_COLUMNS },
  OPEX: { label: 'OpEx', description: 'Operating expense model cells', columns: OPEX_COLUMNS },
};

export function getColumnsForType(type: ReportType): ReportColumn[] {
  return REPORT_TYPE_CONFIGS[type].columns;
}

// ---------------------------------------------------------------------------
// Transform package to report row
// ---------------------------------------------------------------------------

export function packageToRow(pkg: MetrcPackage): ReportRow {
  const ageDays = calculateAgeDays(pkg.PackagedDate);
  return {
    label: pkg.Label,
    itemName: pkg.ItemName,
    itemCategory: pkg.ItemCategory,
    strainName: pkg.ItemStrainName,
    quantity: pkg.Quantity,
    unitOfMeasure: pkg.UnitOfMeasureName,
    packageType: pkg.PackageType,
    location: pkg.LocationName || 'Unassigned',
    room: pkg.RoomName || '',
    packagedDate: pkg.PackagedDate,
    ageDays,
    ageCategory: getAgeCategory(ageDays),
    labTestingState: pkg.LabTestingState,
    isOnHold: pkg.IsOnHold,
    productionBatch: pkg.ProductionBatchNumber,
    lastModified: pkg.LastModified,
  };
}

// ---------------------------------------------------------------------------
// Filter rows
// ---------------------------------------------------------------------------

function matchesFilter(row: ReportRow, filter: ReportFilter): boolean {
  const value = row[filter.column];
  if (value === null || value === undefined) return false;

  switch (filter.operator) {
    case 'eq':
      return value === filter.value;
    case 'neq':
      return value !== filter.value;
    case 'gt':
      return typeof value === 'number' && value > (filter.value as number);
    case 'lt':
      return typeof value === 'number' && value < (filter.value as number);
    case 'gte':
      return typeof value === 'number' && value >= (filter.value as number);
    case 'lte':
      return typeof value === 'number' && value <= (filter.value as number);
    case 'contains':
      return typeof value === 'string' && value.toLowerCase().indexOf(String(filter.value).toLowerCase()) !== -1;
    case 'in':
      if (Array.isArray(filter.value)) {
        return filter.value.indexOf(String(value)) !== -1;
      }
      return false;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// executeReportFromRows — generic filter/sort/group/project on pre-built rows
// ---------------------------------------------------------------------------

export function executeReportFromRows(
  inputRows: ReportRow[],
  definition: ReportDefinition,
): ReportResult {
  let rows = inputRows;

  // Apply filters
  for (let f = 0; f < definition.filters.length; f++) {
    const filter = definition.filters[f];
    const filtered: ReportRow[] = [];
    for (let r = 0; r < rows.length; r++) {
      if (matchesFilter(rows[r], filter)) {
        filtered.push(rows[r]);
      }
    }
    rows = filtered;
  }

  // Apply sorting
  if (definition.sortBy.length > 0) {
    rows = rows.slice(); // avoid mutating input
    rows.sort(function (a, b) {
      for (let s = 0; s < definition.sortBy.length; s++) {
        const sort = definition.sortBy[s];
        const aVal = a[sort.column];
        const bVal = b[sort.column];
        if (aVal === bVal) continue;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        let cmp = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          cmp = aVal.localeCompare(bVal);
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        if (sort.direction === 'desc') cmp = -cmp;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  // Select only requested columns
  const selectedKeys = definition.columns.map(function (c) { return c.key; });
  const projectedRows: ReportRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const projected: ReportRow = {};
    for (let k = 0; k < selectedKeys.length; k++) {
      projected[selectedKeys[k]] = rows[i][selectedKeys[k]] ?? null;
    }
    projectedRows.push(projected);
  }

  // Group by
  const groups: GroupedResult[] = [];
  if (definition.groupBy.length > 0) {
    const groupMap = new Map<string, ReportRow[]>();
    for (let i = 0; i < projectedRows.length; i++) {
      const row = projectedRows[i];
      const keyParts: string[] = [];
      for (let g = 0; g < definition.groupBy.length; g++) {
        keyParts.push(String(row[definition.groupBy[g]] ?? ''));
      }
      const key = keyParts.join('||');
      const existing = groupMap.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groupMap.set(key, [row]);
      }
    }

    const groupEntries = Array.from(groupMap.entries());
    for (let i = 0; i < groupEntries.length; i++) {
      const key = groupEntries[i][0];
      const groupRows = groupEntries[i][1];

      // Compute group values
      const groupValues: Record<string, string> = {};
      const keyParts = key.split('||');
      for (let g = 0; g < definition.groupBy.length; g++) {
        groupValues[definition.groupBy[g]] = keyParts[g];
      }

      // Compute numeric aggregates
      const aggregates: Record<string, number> = {};
      for (let c = 0; c < definition.columns.length; c++) {
        if (definition.columns[c].type === 'number') {
          const colKey = definition.columns[c].key;
          let sum = 0;
          for (let r = 0; r < groupRows.length; r++) {
            const v = groupRows[r][colKey];
            if (typeof v === 'number') sum += v;
          }
          aggregates[colKey + '_sum'] = Math.round(sum * 100) / 100;
          aggregates[colKey + '_avg'] = groupRows.length > 0 ? Math.round((sum / groupRows.length) * 100) / 100 : 0;
        }
      }

      groups.push({
        groupKey: key,
        groupValues,
        count: groupRows.length,
        rows: groupRows,
        aggregates,
      });
    }

    groups.sort(function (a, b) { return b.count - a.count; });
  }

  return {
    columns: definition.columns,
    rows: projectedRows,
    groups,
    totalRows: projectedRows.length,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// generateCSV
// ---------------------------------------------------------------------------

export function generateCSV(result: ReportResult): string {
  const lines: string[] = [];

  // Header
  const headers = result.columns.map(function (c) { return c.label; });
  lines.push(headers.join(','));

  // Rows
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const values: string[] = [];
    for (let c = 0; c < result.columns.length; c++) {
      const val = row[result.columns[c].key];
      if (val === null || val === undefined) {
        values.push('');
      } else if (typeof val === 'string' && (val.indexOf(',') !== -1 || val.indexOf('"') !== -1)) {
        values.push('"' + val.replace(/"/g, '""') + '"');
      } else {
        values.push(String(val));
      }
    }
    lines.push(values.join(','));
  }

  return lines.join('\n');
}
