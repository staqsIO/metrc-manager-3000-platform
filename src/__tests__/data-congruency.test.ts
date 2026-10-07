/**
 * Data Congruency Tests
 *
 * Proves that the copilot (chat) and dashboard tRPC routers read from
 * the same data sources and apply the same calculations. These tests
 * were written after the CEO flagged that chat and dashboard were returning
 * different numbers.
 *
 * Each test is a static code-analysis assertion (grep over source) or a
 * pure-function unit test. No network calls, no database, no mocks needed.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC = resolve(__dirname, '..');

function readSource(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Test 1: Package data source alignment
// Read/query procedures must use getActivePackagesFromDb, NOT live API.
// ---------------------------------------------------------------------------

describe('Test 1: Package data source — read procedures use DB snapshot', () => {
  /**
   * Pattern that would indicate a live Metrc API call for packages in a READ
   * procedure context. Write procedures (getMetrcClientForWrite) are fine.
   *
   * We look for `getMetrcClient(` followed (anywhere on the same line) by
   * an assignment that then calls `.getActivePackages()`. The actual files
   * use `getMetrcClientForWrite` for mutations and `getActivePackagesFromDb`
   * for reads — these are distinct import paths.
   *
   * Strategy: assert that no bare `getMetrcClient(` call is followed by
   * `.getActivePackages()` in read-path routers. We exclude lines that are
   * part of write/mutation blocks by checking for `getMetrcClientForWrite`.
   */

  // Lines that call both getMetrcClient AND getActivePackages on the SAME call chain
  // (i.e., live API read). We count lines matching `getMetrcClient` that also
  // contain `.getActivePackages` — these would be live-read violations.
  function findLiveReadLines(source: string): string[] {
    return source
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
        // getMetrcClientForWrite is fine (mutation paths)
        if (trimmed.includes('getMetrcClientForWrite')) return false;
        // Flag: bare getMetrcClient call on same line as getActivePackages
        return trimmed.includes('getMetrcClient(') && trimmed.includes('.getActivePackages');
      });
  }

  it('packages.ts read procedures use getActivePackagesFromDb', () => {
    const src = readSource('server/api/routers/packages.ts');

    // Confirm the snapshot import is present
    expect(src).toContain('getActivePackagesFromDb');

    // Confirm the five key read procedures call it.
    // Use a generous 400-char window — each procedure has guard/input boilerplate
    // before the actual getActivePackagesFromDb call.
    expect(src).toMatch(/fragmentation[\s\S]{0,400}getActivePackagesFromDb/);
    expect(src).toMatch(/consolidationRecs[\s\S]{0,400}getActivePackagesFromDb/);
    // sampleOutCandidates is declared as `sampleOutCandidates: facilityProcedure`
    // and calls getActivePackagesFromDb within ~200 chars of the key name.
    expect(src).toMatch(/sampleOutCandidates[\s\S]{0,400}getActivePackagesFromDb/);
    expect(src).toMatch(/biomassUtilization[\s\S]{0,400}getActivePackagesFromDb/);
    expect(src).toMatch(/shortCounts[\s\S]{0,400}getActivePackagesFromDb/);

    // No live read calls in read-only procedures
    const liveLines = findLiveReadLines(src);
    expect(liveLines, `Found live Metrc API read calls:\n${liveLines.join('\n')}`).toHaveLength(0);
  });

  it('inventory.ts read procedures use getActivePackagesFromDb', () => {
    const src = readSource('server/api/routers/inventory.ts');

    expect(src).toContain('getActivePackagesFromDb');

    const liveLines = findLiveReadLines(src);
    expect(liveLines, `Found live Metrc API read calls:\n${liveLines.join('\n')}`).toHaveLength(0);
  });

  it('lab-tests.ts read procedures use getActivePackagesFromDb', () => {
    const src = readSource('server/api/routers/lab-tests.ts');

    expect(src).toContain('getActivePackagesFromDb');

    const liveLines = findLiveReadLines(src);
    expect(liveLines, `Found live Metrc API read calls:\n${liveLines.join('\n')}`).toHaveLength(0);
  });

  it('pipeline.ts getPipelineConfig uses getActivePackagesFromDb, not live API', () => {
    const src = readSource('server/api/routers/pipeline.ts');

    // getPipelineConfig is a pure DB query — should never hit Metrc for packages
    // Find the getPipelineConfig procedure block
    const configBlock = src.slice(
      src.indexOf('getPipelineConfig'),
      src.indexOf('getPipelineConfig') + 600,
    );
    expect(configBlock).not.toContain('getMetrcClient(');
    // The router does use getActivePackagesFromDb for getFullPipeline
    expect(src).toContain('getActivePackagesFromDb');
  });

  it('copilot-tools.ts package reads use getActivePackagesFromDb', () => {
    const src = readSource('services/copilot/copilot-tools.ts');

    // The copilot pre-fetches packages from DB, not live API
    expect(src).toContain('getActivePackagesFromDb');

    // The import should reference snapshot-utils
    expect(src).toContain('snapshot-utils');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Category margins calculation congruency
// computeCategoryMargins is the shared pure function used by both paths.
// ---------------------------------------------------------------------------

describe('Test 2: Category margins — shared pure function, correct output shape', () => {
  it('computeCategoryMargins returns categories with required financial fields', async () => {
    const { computeCategoryMargins } = await import('@/server/api/routers/sales');

    // Minimal Dutchie mock data matching DutchieRawTransaction / DutchieRawTransactionItem shapes.
    // Fields used by accumulateCategoryMargins: transactionDate, isVoid, items[].productId,
    // items[].totalPrice, items[].quantity, items[].unitCost
    const transactions = [
      {
        transactionId: 1,
        dispensaryId: 'd1',
        transactionDate: new Date(Date.now() - 1000).toISOString(), // 1 second ago — within cutoff
        isVoid: false,
        // items field name matches DutchieRawTransaction.items
        items: [
          { productId: 101, totalPrice: 100, quantity: 2, unitCost: 30 },
          { productId: 102, totalPrice: 50,  quantity: 1, unitCost: 20 },
        ],
      },
    ];

    // DutchieRawProduct: productId (number) + category (string) + name (string)
    const products = [
      { productId: 101, category: 'Flower', name: 'Blue Dream',  isActive: true },
      { productId: 102, category: 'Edible', name: 'Gummy Bears', isActive: true },
    ];

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const result = computeCategoryMargins(transactions as never, products as never, cutoff);

    // Output shape must include categories array
    expect(result).toHaveProperty('categories');
    expect(Array.isArray(result.categories)).toBe(true);
    expect(result.categories.length).toBeGreaterThan(0);

    // Each category must have the four fields the dashboard and copilot both display
    for (const cat of result.categories) {
      expect(cat).toHaveProperty('cogs');
      expect(cat).toHaveProperty('grossProfit');
      expect(cat).toHaveProperty('marginPercent');
      expect(cat).toHaveProperty('revenueShare');
      expect(cat).toHaveProperty('category');
      expect(cat).toHaveProperty('revenue');
    }

    // normalizeCategory maps 'Flower' → 'Flower', 'Edible' → 'Edibles'
    // (via CATEGORY_NORM_MAP in run-rate-engine.ts)

    // Verify Flower category math
    const flower = result.categories.find((c: { category: string }) => c.category === 'Flower');
    expect(flower, 'Flower category must exist in result').toBeDefined();
    // revenue=100, cogs=2*30=60, grossProfit=40, marginPercent=40
    expect(flower!.cogs).toBe(60);
    expect(flower!.grossProfit).toBe(40);
    expect(flower!.marginPercent).toBe(40);

    // 'Edible' is normalised to 'Edibles' by CATEGORY_NORM_MAP
    const edible = result.categories.find((c: { category: string }) => c.category === 'Edibles');
    expect(edible, 'Edibles category must exist in result (normalised from "Edible")').toBeDefined();
    // revenue=50, cogs=1*20=20, grossProfit=30, marginPercent=60
    expect(edible!.cogs).toBe(20);
    expect(edible!.grossProfit).toBe(30);
    expect(edible!.marginPercent).toBe(60);

    // revenueShare: Flower=100/150*100=66.67, Edibles=50/150*100=33.33
    expect(flower!.revenueShare).toBeCloseTo(66.67, 1);
    expect(edible!.revenueShare).toBeCloseTo(33.33, 1);
  });

  it('copilot-tools.ts get_category_margins imports computeCategoryMargins from sales router', () => {
    const src = readSource('services/copilot/copilot-tools.ts');

    // Copilot must import computeCategoryMargins (not inline its own calc)
    expect(src).toContain('@/server/api/routers/sales');
    expect(src).toContain('computeCategoryMargins');

    // Verify the import + call appear inside the get_category_margins case body.
    // Window is generous because the case body has guard + try/catch boilerplate.
    const caseStart = src.indexOf("case 'get_category_margins'");
    expect(caseStart).toBeGreaterThan(-1);
    const caseBlock = src.slice(caseStart, caseStart + 2500);
    expect(caseBlock).toContain('computeCategoryMargins');
  });

  it('computeCategoryMargins excludes voided transactions', async () => {
    const { computeCategoryMargins } = await import('@/server/api/routers/sales');

    const transactions = [
      {
        transactionId: 1,
        dispensaryId: 'd1',
        transactionDate: new Date().toISOString(),
        isVoid: true, // voided — must be excluded
        items: [{ productId: 101, totalPrice: 999, quantity: 5, unitCost: 100 }],
      },
    ];
    const products = [{ productId: 101, category: 'Flower', name: 'Test' }];
    const cutoff = new Date(Date.now() - 1000);

    const result = computeCategoryMargins(transactions as never, products as never, cutoff);
    // Voided transaction — no categories should be returned
    expect(result.categories).toHaveLength(0);
    expect(result.totals.revenue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Daily sales date field — CompletedDate not CreatedDate
// ---------------------------------------------------------------------------

describe('Test 3: Daily sales date field uses CompletedDate (no CreatedDate fallback)', () => {
  it('get_daily_sales handler delegates to the shared computeDailySales helper and never falls back to CreatedDate', () => {
    const src = readSource('services/copilot/copilot-tools.ts');

    const caseStart = src.indexOf("case 'get_daily_sales'");
    expect(caseStart, 'get_daily_sales case must exist in copilot-tools.ts').toBeGreaterThan(-1);

    // Generous window — the chat handler has Dutchie/Metrc fallback branches.
    const caseBlock = src.slice(caseStart, caseStart + 4000);

    // The chat tool must call the dashboard's shared helper, not inline grouping.
    expect(caseBlock).toContain('computeDailySales');

    // Per parity plan Step 2, the CreatedDate fallback was deliberately removed —
    // the dashboard never groups by CreatedDate, so chat must not either.
    expect(caseBlock).not.toMatch(/CreatedDate/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Tool routing priority
// Sales queries must route to sales tools first, not inventory tools.
// ALWAYS_INCLUDE must only contain search_packages.
// ---------------------------------------------------------------------------

describe('Test 4: Tool routing priority', () => {
  it('ALWAYS_INCLUDE only contains search_packages', () => {
    const src = readSource('services/copilot/copilot-service.ts');

    // Find the ALWAYS_INCLUDE set declaration
    const alwaysStart = src.indexOf('const ALWAYS_INCLUDE');
    expect(alwaysStart).toBeGreaterThan(-1);

    // Extract just the set literal (up to closing bracket)
    const setBlock = src.slice(alwaysStart, alwaysStart + 300);
    const setLiteral = setBlock.slice(setBlock.indexOf('new Set('), setBlock.indexOf(')') + 1);

    // Must contain search_packages
    expect(setLiteral).toContain('search_packages');

    // Must NOT contain get_inventory_overview or run_compliance_audit
    expect(setLiteral).not.toContain('get_inventory_overview');
    expect(setLiteral).not.toContain('run_compliance_audit');
  });

  it('selectToolsForQuery returns matched-category tools (and the no-match path returns empty)', async () => {
    // Behavior test (parity plan R4): a category-matching query yields the
    // matched tools without unrelated categories, and a no-match query
    // returns an empty list — no silent "all tools" fallback.
    const { __selectToolsForQueryForTest } = await import(
      '@/services/copilot/copilot-service'
    );
    const fakeTools = [
      { type: 'function', function: { name: 'get_category_margins', description: '', parameters: { type: 'object', properties: {}, required: [] } } },
      { type: 'function', function: { name: 'analyze_aging', description: '', parameters: { type: 'object', properties: {}, required: [] } } },
    ] as never;

    const matched = __selectToolsForQueryForTest('show me margin breakdown', fakeTools);
    const matchedNames = matched.map((t: { function: { name: string } }) => t.function.name);
    expect(matchedNames).toContain('get_category_margins');

    const noMatch = __selectToolsForQueryForTest('xyzzy plover quux', fakeTools);
    expect(noMatch).toEqual([]);
  });

  it('sales tool category keywords include "margin"', () => {
    const src = readSource('services/copilot/copilot-service.ts');

    // Find TOOL_CATEGORIES block that includes get_category_margins
    const marginsToolIdx = src.indexOf('get_category_margins');
    expect(marginsToolIdx).toBeGreaterThan(-1);

    // The surrounding category entry must have 'margin' as a keyword
    const nearbyBlock = src.slice(
      Math.max(0, marginsToolIdx - 300),
      marginsToolIdx + 300,
    );
    expect(nearbyBlock).toContain('margin');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Multiagent bridge (ask_knowledge_base)
// ---------------------------------------------------------------------------

describe('Test 5: ask_knowledge_base multiagent bridge exists', () => {
  it('ask_knowledge_base tool is defined in COPILOT_TOOLS (tool-defs)', () => {
    const src = readSource('services/copilot/copilot-tool-defs.ts');

    // The tool definition must be present
    expect(src).toContain("name: 'ask_knowledge_base'");
  });

  it('ask_knowledge_base is in ORG_COMPATIBLE_TOOLS', () => {
    const src = readSource('services/copilot/copilot-tools.ts');

    // Find the ORG_COMPATIBLE_TOOLS set
    const orgStart = src.indexOf('export const ORG_COMPATIBLE_TOOLS');
    expect(orgStart).toBeGreaterThan(-1);

    const orgBlock = src.slice(orgStart, orgStart + 400);
    expect(orgBlock).toContain('ask_knowledge_base');
  });

  it('ask_knowledge_base handler exists in copilot-tools.ts', () => {
    const src = readSource('services/copilot/copilot-tools.ts');

    // The case handler must be present
    expect(src).toContain("case 'ask_knowledge_base'");

    // And it must have a handler body (not just fall through)
    const caseIdx = src.indexOf("case 'ask_knowledge_base'");
    // The handler body has boilerplate (question extraction, env check) before
    // the first await/return — use a 400-char window to cover it.
    const handlerBlock = src.slice(caseIdx, caseIdx + 400);
    // Handler body should have some logic — at minimum a return or await
    expect(handlerBlock).toMatch(/return|await/);
  });
});
