// COA (Certificate of Analysis) Parsing Engine — Tier 1
// Pure function — no tRPC, Prisma, or React imports.
// Regex-based text scanner with per-field confidence scores.
// Preserves line structure from PDF text — no destructive normalization.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerpeneResult {
  name: string;            // e.g., "alpha-Pinene", "beta-Pinene", "Myrcene"
  value: number;           // percentage
  unit: string;            // '%' | 'mg/g'
  confidence: number;      // 0.0-1.0
}

export interface CannabinoidResult {
  name: string;            // e.g., "THC", "THCA", "CBD", "CBDA"
  value: number;           // percentage
  unit: string;
  confidence: number;
}

export interface LabInfo {
  labName: string | null;
  licenseNumber: string | null;
  testDate: string | null;  // ISO date string or raw
  confidence: number;
}

export interface BatchInfo {
  batchNumber: string | null;
  sampleId: string | null;
  productName: string | null;
  confidence: number;
}

export interface COAParseResult {
  terpenes: TerpeneResult[];
  cannabinoids: CannabinoidResult[];
  labInfo: LabInfo;
  batchInfo: BatchInfo;
  totalTerpenes: number | null;   // sum of terpene values
  totalCannabinoids: number | null; // sum of cannabinoid values
  overallConfidence: number;      // 0.0-1.0, weighted average
  warnings: string[];
  tier: 'regex';
}

// ---------------------------------------------------------------------------
// Reference Data — salvaged from metrc-agent/services/coa-parser-service.js
// with corrections: alpha/beta-pinene kept SEPARATE, full compound list
// ---------------------------------------------------------------------------

/** Canonical terpene names with their regex-friendly variants */
const TERPENE_COMPOUNDS: { canonical: string; patterns: string[] }[] = [
  { canonical: 'Limonene', patterns: ['d-limonene', 'limonene'] },
  { canonical: 'Myrcene', patterns: ['beta-myrcene', 'b-myrcene', 'β-myrcene', 'myrcene'] },
  { canonical: 'alpha-Pinene', patterns: ['alpha-pinene', 'α-pinene', 'a-pinene'] },
  { canonical: 'beta-Pinene', patterns: ['beta-pinene', 'β-pinene', 'b-pinene'] },
  { canonical: 'Linalool', patterns: ['linalool'] },
  { canonical: 'beta-Caryophyllene', patterns: ['beta-caryophyllene', 'β-caryophyllene', 'b-caryophyllene', 'caryophyllene'] },
  { canonical: 'alpha-Humulene', patterns: ['alpha-humulene', 'α-humulene', 'a-humulene', 'humulene'] },
  { canonical: 'Terpinolene', patterns: ['terpinolene'] },
  { canonical: 'trans-Ocimene', patterns: ['trans-ocimene', 't-ocimene'] },
  { canonical: 'cis-Ocimene', patterns: ['cis-ocimene'] },
  { canonical: 'Ocimene', patterns: ['ocimene'] }, // generic — only matches if trans/cis not matched
  { canonical: 'trans-Nerolidol', patterns: ['trans-nerolidol', 't-nerolidol'] },
  { canonical: 'cis-Nerolidol', patterns: ['cis-nerolidol'] },
  { canonical: 'Nerolidol', patterns: ['nerolidol'] }, // generic
  { canonical: 'alpha-Bisabolol', patterns: ['alpha-bisabolol', 'α-bisabolol', 'a-bisabolol', 'bisabolol'] },
  { canonical: 'Eucalyptol', patterns: ['eucalyptol', '1,8-cineole', 'cineole'] },
  { canonical: 'alpha-Phellandrene', patterns: ['alpha-phellandrene', 'α-phellandrene', 'a-phellandrene'] },
  { canonical: 'beta-Phellandrene', patterns: ['beta-phellandrene', 'β-phellandrene', 'b-phellandrene'] },
  { canonical: 'Camphene', patterns: ['camphene'] },
  { canonical: 'Borneol', patterns: ['borneol'] },
  { canonical: 'Valencene', patterns: ['valencene'] },
  { canonical: 'Geraniol', patterns: ['geraniol'] },
  { canonical: 'beta-Farnesene', patterns: ['beta-farnesene', 'β-farnesene', 'b-farnesene', 'farnesene'] },
  { canonical: 'Guaiol', patterns: ['guaiol'] },
  { canonical: 'Sabinene', patterns: ['sabinene'] },
  { canonical: 'delta-3-Carene', patterns: ['delta-3-carene', 'δ-3-carene', '3-carene', 'carene'] },
  { canonical: 'Fenchol', patterns: ['fenchol'] },
  { canonical: 'Cedrol', patterns: ['cedrol'] },
  { canonical: 'Isopulegol', patterns: ['isopulegol'] },
];

/**
 * Canonical cannabinoid names — ordered longest-first to avoid substring collisions.
 * CRITICAL: "delta-10-thc" must be matched before "thc" to prevent the THC/THCA bug.
 */
const CANNABINOID_COMPOUNDS: { canonical: string; patterns: string[] }[] = [
  { canonical: 'delta-10-THC', patterns: ['delta-10-thc', 'δ-10-thc', 'd10-thc', 'delta 10 thc', 'δ10-thc'] },
  { canonical: 'delta-8-THC', patterns: ['delta-8-thc', 'δ-8-thc', 'd8-thc', 'delta 8 thc', 'δ8-thc'] },
  { canonical: 'delta-9-THC', patterns: ['delta-9-thc', 'δ-9-thc', 'd9-thc', 'delta 9 thc', 'δ9-thc'] },
  { canonical: 'THCVA', patterns: ['thcva'] },
  { canonical: 'THCV', patterns: ['thcv'] },
  { canonical: 'THCA', patterns: ['thca', 'thc-a'] },
  { canonical: 'THC', patterns: ['thc', 'total thc', 'δ-9-tetrahydrocannabinol', 'delta-9-tetrahydrocannabinol'] },
  { canonical: 'CBDVA', patterns: ['cbdva'] },
  { canonical: 'CBDV', patterns: ['cbdv'] },
  { canonical: 'CBDA', patterns: ['cbda', 'cbd-a'] },
  { canonical: 'CBD', patterns: ['cbd', 'total cbd', 'cannabidiol'] },
  { canonical: 'CBGA', patterns: ['cbga', 'cbg-a'] },
  { canonical: 'CBG', patterns: ['cbg', 'cannabigerol'] },
  { canonical: 'CBNA', patterns: ['cbna', 'cbn-a'] },
  { canonical: 'CBN', patterns: ['cbn', 'cannabinol'] },
];

// ---------------------------------------------------------------------------
// Value validation ranges
// ---------------------------------------------------------------------------

const TERPENE_MIN = 0.01;
const TERPENE_MAX = 10;      // Terpenes rarely exceed 10%
const CANNABINOID_MIN = 0.01;
const CANNABINOID_MAX = 100;  // Total cannabinoids can approach 100% in isolates

const TOTAL_TERPENES_WARNING_THRESHOLD = 15;
const THC_WARNING_THRESHOLD = 40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a regex that matches a compound name as a whole "word" in COA text.
 * Uses word boundaries where appropriate, but accounts for greek letters and hyphens.
 * Match is case-insensitive.
 */
function buildCompoundPattern(patterns: string[]): RegExp {
  // Sort patterns longest-first so longer matches win
  const sorted = [...patterns].sort((a, b) => b.length - a.length);
  // Escape regex special characters in patterns, but keep spaces as \s+
  const escaped = sorted.map(p =>
    p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
  );
  // Use a non-capturing group with word-boundary-like assertions.
  // We use (?<![a-zA-Z]) and (?![a-zA-Z]) instead of \b because \b
  // doesn't work correctly with hyphens and Greek letters.
  return new RegExp(`(?<![a-zA-Z])(${escaped.join('|')})(?![a-zA-Z])`, 'i');
}

/**
 * Extract a numeric value following (or near) a compound name match.
 * Returns the value and unit, or null if no valid value found.
 */
function extractValueNearMatch(
  line: string,
  matchIndex: number,
  matchLength: number,
): { value: number; unit: string } | null {
  // Look at the rest of the line after the compound name match
  const after = line.slice(matchIndex + matchLength);

  // Pattern: optional separators, then a number, then optional unit
  // Handles: "1.234%", "1.234 %", ": 1.234", "1.234 mg/g"
  const valuePattern = /[\s:=|,]*(\d+\.?\d*)\s*(%|mg\/g|mg\/ml|ppm)?/i;
  const m = valuePattern.exec(after);
  if (!m) return null;

  const value = parseFloat(m[1]);
  if (isNaN(value) || value <= 0) return null;

  const unit = (m[2] || '%').toLowerCase();
  return { value, unit: unit === 'mg/g' || unit === 'mg/ml' ? 'mg/g' : '%' };
}

/**
 * Compute confidence score for a single compound match.
 * Factors: value in expected range, unit present, clear formatting.
 */
function computeCompoundConfidence(
  value: number,
  unit: string,
  hasExplicitUnit: boolean,
  minValid: number,
  maxValid: number,
): number {
  let confidence = 0.6; // Base confidence for any match

  // Boost for explicit unit
  if (hasExplicitUnit) confidence += 0.15;

  // Boost for value within valid range
  if (value >= minValid && value <= maxValid) {
    confidence += 0.2;
  } else {
    // Penalize out-of-range values
    confidence -= 0.3;
  }

  // Small boost for typical precision (1-3 decimal places)
  const decimalStr = value.toString();
  const decimalParts = decimalStr.split('.');
  if (decimalParts.length === 2 && decimalParts[1].length >= 1 && decimalParts[1].length <= 3) {
    confidence += 0.05;
  }

  return Math.max(0, Math.min(1, confidence));
}

// ---------------------------------------------------------------------------
// Extraction functions
// ---------------------------------------------------------------------------

function extractTerpenes(lines: string[]): TerpeneResult[] {
  const results: TerpeneResult[] = [];
  const matched = new Set<string>(); // Track matched canonical names to avoid duplicates

  for (const compound of TERPENE_COMPOUNDS) {
    if (matched.has(compound.canonical)) continue;

    const pattern = buildCompoundPattern(compound.patterns);

    for (const line of lines) {
      const m = pattern.exec(line);
      if (!m) continue;

      const extracted = extractValueNearMatch(line, m.index, m[0].length);
      if (!extracted) continue;

      // Check if this is a "generic" compound that was already matched more specifically
      // e.g., if "alpha-Pinene" already matched, skip generic "Pinene"
      if (compound.canonical === 'Ocimene' && (matched.has('trans-Ocimene') || matched.has('cis-Ocimene'))) continue;
      if (compound.canonical === 'Nerolidol' && (matched.has('trans-Nerolidol') || matched.has('cis-Nerolidol'))) continue;

      const hasExplicitUnit = /(%|mg\/g|mg\/ml|ppm)/i.test(line.slice(m.index + m[0].length, m.index + m[0].length + 20));
      const confidence = computeCompoundConfidence(
        extracted.value,
        extracted.unit,
        hasExplicitUnit,
        TERPENE_MIN,
        TERPENE_MAX,
      );

      results.push({
        name: compound.canonical,
        value: extracted.value,
        unit: extracted.unit,
        confidence,
      });
      matched.add(compound.canonical);
      break; // Move to next compound (first line match wins)
    }
  }

  return results;
}

function extractCannabinoids(lines: string[]): CannabinoidResult[] {
  const results: CannabinoidResult[] = [];
  const matched = new Set<string>();
  // Track which character positions in each line have been claimed by a match
  // to prevent THC matching inside "THCA" on the same line
  const claimedPositions = new Map<number, Set<number>>(); // lineIndex -> Set<charIndex>

  for (const compound of CANNABINOID_COMPOUNDS) {
    if (matched.has(compound.canonical)) continue;

    const pattern = buildCompoundPattern(compound.patterns);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const m = pattern.exec(line);
      if (!m) continue;

      // Check if this match overlaps with an already-claimed position
      const claimed = claimedPositions.get(lineIdx);
      if (claimed) {
        let overlaps = false;
        for (let i = m.index; i < m.index + m[0].length; i++) {
          if (claimed.has(i)) { overlaps = true; break; }
        }
        if (overlaps) continue;
      }

      const extracted = extractValueNearMatch(line, m.index, m[0].length);
      if (!extracted) continue;

      const hasExplicitUnit = /(%|mg\/g|mg\/ml|ppm)/i.test(line.slice(m.index + m[0].length, m.index + m[0].length + 20));
      const confidence = computeCompoundConfidence(
        extracted.value,
        extracted.unit,
        hasExplicitUnit,
        CANNABINOID_MIN,
        CANNABINOID_MAX,
      );

      results.push({
        name: compound.canonical,
        value: extracted.value,
        unit: extracted.unit,
        confidence,
      });
      matched.add(compound.canonical);

      // Claim the positions used by this match
      if (!claimedPositions.has(lineIdx)) {
        claimedPositions.set(lineIdx, new Set());
      }
      const posSet = claimedPositions.get(lineIdx)!;
      for (let i = m.index; i < m.index + m[0].length; i++) {
        posSet.add(i);
      }
      break; // Move to next compound
    }
  }

  return results;
}

/**
 * Extract lab info from ORIGINAL text (not normalized).
 * Lab names and license numbers often span multiple lines and need
 * newline structure preserved for `[^\n]+` patterns.
 */
function extractLabInfo(originalText: string): LabInfo {
  let labName: string | null = null;
  let licenseNumber: string | null = null;
  let testDate: string | null = null;
  let fieldsFound = 0;

  // Lab name patterns — common testing labs in cannabis industry
  const labNamePatterns = [
    /(?:laboratory|lab|tested\s+by|testing\s+facility|analyzed\s+by)[:\s]*([^\n]{3,60})/i,
    /(?:SC Labs|Kaycha|Steep Hill|CannaSafe|ProVerde|ACS Laboratory|Green Leaf Lab|MCR Labs|Sonoma Lab Works|Anresco|Columbia|Encore Labs|Eurofins|PharmLabs|TerpX|Belcosta)/i,
  ];

  for (const p of labNamePatterns) {
    const m = p.exec(originalText);
    if (m) {
      labName = (m[1] || m[0]).trim();
      fieldsFound++;
      break;
    }
  }

  // License number patterns
  const licensePatterns = [
    /(?:license|lic\.?\s*(?:no\.?|number|#)?)[:\s#]*([A-Z0-9-]{5,20})/i,
    /(?:C\d{1,2}-\d{7}-LIC)/i, // California license format
    /(?:CDPH-\d+)/i,            // California Dept of Public Health
  ];

  for (const p of licensePatterns) {
    const m = p.exec(originalText);
    if (m) {
      licenseNumber = (m[1] || m[0]).trim();
      fieldsFound++;
      break;
    }
  }

  // Date patterns — look for test date, analysis date, report date
  const datePatterns = [
    /(?:test\s*date|date\s*(?:of\s*)?test(?:ed|ing)?|analysis\s*date|report\s*date|date\s*(?:of\s*)?analysis|date\s*(?:of\s*)?report|completed?\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:test\s*date|date\s*(?:of\s*)?test(?:ed|ing)?|analysis\s*date|report\s*date)[:\s]*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
    /(?:test\s*date|analysis\s*date|report\s*date)[:\s]*(\d{4}-\d{2}-\d{2})/i, // ISO format
  ];

  for (const p of datePatterns) {
    const m = p.exec(originalText);
    if (m) {
      testDate = m[1].trim();
      fieldsFound++;
      break;
    }
  }

  // Confidence: based on how many fields were found
  const confidence = fieldsFound === 0 ? 0 : fieldsFound / 3;

  return { labName, licenseNumber, testDate, confidence };
}

function extractBatchInfo(originalText: string): BatchInfo {
  let batchNumber: string | null = null;
  let sampleId: string | null = null;
  let productName: string | null = null;
  let fieldsFound = 0;

  // Batch number
  const batchPatterns = [
    /(?:batch\s*(?:no\.?|number|#|id)?)[:\s#]*([A-Za-z0-9\-_]{3,30})/i,
    /(?:lot\s*(?:no\.?|number|#)?)[:\s#]*([A-Za-z0-9\-_]{3,30})/i,
  ];

  for (const p of batchPatterns) {
    const m = p.exec(originalText);
    if (m) {
      batchNumber = m[1].trim();
      fieldsFound++;
      break;
    }
  }

  // Sample ID
  const samplePatterns = [
    /(?:sample\s*(?:id|no\.?|number|#)?)[:\s#]*([A-Za-z0-9\-_]{3,30})/i,
    /(?:order\s*(?:id|no\.?|number|#)?)[:\s#]*([A-Za-z0-9\-_]{3,30})/i,
  ];

  for (const p of samplePatterns) {
    const m = p.exec(originalText);
    if (m) {
      sampleId = m[1].trim();
      fieldsFound++;
      break;
    }
  }

  // Product name
  const productPatterns = [
    /(?:product\s*(?:name)?|sample\s*(?:name|description)|strain\s*(?:name)?)[:\s]*([^\n]{3,60})/i,
    /(?:client\s*sample\s*id|matrix)[:\s]*([^\n]{3,60})/i,
  ];

  for (const p of productPatterns) {
    const m = p.exec(originalText);
    if (m) {
      productName = m[1].trim();
      fieldsFound++;
      break;
    }
  }

  const confidence = fieldsFound === 0 ? 0 : fieldsFound / 3;

  return { batchNumber, sampleId, productName, confidence };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse COA text extracted from a PDF using Tier 1 regex engine.
 *
 * 1. Splits text into lines (preserves structure)
 * 2. Scans for terpene values — compound name followed by numeric value
 * 3. Scans for cannabinoid values — longest names matched first to avoid THC/THCA collision
 * 4. Extracts lab info and batch info from original text (not normalized)
 * 5. Validates all values are within plausible ranges
 * 6. Computes per-field and overall confidence
 * 7. Returns warnings for suspicious data
 */
export function parseCOAText(text: string): COAParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    warnings.push('No text content found in document.');
    return {
      terpenes: [],
      cannabinoids: [],
      labInfo: { labName: null, licenseNumber: null, testDate: null, confidence: 0 },
      batchInfo: { batchNumber: null, sampleId: null, productName: null, confidence: 0 },
      totalTerpenes: null,
      totalCannabinoids: null,
      overallConfidence: 0,
      warnings,
      tier: 'regex',
    };
  }

  // Extract compounds
  const terpenes = extractTerpenes(lines);
  const cannabinoids = extractCannabinoids(lines);

  // Extract metadata from original text (preserving newlines for lab info regex)
  const labInfo = extractLabInfo(text);
  const batchInfo = extractBatchInfo(text);

  // Compute totals
  const totalTerpenes = terpenes.length > 0
    ? Math.round(terpenes.reduce((sum, t) => sum + t.value, 0) * 1000) / 1000
    : null;
  const totalCannabinoids = cannabinoids.length > 0
    ? Math.round(cannabinoids.reduce((sum, c) => sum + c.value, 0) * 1000) / 1000
    : null;

  // Validation warnings
  if (totalTerpenes !== null && totalTerpenes > TOTAL_TERPENES_WARNING_THRESHOLD) {
    warnings.push(`Total terpenes (${totalTerpenes}%) exceeds ${TOTAL_TERPENES_WARNING_THRESHOLD}% — verify accuracy.`);
  }

  const thcResult = cannabinoids.find(c => c.name === 'THC' || c.name === 'delta-9-THC');
  if (thcResult && thcResult.value > THC_WARNING_THRESHOLD) {
    warnings.push(`THC value (${thcResult.value}%) exceeds ${THC_WARNING_THRESHOLD}% — verify accuracy.`);
  }

  // Flag out-of-range individual values
  for (const t of terpenes) {
    if (t.value < TERPENE_MIN || t.value > TERPENE_MAX) {
      warnings.push(`Terpene "${t.name}" value ${t.value}${t.unit} is outside expected range (${TERPENE_MIN}-${TERPENE_MAX}%).`);
    }
  }
  for (const c of cannabinoids) {
    if (c.value < CANNABINOID_MIN || c.value > CANNABINOID_MAX) {
      warnings.push(`Cannabinoid "${c.name}" value ${c.value}${c.unit} is outside expected range (${CANNABINOID_MIN}-${CANNABINOID_MAX}%).`);
    }
  }

  if (terpenes.length === 0) {
    warnings.push('No terpene data found in document.');
  }
  if (cannabinoids.length === 0) {
    warnings.push('No cannabinoid data found in document.');
  }

  // Compute overall confidence (weighted average)
  // Weights: cannabinoids 0.4, terpenes 0.3, labInfo 0.15, batchInfo 0.15
  const avgTerpeneConf = terpenes.length > 0
    ? terpenes.reduce((sum, t) => sum + t.confidence, 0) / terpenes.length
    : 0;
  const avgCannabinoidConf = cannabinoids.length > 0
    ? cannabinoids.reduce((sum, c) => sum + c.confidence, 0) / cannabinoids.length
    : 0;

  const overallConfidence = Math.round(
    (avgCannabinoidConf * 0.4 +
     avgTerpeneConf * 0.3 +
     labInfo.confidence * 0.15 +
     batchInfo.confidence * 0.15) * 1000,
  ) / 1000;

  return {
    terpenes,
    cannabinoids,
    labInfo,
    batchInfo,
    totalTerpenes,
    totalCannabinoids,
    overallConfidence,
    warnings,
    tier: 'regex',
  };
}
