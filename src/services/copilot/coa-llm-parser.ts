// COA (Certificate of Analysis) LLM Parser — Tier 2
// Uses the configured LLM provider (src/services/llm) for text-based structured extraction.
// Phase 1: text-only. Phase 2 will add vision/image support.

import { callLLM } from './openrouter-client';
import { resolveLlm } from '@/services/llm/registry';
import type {
  TerpeneResult,
  CannabinoidResult,
  LabInfo,
  BatchInfo,
  COAParseResult,
} from '@/services/engines/coa-parsing-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface COALLMParseResult {
  terpenes: TerpeneResult[];
  cannabinoids: CannabinoidResult[];
  labInfo: LabInfo;
  batchInfo: BatchInfo;
  totalTerpenes: number | null;
  totalCannabinoids: number | null;
  overallConfidence: number;
  warnings: string[];
  tier: 'llm';
  model: string;
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = 'openai/gpt-4o';

// ---------------------------------------------------------------------------
// CI stripping — remove Confidential Information before sending to LLM
// ---------------------------------------------------------------------------

// Top Michigan cannabis testing labs (names may appear in COA headers/footers)
const MI_LAB_NAMES = [
  'Viridis Laboratories', 'PSI Labs', 'Confidence Analytics',
  'Iron Laboratories', 'Steep Hill', 'CannSafe Analytics',
  'PLLC Laboratories', 'Kaycha Labs', 'SC Labs', 'ACS Laboratory',
];
const LAB_NAME_PATTERN = new RegExp(MI_LAB_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

// License patterns: MI format (e.g., AU-R-000123), common state formats
const LICENSE_PATTERN = /\b(?:AU|PC|PR|GR|MF|MI|SF|EU|EX|TF)-[A-Z]-\d{4,8}\b|\b[A-Z]{2}-\d{5,10}\b/g;

// Batch and sample ID patterns (alphanumeric with dashes, 8+ chars)
const BATCH_SAMPLE_PATTERN = /\b(?:batch|sample|lot)[:\s#]*[A-Za-z0-9-]{6,}\b/gi;

/**
 * Strip Confidential Information from COA text before sending to LLM.
 * Replaces lab names, license numbers, and batch/sample IDs with placeholders.
 * Chemistry data (terpenes, cannabinoids, percentages) is preserved.
 */
function stripCOAConfidentialInfo(text: string): string {
  return text
    .replace(LAB_NAME_PATTERN, '[LAB]')
    .replace(LICENSE_PATTERN, '[LICENSE]')
    .replace(BATCH_SAMPLE_PATTERN, '[ID]');
}

// ---------------------------------------------------------------------------
// System prompt with strict JSON schema
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Certificate of Analysis (COA) data extraction specialist for the cannabis industry. Extract structured data from the provided COA text.

Return ONLY valid JSON matching this exact schema (no markdown, no code fences, no extra text):

{
  "terpenes": [
    { "name": "string (canonical name, e.g., alpha-Pinene, beta-Pinene, Myrcene)", "value": "number (percentage)", "unit": "string (% or mg/g)" }
  ],
  "cannabinoids": [
    { "name": "string (e.g., THC, THCA, CBD, CBDA, CBG)", "value": "number (percentage)", "unit": "string (% or mg/g)" }
  ]
}

Rules:
- Keep alpha-pinene and beta-pinene SEPARATE — do NOT combine them.
- Use canonical names: alpha-Pinene, beta-Pinene, beta-Caryophyllene, alpha-Humulene, etc.
- Cannabinoid names: THC, THCA, CBD, CBDA, CBG, CBGA, CBN, CBNA, THCV, CBDV, delta-8-THC, delta-9-THC, delta-10-THC, THCVA, CBDVA.
- Values must be numbers, not strings. Use the percentage value if both percentage and mg/g are given.
- Only include compounds that have actual numeric values in the document.
- If a field cannot be determined, use null.
- Do NOT include "ND" (not detected) or "LOQ" entries — only include compounds with positive numeric values.
- Do NOT extract lab names, license numbers, batch IDs, or sample IDs — those are handled separately.`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse COA text using the configured LLM provider (Tier 2).
 *
 * @param pdfText - The full text extracted from the COA PDF
 * @param textHint - Optional Tier 1 regex result as context for verification
 * @returns Structured parse result with LLM confidence
 */
export async function parseCOAWithLLM(
  pdfText: string,
  textHint?: COAParseResult,
): Promise<COALLMParseResult> {
  const emptyResult: COALLMParseResult = {
    terpenes: [],
    cannabinoids: [],
    labInfo: { labName: null, licenseNumber: null, testDate: null, confidence: 0 },
    batchInfo: { batchNumber: null, sampleId: null, productName: null, confidence: 0 },
    totalTerpenes: null,
    totalCannabinoids: null,
    overallConfidence: 0,
    warnings: [],
    tier: 'llm',
    model: MODEL,
    tokensUsed: 0,
  };

  try {
    const llm = await resolveLlm(MODEL);
    if (!llm) {
      return { ...emptyResult, warnings: ['AI parsing skipped: no LLM provider configured'] };
    }
    // Strip CI (lab names, license numbers, batch IDs) before sending to LLM
    const sanitizedText = stripCOAConfidentialInfo(pdfText);
    let userContent = `Extract all terpene and cannabinoid data from this COA document text:\n\n${sanitizedText}`;
    // If Tier 1 results are available, include chemistry data as context (no CI)
    if (textHint && (textHint.terpenes.length > 0 || textHint.cannabinoids.length > 0)) {
      const hintSummary = {
        terpenes: textHint.terpenes.map(t => `${t.name}: ${t.value}${t.unit}`),
        cannabinoids: textHint.cannabinoids.map(c => `${c.name}: ${c.value}${c.unit}`),
      };
      userContent += `\n\n---\nTier 1 regex found these values (please verify and correct if needed):\n${JSON.stringify(hintSummary, null, 2)}`;
    }
    let tokensUsed = 0;
    const message = await callLLM(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      undefined,
      {
        llm, temperature: 0.1, maxTokens: 4096, jsonResponse: true, timeoutMs: 60_000,
        onUsage: (u) => { tokensUsed = u.totalTokens; },
      },
    );
    const resultModel = llm.model;

    if (!message.content) {
      return {
        ...emptyResult,
        tokensUsed,
        warnings: ['LLM returned no content.'],
      };
    }

    // Parse the JSON response (chemistry data only — labInfo/batchInfo come from Tier 1 regex)
    const rawContent = message.content;
    let parsed: {
      terpenes?: { name: string; value: number; unit: string }[];
      cannabinoids?: { name: string; value: number; unit: string }[];
    };

    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return {
        ...emptyResult,
        tokensUsed,
        warnings: ['LLM returned invalid JSON.'],
      };
    }

    // Map parsed data to typed results
    const warnings: string[] = [];

    const terpenes: TerpeneResult[] = (parsed.terpenes ?? [])
      .filter(t => typeof t.value === 'number' && t.value > 0)
      .map(t => ({
        name: t.name,
        value: t.value,
        unit: t.unit || '%',
        // Range-based confidence: boost for values within expected terpene range (0.01-10%)
        confidence: (t.value >= 0.01 && t.value <= 10) ? 0.9 : 0.6,
      }));

    const cannabinoids: CannabinoidResult[] = (parsed.cannabinoids ?? [])
      .filter(c => typeof c.value === 'number' && c.value > 0)
      .map(c => ({
        name: c.name,
        value: c.value,
        unit: c.unit || '%',
        // Range-based confidence: boost for values within expected cannabinoid range (0.01-100%)
        confidence: (c.value >= 0.01 && c.value <= 100) ? 0.9 : 0.6,
      }));

    // labInfo and batchInfo come from Tier 1 regex only — not sent to LLM
    const labInfo: LabInfo = textHint?.labInfo ?? {
      labName: null, licenseNumber: null, testDate: null, confidence: 0,
    };

    const batchInfo: BatchInfo = textHint?.batchInfo ?? {
      batchNumber: null, sampleId: null, productName: null, confidence: 0,
    };

    // Compute totals
    const totalTerpenes = terpenes.length > 0
      ? Math.round(terpenes.reduce((sum, t) => sum + t.value, 0) * 1000) / 1000
      : null;
    const totalCannabinoids = cannabinoids.length > 0
      ? Math.round(cannabinoids.reduce((sum, c) => sum + c.value, 0) * 1000) / 1000
      : null;

    // Validation warnings
    if (totalTerpenes !== null && totalTerpenes > 15) {
      warnings.push(`Total terpenes (${totalTerpenes}%) exceeds 15% — verify accuracy.`);
    }
    const thcResult = cannabinoids.find(c => c.name === 'THC' || c.name === 'delta-9-THC');
    if (thcResult && thcResult.value > 40) {
      warnings.push(`THC value (${thcResult.value}%) exceeds 40% — verify accuracy.`);
    }

    // Overall confidence — LLM is generally more confident than regex
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
      tier: 'llm',
      model: resultModel,
      tokensUsed,
    };
  } catch (error) {
    console.error('[COA-LLM] Parsing failed:', error instanceof Error ? error.message : error);
    return {
      ...emptyResult,
      warnings: [`LLM error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}
