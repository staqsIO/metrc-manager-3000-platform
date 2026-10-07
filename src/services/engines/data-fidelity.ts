/**
 * Data Fidelity Engine
 *
 * Computes a facility's data availability profile — which data layers
 * are connected and what level of analytical enrichment is possible.
 *
 * Used by UI components (`<ProgressiveMetric>`, `<EnrichmentPrompt>`) and
 * the Copilot (`ToolExecutorContext.dataFidelity`) to adapt rendering
 * and responses based on what data sources are available.
 *
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { CostSource } from './cogs-engine';

// ============================================================
// Types
// ============================================================

export type LayerStatus = 'connected' | 'mock' | 'none';

export interface DataFidelityProfile {
  /** Metrc track-and-trace — always connected or mock (required for platform access) */
  metrc: 'connected' | 'mock';
  /** Dutchie POS — provides sales velocity, revenue, customer data */
  dutchie: LayerStatus;
  /** Canix ERP — provides authoritative COGS, BOMs, purchase orders */
  canix: LayerStatus;
  /** Whether operator has entered manual financial models (OpExModel records) */
  hasOpexModels: boolean;
  /** Whether supply chain items exist (Non-Metrc Inventory) */
  hasSupplyItems: boolean;

  // ── Computed convenience flags ──────────────────────────────
  /** Any cost source is available (canix, dutchie, or manual OpEx) */
  hasFinancialData: boolean;
  /** Authoritative COGS available (Canix connected) */
  hasCostData: boolean;
  /** POS sales velocity available (Dutchie connected) */
  hasSalesVelocity: boolean;
  /** Revenue data available (Dutchie or OpEx models) */
  hasRevenueData: boolean;
  /** Highest-confidence cost source available for this facility */
  costConfidenceTier: CostSource;
}

/** Minimal facility fields needed to compute fidelity (avoids importing full Prisma type) */
export interface FacilityForFidelity {
  metrcEnvironment: string;
  dutchieEnvironment?: string | null;
  canixEnvironment?: string | null;
}

// ============================================================
// Core computation
// ============================================================

function toLayerStatus(env: string | null | undefined): LayerStatus {
  if (!env || env === 'none') return 'none';
  if (env === 'production') return 'connected';
  if (env === 'sandbox' || env === 'mock') return 'mock';
  return 'none';
}

function toMetrcStatus(env: string): 'connected' | 'mock' {
  return env === 'production' || env === 'sandbox' ? 'connected' : 'mock';
}

/**
 * Resolve the highest-confidence cost source available.
 * Follows the COGS waterfall priority from cogs-engine.ts.
 */
function resolveHighestCostSource(
  canix: LayerStatus,
  dutchie: LayerStatus,
  hasOpex: boolean,
): CostSource {
  if (canix === 'connected') return 'canix_purchase';
  if (canix === 'mock') return 'canix_standard';
  if (dutchie === 'connected') return 'dutchie';
  if (dutchie === 'mock') return 'dutchie_inferred';
  if (hasOpex) return 'manual';
  return 'none';
}

/**
 * Compute the data fidelity profile for a facility.
 *
 * @param facility - Minimal facility record with environment fields
 * @param hasOpexModels - Whether the facility has any OpExModel records (count > 0)
 * @param hasSupplyItems - Whether the facility has any SupplyItem records (count > 0)
 */
export function computeDataFidelity(
  facility: FacilityForFidelity,
  hasOpexModels: boolean = false,
  hasSupplyItems: boolean = false,
): DataFidelityProfile {
  const metrc = toMetrcStatus(facility.metrcEnvironment);
  const dutchie = toLayerStatus(facility.dutchieEnvironment);
  const canix = toLayerStatus(facility.canixEnvironment);
  const costConfidenceTier = resolveHighestCostSource(canix, dutchie, hasOpexModels);

  return {
    metrc,
    dutchie,
    canix,
    hasOpexModels,
    hasSupplyItems,

    hasFinancialData: canix !== 'none' || dutchie !== 'none' || hasOpexModels,
    hasCostData: canix !== 'none',
    hasSalesVelocity: dutchie !== 'none',
    hasRevenueData: dutchie !== 'none' || hasOpexModels,
    costConfidenceTier,
  };
}

// ============================================================
// Helpers for UI / Copilot
// ============================================================

/** Human-readable label for the highest available cost source */
export function getCostSourceLabel(source: CostSource): string {
  switch (source) {
    case 'canix_purchase': return 'ERP (Purchase Order)';
    case 'canix_bom': return 'ERP (BOM)';
    case 'canix_standard': return 'ERP (Standard Cost)';
    case 'dutchie': return 'POS';
    case 'dutchie_inferred': return 'POS (Estimated)';
    case 'manual': return 'Manual';
    case 'none': return 'No cost data';
  }
}

/** Short label for source badges */
export function getCostSourceBadgeLabel(source: CostSource): string {
  switch (source) {
    case 'canix_purchase':
    case 'canix_bom':
    case 'canix_standard': return 'ERP';
    case 'dutchie': return 'POS';
    case 'dutchie_inferred': return 'Est.';
    case 'manual': return 'Manual';
    case 'none': return '—';
  }
}

/**
 * Suggest which integration to connect to unlock a specific data layer.
 * Returns null if the layer is already available.
 */
export function suggestIntegration(
  profile: DataFidelityProfile,
  desiredCapability: 'cost' | 'velocity' | 'revenue' | 'supply',
): { integration: 'canix' | 'dutchie' | 'opex' | 'supply'; label: string } | null {
  switch (desiredCapability) {
    case 'cost':
      if (profile.hasCostData) return null;
      return { integration: 'canix', label: 'Connect Canix ERP to see authoritative cost data' };
    case 'velocity':
      if (profile.hasSalesVelocity) return null;
      return { integration: 'dutchie', label: 'Connect Dutchie POS to see sales velocity' };
    case 'revenue':
      if (profile.hasRevenueData) return null;
      return { integration: 'dutchie', label: 'Connect Dutchie POS to see revenue data' };
    case 'supply':
      if (profile.hasSupplyItems) return null;
      return { integration: 'supply', label: 'Add supply items to track packaging and materials' };
  }
}

/**
 * Generate a fidelity-aware context block for the Copilot system prompt.
 */
export function buildFidelityPromptBlock(profile: DataFidelityProfile): string {
  const lines: string[] = ['Available data sources for this facility:'];

  lines.push(`- Metrc: ${profile.metrc} (authoritative inventory and compliance)`);

  if (profile.dutchie === 'connected') {
    lines.push('- Dutchie POS: connected — sales velocity, revenue, and customer data available');
  } else if (profile.dutchie === 'mock') {
    lines.push('- Dutchie POS: mock mode — sample sales data for demonstration');
  } else {
    lines.push('- Dutchie POS: not connected — use Metrc transfer data as velocity proxy');
  }

  if (profile.canix === 'connected') {
    lines.push('- Canix ERP: connected — authoritative COGS, BOMs, and purchase orders available');
  } else if (profile.canix === 'mock') {
    lines.push('- Canix ERP: mock mode — sample cost data for demonstration');
  } else {
    lines.push('- Canix ERP: not connected — use inferred or manual costs when available');
  }

  if (profile.hasOpexModels) {
    lines.push('- OpEx models: available — manual financial entries for cost estimation');
  }

  lines.push('');
  lines.push(
    'When the user asks about dollar values and no cost source is available, ' +
    'provide operational metrics (weights, counts, percentages, days) and note ' +
    'that connecting the relevant integration would add dollar values. ' +
    'Never show empty states for missing financial data — the operational answer is the primary answer.'
  );

  return lines.join('\n');
}
