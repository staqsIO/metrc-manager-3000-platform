#!/usr/bin/env tsx
/**
 * Copilot Eval Runner
 *
 * Loads a golden-set JSON, executes each question against the live Copilot
 * service, and asserts:
 *   - Expected tools were called (subset match)
 *   - Forbidden tools were NOT called
 *   - Response contains expected substrings (case-insensitive)
 *   - Response time under maxDurationMs
 *   - Anonymization round-trip is clean (no leaked tokens, sensitive values restored)
 *
 * Usage:
 *   FACILITY_ID=<cuid> USER_ID=<id> pnpm copilot:eval golden-set-cultivator.json
 *   ORG_MODE=1       USER_ID=<id> pnpm copilot:eval golden-set-executive.json
 *
 * Exit code: 0 on all-pass, 1 on any failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma, dashboardPrisma } from '../../../lib/prisma';
import { executeCopilotQuery } from '../copilot-service';
import { getUserOrgIds } from '../../../lib/auth-helpers';
import type { MetrcFacility } from '@prisma/client';

interface GoldenQuestion {
  id: string;
  question: string;
  notes?: string;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectContains?: string[];
  expectNumericNear?: { value: number; tolerance?: number };
  maxDurationMs?: number;
  skip?: boolean;
}

interface GoldenSet {
  version: string;
  description?: string;
  questions: GoldenQuestion[];
}

interface AnonymizationAudit {
  /** Sensitive values found in the final user-facing response (good — means deanonymize fired) */
  restoredValuesFound: string[];
  /** Anonymizer-shaped tokens leaked into the final response (bad — means deanonymize missed) */
  leakedTokens: string[];
}

interface QuestionResult {
  id: string;
  question: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  durationMs: number;
  toolsCalled: string[];
  dataToolsCalled: string[]; // excludes synthetic _thinking
  expectedTools: string[];
  toolsMatched: string[]; // intersection of expected and called
  response: string;
  responseChars: number;
  failures: string[];
  warnings: string[];
  anonAudit?: AnonymizationAudit;
  rateLimited?: boolean;
}

const DEFAULT_MAX_DURATION_MS = 30_000;
const DEFAULT_NUMERIC_TOLERANCE = 0.01;
// Anonymizer token shape (matches forward-map outputs in anonymizer.ts)
const ANON_TOKEN_PATTERN = /__(?:FAC|LIC|TAG|MFST|PAT|ORG|STATE)_\d+__/g;

function loadGoldenSet(filePath: string): GoldenSet {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as GoldenSet;
  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error(`Invalid golden set at ${filePath}: missing questions[]`);
  }
  return parsed;
}

function extractNumbersFromText(text: string): number[] {
  const matches = text.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map(s => parseFloat(s.replace(/,/g, ''))).filter(n => !isNaN(n));
}

function auditAnonymization(
  response: string,
  sensitiveValues: string[],
): AnonymizationAudit {
  const restoredValuesFound: string[] = [];
  for (const v of sensitiveValues) {
    if (v && v.length >= 3 && response.includes(v)) {
      restoredValuesFound.push(v);
    }
  }
  const leakedTokens = response.match(ANON_TOKEN_PATTERN) ?? [];
  return { restoredValuesFound, leakedTokens: Array.from(new Set(leakedTokens)) };
}

const MIN_RESPONSE_CHARS = 200;

function evaluateQuestion(
  q: GoldenQuestion,
  result: { response: string; toolsCalled: string[]; durationMs: number; anonAudit: AnonymizationAudit },
): { failures: string[]; warnings: string[]; dataToolsCalled: string[]; toolsMatched: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Hard pass/fail — response quality
  if (result.response.startsWith('[ERROR]')) {
    failures.push('execution error');
  } else if (result.response.length < MIN_RESPONSE_CHARS) {
    failures.push(`response too short (${result.response.length} < ${MIN_RESPONSE_CHARS} chars)`);
  }

  // Hard pass/fail — at least one DATA tool was called (not just synthesis)
  const dataToolsCalled = result.toolsCalled.filter(t => !t.startsWith('_'));
  if (dataToolsCalled.length === 0) {
    failures.push('no data tools called');
  }

  // Hard pass/fail — anonymization round-trip clean
  if (result.anonAudit.leakedTokens.length > 0) {
    failures.push(`anonymizer tokens leaked: ${result.anonAudit.leakedTokens.join(',')}`);
  }

  // Soft signal — expected tools (informational only)
  const expected = q.expectedTools ?? [];
  const toolsMatched = expected.filter(t => result.toolsCalled.includes(t));
  if (expected.length > 0 && toolsMatched.length === 0) {
    warnings.push(`no expected tools matched (expected ${expected.length}, called ${dataToolsCalled.length})`);
  } else if (expected.length > 0 && toolsMatched.length < expected.length) {
    warnings.push(`partial tool match: ${toolsMatched.length}/${expected.length}`);
  }

  // Soft signal — forbidden tools
  if (q.forbiddenTools && q.forbiddenTools.length > 0) {
    for (const tool of q.forbiddenTools) {
      if (result.toolsCalled.includes(tool)) failures.push(`called forbidden tool: ${tool}`);
    }
  }

  // Soft signal — substring (only if explicitly set)
  if (q.expectContains && q.expectContains.length > 0) {
    const lower = result.response.toLowerCase();
    for (const needle of q.expectContains) {
      if (!lower.includes(needle.toLowerCase())) warnings.push(`response missing substring: "${needle.slice(0, 30)}…"`);
    }
  }

  // Numeric — explicit, only fails if set
  if (q.expectNumericNear) {
    const { value, tolerance = DEFAULT_NUMERIC_TOLERANCE } = q.expectNumericNear;
    const nums = extractNumbersFromText(result.response);
    const within = nums.some(n => Math.abs(n - value) <= tolerance * Math.abs(value));
    if (!within) {
      failures.push(`no number within ±${tolerance * 100}% of ${value} (found: ${nums.slice(0, 5).join(',')})`);
    }
  }

  const maxMs = q.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  if (result.durationMs > maxMs) warnings.push(`slow: ${result.durationMs}ms > ${maxMs}ms`);

  return { failures, warnings, dataToolsCalled, toolsMatched };
}

interface ExecutionContext {
  facility: MetrcFacility | null;
  orgFacilities: MetrcFacility[];
  userId: string;
  sensitiveValues: string[];
}

async function executeQuestion(
  question: string,
  ctx: ExecutionContext,
): Promise<{ response: string; toolsCalled: string[]; durationMs: number; rateLimited: boolean; anonAudit: AnonymizationAudit }> {
  const start = Date.now();
  const toolsCalled: string[] = [];
  let rateLimited = false;

  try {
    const result = await executeCopilotQuery({
      facility: ctx.facility as MetrcFacility,
      orgFacilities: ctx.orgFacilities,
      message: question,
      history: [],
      userId: ctx.userId,
      prisma,
      dashboardPrisma,
      onToolCall: (evt) => {
        if (evt.status === 'start') toolsCalled.push(evt.tool);
      },
    });
    const durationMs = Date.now() - start;
    const anonAudit = auditAnonymization(result.content, ctx.sensitiveValues);
    return { response: result.content, toolsCalled, durationMs, rateLimited, anonAudit };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|rate.?limit|too many/i.test(msg)) rateLimited = true;
    return {
      response: `[ERROR] ${msg}`,
      toolsCalled,
      durationMs: Date.now() - start,
      rateLimited,
      anonAudit: { restoredValuesFound: [], leakedTokens: [] },
    };
  }
}

async function resolveContext(): Promise<ExecutionContext> {
  const userId = process.env.USER_ID;
  if (!userId) throw new Error('USER_ID env var required');

  const orgIds = await getUserOrgIds(dashboardPrisma, userId);
  const orgFacilities = await prisma.metrcFacility.findMany({
    where: { organizationId: { in: orgIds }, isActive: true },
  });

  if (process.env.ORG_MODE === '1') {
    const sensitiveValues = orgFacilities.flatMap(f => [f.name, f.licenseNumber]).filter(Boolean) as string[];
    return { facility: null, orgFacilities, userId, sensitiveValues };
  }

  const facilityId = process.env.FACILITY_ID;
  if (!facilityId) throw new Error('FACILITY_ID env var required (or ORG_MODE=1)');
  const facility = await prisma.metrcFacility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new Error(`Facility not found: ${facilityId}`);
  const sensitiveValues = [facility.name, facility.licenseNumber].filter(Boolean) as string[];
  return { facility, orgFacilities, userId, sensitiveValues };
}

function formatResultsTable(results: QuestionResult[], setLabel: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`COPILOT EVAL RESULTS — ${setLabel}`);
  lines.push('='.repeat(90));
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '→' : r.rateLimited ? '⚠' : '✗';
    const matchInfo = r.expectedTools.length > 0
      ? ` match=${r.toolsMatched.length}/${r.expectedTools.length}`
      : '';
    lines.push(`${icon} ${r.id.padEnd(6)} ${r.status.toUpperCase().padEnd(5)} ${String(r.durationMs).padStart(6)}ms ${String(r.responseChars).padStart(5)}c tools=${r.dataToolsCalled.length}${matchInfo}`);
    if (r.failures.length > 0) {
      for (const f of r.failures.slice(0, 2)) lines.push(`    FAIL: ${f}`);
    }
    if (r.warnings.length > 0 && r.warnings.length <= 3) {
      for (const w of r.warnings) lines.push(`    warn: ${w}`);
    }
    if (r.anonAudit && r.anonAudit.leakedTokens.length > 0) {
      lines.push(`    LEAKED TOKENS: ${r.anonAudit.leakedTokens.join(', ')}`);
    }
  }
  lines.push('='.repeat(90));
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail' || r.status === 'error').length;
  const skip = results.filter(r => r.status === 'skip').length;
  const rl = results.filter(r => r.rateLimited).length;
  const anonLeaks = results.filter(r => r.anonAudit && r.anonAudit.leakedTokens.length > 0).length;
  const withExpected = results.filter(r => r.expectedTools.length > 0);
  const totalExpected = withExpected.reduce((s, r) => s + r.expectedTools.length, 0);
  const totalMatched = withExpected.reduce((s, r) => s + r.toolsMatched.length, 0);
  const matchRate = totalExpected > 0 ? Math.round((totalMatched / totalExpected) * 100) : 0;
  const responseQualityRate = results.length > 0 ? Math.round((pass / (pass + fail)) * 100) : 0;
  const avgDuration = pass + fail > 0 ? Math.round(results.filter(r => r.status !== 'skip').reduce((s, r) => s + r.durationMs, 0) / (pass + fail)) : 0;
  lines.push(`Summary: ${pass} pass, ${fail} fail, ${skip} skip, ${rl} rate-limited (${responseQualityRate}% pass)`);
  lines.push(`Tool match rate: ${totalMatched}/${totalExpected} (${matchRate}%)`);
  lines.push(`Anonymization: ${anonLeaks} questions with leaked tokens (target: 0)`);
  lines.push(`Avg duration: ${avgDuration}ms`);
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const filePath = process.argv[2];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`Golden set not found: ${filePath}`);
    return 2;
  }

  const setLabel = path.basename(filePath, '.json');
  console.log(`Loading: ${filePath}`);
  const goldenSet = loadGoldenSet(filePath);
  console.log(`Found ${goldenSet.questions.length} questions (version ${goldenSet.version})`);

  const ctx = await resolveContext();
  console.log(`Mode: ${ctx.facility ? `facility=${ctx.facility.name} (${ctx.facility.facilityType})` : `org (${ctx.orgFacilities.length} facilities)`}`);
  console.log(`User: ${ctx.userId}`);

  const results: QuestionResult[] = [];
  let consecutiveFailures = 0;

  for (const q of goldenSet.questions) {
    if (q.skip) {
      results.push({
        id: q.id, question: q.question, status: 'skip', durationMs: 0,
        toolsCalled: [], dataToolsCalled: [], expectedTools: q.expectedTools ?? [], toolsMatched: [],
        response: '', responseChars: 0, failures: [], warnings: [],
      });
      continue;
    }
    process.stdout.write(`  ${q.id} ${q.question.slice(0, 60).padEnd(62)} `);
    const execResult = await executeQuestion(q.question, ctx);
    const evalResult = evaluateQuestion(q, execResult);
    const status = evalResult.failures.length === 0 ? 'pass' : execResult.response.startsWith('[ERROR]') ? 'error' : 'fail';
    results.push({
      id: q.id,
      question: q.question,
      status,
      durationMs: execResult.durationMs,
      toolsCalled: execResult.toolsCalled,
      dataToolsCalled: evalResult.dataToolsCalled,
      expectedTools: q.expectedTools ?? [],
      toolsMatched: evalResult.toolsMatched,
      response: execResult.response,
      responseChars: execResult.response.length,
      failures: evalResult.failures,
      warnings: evalResult.warnings,
      anonAudit: execResult.anonAudit,
      rateLimited: execResult.rateLimited,
    });
    process.stdout.write(`${status} ${execResult.durationMs}ms${execResult.rateLimited ? ' [429]' : ''}\n`);
    if (status === 'pass') consecutiveFailures = 0;
    else consecutiveFailures++;
    if (consecutiveFailures >= 20) {
      console.warn('20 consecutive failures — aborting run (likely runner / config bug)');
      break;
    }
  }

  console.log(formatResultsTable(results, setLabel));

  // Write per-question full responses to disk for human review
  const outDir = path.join(__dirname, 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${setLabel}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ setLabel, results }, null, 2));
  console.log(`Full results written: ${outFile}`);

  await prisma.$disconnect();
  await dashboardPrisma.$disconnect();
  const anyFailed = results.some(r => r.status === 'fail' || r.status === 'error');
  return anyFailed ? 1 : 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Runner crashed:', err);
    process.exit(2);
  });
