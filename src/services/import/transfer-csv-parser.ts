/**
 * transfer-csv-parser.ts — Parse historical transfer CSVs (affiliated + wholesale)
 *
 * Pure-function module. No React/Prisma/tRPC imports.
 * Two CSV schemas from Metrc export: affiliated (38 cols) and wholesale (22 cols).
 * Velocity-only: skips dollar/pricing columns per design decision.
 *
 * Uses header alias maps so both the original guessed header names AND the actual
 * Example Farms / Metrc export header names are accepted.
 *
 * Affiliated CSVs have repeated "UoM" column headers — these are resolved
 * positionally (index of quantity/weight column + 1).
 */

export interface TransferLineItemInput {
  manifestNumber: string;
  originLicenseNumber: string;
  originFacilityName: string;
  originFacilityType: string | null;
  destLicenseNumber: string;
  destFacilityName: string;
  destFacilityType: string | null;
  transferType: 'affiliated' | 'wholesale';
  createdDateTime: string | null;
  receivedDateTime: string | null;
  isVoided: boolean;
  packageLabel: string | null;
  itemName: string;
  itemCategory: string;
  shippedQuantity: number | null;
  shippedUnitOfMeasure: string | null;
  shippedWeight: number | null;
  shippedWeightUoM: string | null;
  receivedQuantity: number | null;
  receivedUnitOfMeasure: string | null;
  receivedWeight: number | null;
  receivedWeightUoM: string | null;
  countVariancePct: number | null;
  weightVariancePct: number | null;
  shipperWholesalePrice: number | null;
  receiverWholesalePrice: number | null;
}

export interface ParseResult {
  valid: TransferLineItemInput[];
  errors: { row: number; message: string }[];
}

// ---------------------------------------------------------------------------
// CSV line parser — handles quoted fields with commas
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseFloat_(val: string): number | null {
  if (!val || val === '-' || val === 'N/A') return null;
  // Strip % suffix for variance columns
  const cleaned = val.replace(/%$/, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseBool(val: string): boolean {
  return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
}

// ---------------------------------------------------------------------------
// Header alias resolution
// ---------------------------------------------------------------------------

type HeaderAliases = Record<string, string[]>;

/**
 * Build a lookup: logical field name → column index.
 * For each logical field, tries each alias in order and takes the first match.
 */
function resolveAliases(
  headerMap: Map<string, number>,
  aliases: HeaderAliases,
): Map<string, number> {
  const resolved = new Map<string, number>();
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const idx = headerMap.get(name);
      if (idx !== undefined) {
        resolved.set(field, idx);
        break;
      }
    }
  }
  return resolved;
}

/**
 * Get column value by logical field name from resolved alias map.
 */
function colByField(
  row: string[],
  fieldMap: Map<string, number>,
  field: string,
): string {
  const idx = fieldMap.get(field);
  return idx !== undefined ? (row[idx] ?? '') : '';
}

/**
 * Get column value by raw index (for positional UoM columns).
 */
function colByIndex(row: string[], idx: number | undefined): string {
  return idx !== undefined ? (row[idx] ?? '') : '';
}

// ---------------------------------------------------------------------------
// Affiliated Transfer CSV (38 columns)
// ---------------------------------------------------------------------------

const AFFILIATED_ALIASES: HeaderAliases = {
  manifest:          ['Manifest #', 'Manifest'],
  originLicense:     ['Origin Facility License Number', 'Origin Lic.'],
  originName:        ['Origin Facility Name', 'Origin Facility'],
  originType:        ['Origin Facility Type'],
  destLicense:       ['Destination Facility License Number', 'Dest. Lic.'],
  destName:          ['Destination Facility Name', 'Destination Facility'],
  destType:          ['Destination Facility Type', 'Dest. Facility Type'],
  created:           ['Created Date', 'Created DateTime', 'Created'],
  received:          ['Received Date', 'Received DateTime', 'Received'],
  isVoided:          ['Is Voided', 'Voided'],
  packageLabel:      ['Package', 'Package Label'],
  itemName:          ['Item Name', 'Item'],
  itemCategory:      ['Item Category'],
  // Quantity columns (UoM resolved positionally for affiliated)
  shippedQty:        ['Shipped Quantity', "Actual Ship'd"],
  receivedQty:       ['Received Quantity', "Actual Rcv'd"],
  // Weight columns (UoM resolved positionally for affiliated)
  shippedWeight:     ['Shipped Gross Weight', "Weight Ship'd"],
  receivedWeight:    ['Received Gross Weight', "Weight Rcv'd"],
  // These may be unique or may need positional fallback
  shippedQtyUoM:     ['Shipped Unit of Measure'],
  receivedQtyUoM:    ['Received Unit of Measure'],
  shippedWeightUoM:  ['Shipped Gross Weight Unit of Measure'],
  receivedWeightUoM: ['Received Gross Weight Unit of Measure'],
  countVar:          ['Count Variance %', 'Count % Var'],
  weightVar:         ['Weight Variance %', 'Weight % Var'],
};

// Required logical fields for affiliated
const AFFILIATED_REQUIRED: string[] = [
  'manifest', 'originLicense', 'originName', 'destLicense', 'destName', 'itemName',
];

export function parseAffiliatedTransferCSV(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { valid: [], errors: [{ row: 0, message: 'CSV has no data rows' }] };
  }

  const headers = parseCSVLine(lines[0]!);
  const headerMap = new Map(headers.map((h, i) => [h.trim(), i]));
  const fieldMap = resolveAliases(headerMap, AFFILIATED_ALIASES);

  // Validate required fields resolved
  const missing = AFFILIATED_REQUIRED.filter(f => !fieldMap.has(f));
  if (missing.length > 0) {
    return { valid: [], errors: [{ row: 0, message: `Missing required headers for: ${missing.join(', ')}` }] };
  }

  // For affiliated CSVs with repeated "UoM" headers, resolve positionally:
  // The UoM column immediately follows its quantity/weight column.
  const shippedQtyIdx = fieldMap.get('shippedQty');
  const receivedQtyIdx = fieldMap.get('receivedQty');
  const shippedWeightIdx = fieldMap.get('shippedWeight');
  const receivedWeightIdx = fieldMap.get('receivedWeight');

  // Positional UoM indices (column right after the value column)
  const shippedQtyUoMIdx = fieldMap.get('shippedQtyUoM') ?? (shippedQtyIdx !== undefined ? shippedQtyIdx + 1 : undefined);
  const receivedQtyUoMIdx = fieldMap.get('receivedQtyUoM') ?? (receivedQtyIdx !== undefined ? receivedQtyIdx + 1 : undefined);
  const shippedWeightUoMIdx = fieldMap.get('shippedWeightUoM') ?? (shippedWeightIdx !== undefined ? shippedWeightIdx + 1 : undefined);
  const receivedWeightUoMIdx = fieldMap.get('receivedWeightUoM') ?? (receivedWeightIdx !== undefined ? receivedWeightIdx + 1 : undefined);

  const valid: TransferLineItemInput[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]!);
    try {
      const manifestNumber = colByField(fields, fieldMap, 'manifest');
      const itemName = colByField(fields, fieldMap, 'itemName');
      if (!manifestNumber || !itemName) {
        errors.push({ row: i + 1, message: 'Missing manifest number or item name' });
        continue;
      }

      valid.push({
        manifestNumber,
        originLicenseNumber: colByField(fields, fieldMap, 'originLicense'),
        originFacilityName: colByField(fields, fieldMap, 'originName'),
        originFacilityType: colByField(fields, fieldMap, 'originType') || null,
        destLicenseNumber: colByField(fields, fieldMap, 'destLicense'),
        destFacilityName: colByField(fields, fieldMap, 'destName'),
        destFacilityType: colByField(fields, fieldMap, 'destType') || null,
        transferType: 'affiliated',
        createdDateTime: colByField(fields, fieldMap, 'created') || null,
        receivedDateTime: colByField(fields, fieldMap, 'received') || null,
        isVoided: parseBool(colByField(fields, fieldMap, 'isVoided')),
        packageLabel: colByField(fields, fieldMap, 'packageLabel') || null,
        itemName,
        itemCategory: colByField(fields, fieldMap, 'itemCategory') || 'Unknown',
        shippedQuantity: parseFloat_(colByField(fields, fieldMap, 'shippedQty')),
        shippedUnitOfMeasure: colByIndex(fields, shippedQtyUoMIdx) || null,
        shippedWeight: parseFloat_(colByField(fields, fieldMap, 'shippedWeight')),
        shippedWeightUoM: colByIndex(fields, shippedWeightUoMIdx) || null,
        receivedQuantity: parseFloat_(colByField(fields, fieldMap, 'receivedQty')),
        receivedUnitOfMeasure: colByIndex(fields, receivedQtyUoMIdx) || null,
        receivedWeight: parseFloat_(colByField(fields, fieldMap, 'receivedWeight')),
        receivedWeightUoM: colByIndex(fields, receivedWeightUoMIdx) || null,
        countVariancePct: parseFloat_(colByField(fields, fieldMap, 'countVar')),
        weightVariancePct: parseFloat_(colByField(fields, fieldMap, 'weightVar')),
        shipperWholesalePrice: null, // Affiliated CSVs don't have pricing
        receiverWholesalePrice: null,
      });
    } catch (err) {
      errors.push({ row: i + 1, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return { valid, errors };
}

// ---------------------------------------------------------------------------
// Wholesale Transfer CSV (22+ columns — no package label, includes pricing)
// ---------------------------------------------------------------------------

const WHOLESALE_ALIASES: HeaderAliases = {
  manifest:          ['Manifest Number', 'ManifestNumber'],
  originLicense:     ['Shipper Facility License Number', 'OriginLicenseNumber'],
  originName:        ['Shipper Facility Name', 'OriginFacilityName'],
  originType:        ['Shipper Facility Type'],
  destLicense:       ['Recipient Facility License Number', 'DestinationLicenseNumber'],
  destName:          ['Recipient Facility Name', 'DestinationFacilityName'],
  destType:          ['Recipient Facility Type'],
  created:           ['Created Date', 'Created DateTime', 'CreatedLocalDateTime'],
  received:          ['Received Date', 'Received DateTime', 'ReceivedLocalDateTime'],
  isVoided:          ['Is Voided', 'IsVoided'],
  itemName:          ['Item Name', 'Item'],
  itemCategory:      ['Item Category', 'ItemCategory'],
  shippedQty:        ['Shipped Quantity', 'ShippedCount'],
  shippedQtyUoM:     ['Shipped Unit of Measure', 'ShippedCountUoM'],
  receivedQty:       ['Received Quantity', 'ReceivedCount'],
  receivedQtyUoM:    ['Received Unit of Measure', 'ReceivedCountUoM'],
  shippedWeight:     ['Shipped Gross Weight', 'ShippedWeight'],
  shippedWeightUoM:  ['Shipped Gross Weight Unit of Measure', 'ShippedWeightUoM'],
  receivedWeight:    ['Received Gross Weight', 'ReceivedWeight'],
  receivedWeightUoM: ['Received Gross Weight Unit of Measure', 'ReceivedWeightUoM'],
  countVar:          ['Count Variance %', 'Count % Var'],
  weightVar:         ['Weight Variance %', 'Weight % Var'],
  shipperPrice:      ['Shipper Wholesale Price', 'ShipperWholesalePrice'],
  receiverPrice:     ['Receiver Wholesale Price', 'ReceiverWholesalePrice'],
};

const WHOLESALE_REQUIRED: string[] = [
  'manifest', 'originLicense', 'originName', 'destLicense', 'destName', 'itemName',
];

export function parseWholesaleTransferCSV(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { valid: [], errors: [{ row: 0, message: 'CSV has no data rows' }] };
  }

  const headers = parseCSVLine(lines[0]!);
  const headerMap = new Map(headers.map((h, i) => [h.trim(), i]));
  const fieldMap = resolveAliases(headerMap, WHOLESALE_ALIASES);

  const missing = WHOLESALE_REQUIRED.filter(f => !fieldMap.has(f));
  if (missing.length > 0) {
    return { valid: [], errors: [{ row: 0, message: `Missing required headers for: ${missing.join(', ')}` }] };
  }

  const valid: TransferLineItemInput[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]!);
    try {
      const manifestNumber = colByField(fields, fieldMap, 'manifest');
      const itemName = colByField(fields, fieldMap, 'itemName');
      if (!manifestNumber || !itemName) {
        errors.push({ row: i + 1, message: 'Missing manifest number or item name' });
        continue;
      }

      valid.push({
        manifestNumber,
        originLicenseNumber: colByField(fields, fieldMap, 'originLicense'),
        originFacilityName: colByField(fields, fieldMap, 'originName'),
        originFacilityType: colByField(fields, fieldMap, 'originType') || null,
        destLicenseNumber: colByField(fields, fieldMap, 'destLicense'),
        destFacilityName: colByField(fields, fieldMap, 'destName'),
        destFacilityType: colByField(fields, fieldMap, 'destType') || null,
        transferType: 'wholesale',
        createdDateTime: colByField(fields, fieldMap, 'created') || null,
        receivedDateTime: colByField(fields, fieldMap, 'received') || null,
        isVoided: parseBool(colByField(fields, fieldMap, 'isVoided')),
        packageLabel: null, // Wholesale CSVs don't have package labels
        itemName,
        itemCategory: colByField(fields, fieldMap, 'itemCategory') || 'Unknown',
        shippedQuantity: parseFloat_(colByField(fields, fieldMap, 'shippedQty')),
        shippedUnitOfMeasure: colByField(fields, fieldMap, 'shippedQtyUoM') || null,
        shippedWeight: parseFloat_(colByField(fields, fieldMap, 'shippedWeight')),
        shippedWeightUoM: colByField(fields, fieldMap, 'shippedWeightUoM') || null,
        receivedQuantity: parseFloat_(colByField(fields, fieldMap, 'receivedQty')),
        receivedUnitOfMeasure: colByField(fields, fieldMap, 'receivedQtyUoM') || null,
        receivedWeight: parseFloat_(colByField(fields, fieldMap, 'receivedWeight')),
        receivedWeightUoM: colByField(fields, fieldMap, 'receivedWeightUoM') || null,
        countVariancePct: parseFloat_(colByField(fields, fieldMap, 'countVar')),
        weightVariancePct: parseFloat_(colByField(fields, fieldMap, 'weightVar')),
        shipperWholesalePrice: parseFloat_(colByField(fields, fieldMap, 'shipperPrice')),
        receiverWholesalePrice: parseFloat_(colByField(fields, fieldMap, 'receiverPrice')),
      });
    } catch (err) {
      errors.push({ row: i + 1, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return { valid, errors };
}

/**
 * Auto-detect CSV type by inspecting headers.
 * Checks for both the original guessed headers and actual Metrc export headers.
 */
export function detectCSVType(csvText: string): 'affiliated' | 'wholesale' | null {
  const firstLine = csvText.split(/\r?\n/)[0] ?? '';

  // Affiliated: has "Manifest #" or "Manifest" + origin facility indicators
  // (but NOT "ManifestNumber" which is wholesale)
  if (
    (firstLine.includes('Manifest #') || (firstLine.includes('Manifest') && firstLine.includes('Origin Lic.'))) &&
    (firstLine.includes('Origin Facility') || firstLine.includes('Origin Lic.'))
  ) {
    return 'affiliated';
  }

  // Wholesale: has "ManifestNumber" or "Manifest Number" + shipper/destination indicators
  if (
    (firstLine.includes('ManifestNumber') || firstLine.includes('Manifest Number')) &&
    (firstLine.includes('Shipper Facility') || firstLine.includes('OriginLicenseNumber') || firstLine.includes('DestinationLicenseNumber'))
  ) {
    return 'wholesale';
  }

  return null;
}
