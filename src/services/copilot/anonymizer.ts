/**
 * Structural anonymizer for Copilot → OpenRouter data flow.
 *
 * Replaces known sensitive fields (facility names, license numbers, strains,
 * manifests, package tags) with collision-resistant tokens before sending
 * to the LLM, then reverses the mapping in the response.
 *
 * Token format: `__TYPE_NNN__` (e.g., `__FAC_001__`, `__MFST_0042__`).
 * The double-underscore + caps + numeric suffix is unlikely to appear in
 * legitimate data — makes leak audits unambiguous and prevents accidental
 * replacement of real values that happen to look like tokens.
 *
 * Defense-in-depth: also strips patterns matching patient license numbers
 * even though current tools don't expose them.
 */

export interface AnonymizerMapping {
  type: 'facility' | 'license' | 'tag' | 'manifest' | 'strain' | 'org' | 'state';
  real: string;
  token: string;
}

export interface Anonymizer {
  /** Replace sensitive values with tokens in outbound text */
  anonymize(text: string): string;
  /** Restore original values in inbound LLM response */
  deanonymize(text: string): string;
  /** Snapshot of the current real→token mapping (for debug/audit UI) */
  getMappings(): AnonymizerMapping[];
}

// Audit transcript types — canonical here so client components (CopilotPanel)
// and server modules (openrouter-client, copilot-service) share one source of
// truth. Both must stay client-safe — no node:* imports allowed in this file.
export interface AnonymizationAuditEntry {
  /** 'system_prompt' | 'tool_result:<tool_name>' | 'final_response' | etc. */
  source: string;
  /** What the LLM saw (anonymized) */
  sentToLLM: string;
  /** What the user saw (deanonymized), only set on final_response */
  shownToUser?: string;
}

export interface AnonymizationAudit {
  mappings: AnonymizerMapping[];
  entries: AnonymizationAuditEntry[];
}

export interface AnonymizerContext {
  facilityName?: string;
  licenseNumber?: string;
  stateCode?: string;
  /** Additional facility names/licenses for cross-facility queries */
  orgFacilities?: Array<{ name: string; licenseNumber: string }>;
  /** Strain names from the facility's catalog (passed in by caller) */
  strains?: string[];
  /** Organization name */
  orgName?: string;
}

// Metrc package tag pattern (24-char state-assigned codes like 1A40A0300003F49000194712)
const METRC_TAG_PATTERN = /\b1A[0-9A-F]{22}\b/g;

// Manifest number capture — anchored to JSON field names or "Manifest #/:"
// context so we don't false-positive on package quantities, prices, or
// phone numbers. Captures the numeric value in group 1.
const MANIFEST_FIELD_PATTERN =
  /(?:"(?:manifestNumber|manifest_number|manifestNum|Manifest)"\s*:\s*"?|\bManifest\s*[#:]\s*)(\d{8,13})\b/gi;

// Patient license number patterns (defense-in-depth — strip even if tools don't expose)
const PATIENT_ID_PATTERNS: RegExp[] = [
  /\b[A-Z]{2}-PAT-\d{4,10}\b/g,
  /\bPAT\d{6,12}\b/g,
  /\bMMJ-\d{4,10}\b/g,
  /\bPatientLicenseNumber["':\s]+["']?[^"',}\s]+/gi,
];

const PATIENT_REDACTION_TOKEN = '__PAT_REDACTED__';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Create a per-request anonymizer from the facility context.
 * The mapping lives in memory for the duration of the request only.
 */
export function createAnonymizer(ctx: AnonymizerContext): Anonymizer {
  // Static map: real value → token. Built once from context.
  const forwardMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();
  const typeOf = new Map<string, AnonymizerMapping['type']>();

  let facilityCounter = 0;
  let licenseCounter = 0;
  let strainCounter = 0;

  function addMapping(real: string, token: string, type: AnonymizerMapping['type']) {
    if (!real || real.length < 2) return;
    if (forwardMap.has(real)) return;
    forwardMap.set(real, token);
    reverseMap.set(token, real);
    typeOf.set(token, type);
  }

  if (ctx.orgName) addMapping(ctx.orgName, '__ORG_001__', 'org');
  // stateCode (e.g., "MA") is intentionally NOT anonymized — it isn't PII,
  // and substring-replacing 2-letter codes corrupts other patterns
  // (e.g., "MA-PAT-12345" patient IDs would lose their MA prefix).

  if (ctx.facilityName) {
    addMapping(ctx.facilityName, `__FAC_${pad(++facilityCounter, 3)}__`, 'facility');
  }
  if (ctx.licenseNumber) {
    addMapping(ctx.licenseNumber, `__LIC_${pad(++licenseCounter, 3)}__`, 'license');
  }

  if (ctx.orgFacilities) {
    for (const f of ctx.orgFacilities) {
      if (f.name && !forwardMap.has(f.name)) {
        addMapping(f.name, `__FAC_${pad(++facilityCounter, 3)}__`, 'facility');
      }
      if (f.licenseNumber && !forwardMap.has(f.licenseNumber)) {
        addMapping(f.licenseNumber, `__LIC_${pad(++licenseCounter, 3)}__`, 'license');
      }
    }
  }

  if (ctx.strains) {
    for (const s of ctx.strains) {
      if (s && !forwardMap.has(s)) {
        addMapping(s, `__STRAIN_${pad(++strainCounter, 3)}__`, 'strain');
      }
    }
  }

  // Dynamic mappings — built as values are encountered. Consistent within a
  // request so the LLM sees the same token for the same real value across
  // multiple tool calls.
  let tagCounter = 0;
  let manifestCounter = 0;

  // Sort static entries by length descending so longer matches replace first
  // (prevents "Main Manufacturing" matching before "Main Manufacturing Facility").
  // Recomputed lazily — small N, recompute is cheap.
  function sortedStaticEntries(): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    forwardMap.forEach((token, real) => {
      const t = typeOf.get(token);
      if (t !== 'tag' && t !== 'manifest') entries.push([real, token]);
    });
    return entries.sort((a, b) => b[0].length - a[0].length);
  }

  function anonymize(text: string): string {
    let result = text;

    // 1. Static replacements (facility, license, strain, org, state)
    for (const [real, token] of sortedStaticEntries()) {
      result = result.split(real).join(token);
    }

    // 2. Dynamic Metrc package tags → __TAG_NNNN__
    result = result.replace(new RegExp(METRC_TAG_PATTERN.source, 'g'), (tag) => {
      let token = forwardMap.get(tag);
      if (!token) {
        token = `__TAG_${pad(++tagCounter, 4)}__`;
        addMapping(tag, token, 'tag');
      }
      return token;
    });

    // 3. Dynamic manifest numbers → __MFST_NNN__ (anchored to field/keyword)
    result = result.replace(MANIFEST_FIELD_PATTERN, (match, manifest: string) => {
      let token = forwardMap.get(manifest);
      if (!token) {
        token = `__MFST_${pad(++manifestCounter, 3)}__`;
        addMapping(manifest, token, 'manifest');
      }
      return match.replace(manifest, token);
    });

    // 4. Defense-in-depth — strip patient license patterns
    for (const pattern of PATIENT_ID_PATTERNS) {
      result = result.replace(new RegExp(pattern.source, pattern.flags), PATIENT_REDACTION_TOKEN);
    }

    return result;
  }

  function deanonymize(text: string): string {
    // 1. Markdown-aware LLMs (Sonnet 4.6, GPT-4o) escape reserved chars when
    //    emitting tokens inside table cells to prevent `__x__` rendering as
    //    bold. Strip backslash escapes so `\_\_TAG\_0017\_\_` → `__TAG_0017__`.
    let result = text.replace(/\\([_*~`\\])/g, '$1');

    // 2. Fuzzy normalization — LLMs sometimes mangle our tokens for compact
    //    display (e.g. truncating with ellipsis or dropping underscores
    //    despite the "preserve verbatim" instruction). Rewrite common partial
    //    forms back to canonical `__TYPE_NNN__` so the literal lookup hits.
    //    Token-types are spelled out (no metacharacters that would let real
    //    text accidentally match).
    result = result.replace(
      /(?:[…\.]+\s*|_*)\b(TAG|FAC|LIC|MFST|STRAIN|ORG)_(\d{1,4})_*\b/g,
      (_match, type: string, num: string) => {
        const padTo = type === 'TAG' ? 4 : 3;
        const canonical = `__${type}_${num.padStart(padTo, '0')}__`;
        return reverseMap.has(canonical) ? canonical : _match;
      },
    );

    // 3. Reverse-map literal replace (longest tokens first to avoid partial
    //    overlaps).
    const reverseEntries: Array<[string, string]> = [];
    reverseMap.forEach((real, token) => reverseEntries.push([token, real]));
    reverseEntries.sort((a, b) => b[0].length - a[0].length);
    for (const [token, real] of reverseEntries) {
      result = result.split(token).join(real);
    }
    return result;
  }

  function getMappings(): AnonymizerMapping[] {
    const out: AnonymizerMapping[] = [];
    forwardMap.forEach((token, real) => {
      const type = typeOf.get(token);
      if (type) out.push({ type, real, token });
    });
    return out;
  }

  return { anonymize, deanonymize, getMappings };
}
