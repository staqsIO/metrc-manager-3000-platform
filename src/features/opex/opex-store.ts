// ---------------------------------------------------------------------------
// OpEx Client-Side Store
//
// Wraps the opex-engine and provides cell-level subscriptions for
// useSyncExternalStore. Each cell component subscribes to only its own key,
// preventing 500 cell re-renders on every input change.
// ---------------------------------------------------------------------------

import { createOpExEngine } from '@/services/engines/opex-engine';
import type { CellDefinition, CellValue, EvaluationResult } from '@/services/engines/opex-engine';

export type { CellValue, EvaluationResult };

// Default KPI cell keys (cultivator template) — used as fallback for legacy models
const DEFAULT_KPI_KEYS = [
  'pnl.annual_revenue',
  'pnl.total_annual_cost',
  'pnl.cost_per_pound',
  'pnl.gross_margin_pct',
  'pnl.gross_profit',
  'pnl.taxable_profit',
] as const;

export class OpExStore {
  private engine = createOpExEngine();
  private cellSnapshots = new Map<string, CellValue>();
  private subscribers = new Map<string, Set<() => void>>();
  private kpiSubscribers = new Set<() => void>();
  private kpis: Record<string, number | null> = {};
  private initialized = false;
  private kpiKeys: string[] = [...DEFAULT_KPI_KEYS];

  // ---- Cell ID lookup (key -> cellId) for server mutations ----
  private cellIdMap = new Map<string, string>();

  /**
   * Initialize the store from server data (full model load).
   * Builds the DAG, evaluates all cells, and stores initial snapshots.
   *
   * @param cells - All cells from the model
   * @param kpiCells - KPI cell keys from the model (template-specific). Falls back to cultivator defaults.
   */
  initialize(
    cells: Array<{ id: string; key: string; cellType: string; formula: string | null; value: number | null }>,
    kpiCells?: string[],
  ): void {
    const cellDefs: CellDefinition[] = cells.map((c) => ({
      key: c.key,
      cellType: c.cellType as 'INPUT' | 'COMPUTED' | 'CONSTANT',
      formula: c.formula,
      value: c.value,
    }));

    // Build ID map
    this.cellIdMap.clear();
    for (const c of cells) {
      this.cellIdMap.set(c.key, c.id);
    }

    // Use model-specific KPI keys or fall back to cultivator defaults
    this.kpiKeys = kpiCells && kpiCells.length > 0 ? kpiCells : [...DEFAULT_KPI_KEYS];

    this.engine.buildGraph(cellDefs);
    this.engine.setKPICells(this.kpiKeys);

    const result = this.engine.evaluateAll();

    // Store all cell snapshots
    const allValues = this.engine.getAllValues();
    allValues.forEach((cv, key) => {
      this.cellSnapshots.set(key, cv);
    });

    this.kpis = result.kpis;
    this.initialized = true;

    // Notify all existing subscribers (in case of re-initialization)
    this.subscribers.forEach((subs) => {
      subs.forEach((cb) => cb());
    });
    this.kpiSubscribers.forEach((cb) => cb());
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the cell ID for a given key (for server mutations).
   */
  getCellId(key: string): string | undefined {
    return this.cellIdMap.get(key);
  }

  // ---- useSyncExternalStore: cell-level ----

  /**
   * Get snapshot for a single cell. Returns a stable reference if unchanged.
   */
  getCellSnapshot(key: string): CellValue {
    return this.cellSnapshots.get(key) ?? { key, value: null, error: '#REF' };
  }

  /**
   * Subscribe to a single cell's changes.
   * Returns unsubscribe function.
   */
  subscribeTo(key: string, callback: () => void): () => void {
    let subs = this.subscribers.get(key);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(key, subs);
    }
    subs.add(callback);
    return () => {
      subs!.delete(callback);
      if (subs!.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  // ---- useSyncExternalStore: KPI-level ----

  getKPISnapshot(): Record<string, number | null> {
    return this.kpis;
  }

  subscribeToKPIs(callback: () => void): () => void {
    this.kpiSubscribers.add(callback);
    return () => {
      this.kpiSubscribers.delete(callback);
    };
  }

  // ---- Mutations ----

  /**
   * Update a cell value locally. Triggers DAG recomputation and
   * selective subscriber notifications for only the affected cells.
   */
  updateValue(key: string, value: number): EvaluationResult {
    const result = this.engine.updateValue(key, value);

    // Update snapshots and notify only affected subscribers
    for (const cv of result.updatedCells) {
      const prev = this.cellSnapshots.get(cv.key);
      // Only update snapshot + notify if actually changed
      if (!prev || prev.value !== cv.value || prev.error !== cv.error) {
        this.cellSnapshots.set(cv.key, cv);
        const subs = this.subscribers.get(cv.key);
        if (subs) {
          subs.forEach((cb) => cb());
        }
      }
    }

    // Update KPIs
    const prevKpis = this.kpis;
    this.kpis = result.kpis;
    // Check if any KPI actually changed
    let kpiChanged = false;
    for (const k of this.kpiKeys) {
      if (prevKpis[k] !== result.kpis[k]) {
        kpiChanged = true;
        break;
      }
    }
    if (kpiChanged) {
      this.kpiSubscribers.forEach((cb) => cb());
    }

    return result;
  }

  /**
   * Get the active KPI cell keys (template-specific).
   */
  getKPIKeys(): string[] {
    return this.kpiKeys;
  }

  /**
   * Get all current cell values (for snapshot/save operations).
   */
  getAllValues(): Map<string, CellValue> {
    return this.engine.getAllValues();
  }
}
