import type { RuleCondition } from './rules-engine'
import type { DiscountActionParams } from './discount-scoring-engine'

export interface DefaultRule {
  name: string
  description: string
  category: string
  severity: string
  conditions: RuleCondition[]
  actionType: string
  actionParams?: DiscountActionParams
  metadata?: Record<string, unknown>
  stateCode?: string // Optional: only seed for facilities in this state (e.g., "CO", "MA")
}

export const DEFAULT_RULES: DefaultRule[] = [
  // --- Aging Rules (category-aware thresholds) ---
  // Plant material degrades fast — tighter thresholds
  {
    name: 'Aging Warning: Flower (45+ days)',
    description: 'Flower/buds package aged over 45 days — terpenes degrade quickly',
    category: 'aging',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 45 },
      { field: 'ItemCategory', operator: 'contains', value: 'Buds' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 45 },
  },
  {
    name: 'Aging Critical: Flower (90+ days)',
    description: 'Flower/buds package aged over 90 days — quality degradation likely',
    category: 'aging',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 90 },
      { field: 'ItemCategory', operator: 'contains', value: 'Buds' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 90 },
  },
  // Manufactured — longer shelf life
  {
    name: 'Aging Warning: Concentrates (180+ days)',
    description: 'Concentrate package aged over 6 months',
    category: 'aging',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 180 },
      { field: 'ItemCategory', operator: 'contains', value: 'Concentrate' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 180 },
  },
  {
    name: 'Aging Critical: Concentrates (365+ days)',
    description: 'Concentrate package aged over 1 year — approaching shelf life limit',
    category: 'aging',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 365 },
      { field: 'ItemCategory', operator: 'contains', value: 'Concentrate' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 365 },
  },
  {
    name: 'Aging Warning: Vape Products (180+ days)',
    description: 'Vape product aged over 6 months',
    category: 'aging',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 180 },
      { field: 'ItemCategory', operator: 'contains', value: 'Vape' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 180 },
  },
  {
    name: 'Aging Critical: Vape Products (365+ days)',
    description: 'Vape product aged over 1 year',
    category: 'aging',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 365 },
      { field: 'ItemCategory', operator: 'contains', value: 'Vape' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 365 },
  },
  {
    name: 'Aging Warning: Infused Products (120+ days)',
    description: 'Infused product aged over 4 months',
    category: 'aging',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 120 },
      { field: 'ItemCategory', operator: 'contains', value: 'Infused' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 120 },
  },
  {
    name: 'Aging Critical: Infused Products (270+ days)',
    description: 'Infused product aged over 9 months',
    category: 'aging',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 270 },
      { field: 'ItemCategory', operator: 'contains', value: 'Infused' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 270 },
  },
  // Default catch-all (excludes categories with specific rules above)
  {
    name: 'Aging Warning (90+ days)',
    description: 'Package has been in inventory for over 90 days',
    category: 'aging',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 90 },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Buds' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Concentrate' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Vape' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Infused' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 90 },
  },
  {
    name: 'Aging Critical (180+ days)',
    description: 'Package has been in inventory for over 6 months',
    category: 'aging',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 180 },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Buds' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Concentrate' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Vape' },
      { field: 'ItemCategory', operator: 'not_contains', value: 'Infused' },
    ],
    actionType: 'ALERT',
    metadata: { thresholdDays: 180 },
  },

  // --- Inventory Rules ---
  {
    name: 'Low Quantity Flower',
    description: 'Flower package quantity is critically low (under 10g)',
    category: 'inventory',
    severity: 'INFO',
    conditions: [
      { field: 'Quantity', operator: 'lt', value: 10, itemCategory: 'Flower' },
    ],
    actionType: 'ALERT',
  },
  {
    name: 'Zero Quantity Package',
    description: 'Package has zero or negative quantity and should be finished',
    category: 'inventory',
    severity: 'WARNING',
    conditions: [{ field: 'Quantity', operator: 'lte', value: 0 }],
    actionType: 'ALERT',
  },
  {
    name: 'Large Package Warning',
    description: 'Package has unusually large quantity (over 4000 units)',
    category: 'inventory',
    severity: 'INFO',
    conditions: [{ field: 'Quantity', operator: 'gt', value: 4000 }],
    actionType: 'ALERT',
  },

  // --- Compliance Rules ---
  {
    name: 'Package On Hold',
    description: 'Package is currently on administrative hold',
    category: 'compliance',
    severity: 'CRITICAL',
    conditions: [{ field: 'IsOnHold', operator: 'eq', value: true }],
    actionType: 'ALERT',
  },
  {
    name: 'Remediation Required',
    description: 'Package requires remediation and has not been processed',
    category: 'compliance',
    severity: 'CRITICAL',
    conditions: [{ field: 'ProductRequiresRemediation', operator: 'eq', value: true }],
    actionType: 'ALERT',
  },
  {
    name: 'Lab Testing Not Submitted',
    description: 'Package has not been submitted for lab testing',
    category: 'compliance',
    severity: 'WARNING',
    conditions: [
      { field: 'LabTestingState', operator: 'eq', value: 'NotSubmitted' },
      { field: 'ageDays', operator: 'gte', value: 14 },
    ],
    actionType: 'ALERT',
    metadata: { gracePeriodDays: 14 },
  },
  {
    name: 'Lab Test Failed',
    description: 'Package has failed lab testing and needs remediation or destruction',
    category: 'compliance',
    severity: 'CRITICAL',
    conditions: [{ field: 'LabTestingState', operator: 'eq', value: 'TestFailed' }],
    actionType: 'ALERT',
  },

  // --- Operations Rules ---
  {
    name: 'Slow Moving Inventory (45+ days)',
    description: 'Package has not moved in over 45 days - consider discount or promotion',
    category: 'operations',
    severity: 'INFO',
    conditions: [{ field: 'ageDays', operator: 'gte', value: 45 }],
    actionType: 'NOTIFICATION',
  },
  {
    name: 'Slow Moving Critical (90+ days)',
    description: 'Package has not moved in over 90 days - urgent action required',
    category: 'operations',
    severity: 'WARNING',
    conditions: [{ field: 'ageDays', operator: 'gte', value: 90 }],
    actionType: 'NOTIFICATION',
  },

  // --- Discount Rules ---
  {
    name: 'Discount: Critical Aging (90+ days)',
    description: 'Package aged 90+ days — recommend deep discount to move inventory',
    category: 'discount',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 90 },
      { field: 'Quantity', operator: 'gt', value: 0 },
    ],
    actionType: 'DISCOUNT_RECOMMEND',
    actionParams: { discountRange: { min: 30, max: 50 } },
    metadata: { actionParams: { discountRange: { min: 30, max: 50 } } },
  },
  {
    name: 'Discount: Aging Warning (60-89 days)',
    description: 'Package aged 60-89 days — moderate discount to accelerate sell-through',
    category: 'discount',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 60 },
      { field: 'ageDays', operator: 'lt', value: 90 },
    ],
    actionType: 'DISCOUNT_RECOMMEND',
    actionParams: { discountRange: { min: 15, max: 25 } },
    metadata: { actionParams: { discountRange: { min: 15, max: 25 } } },
  },
  {
    name: 'Sample Out: Small Qty Aging (45+ days)',
    description: 'Small quantity package aged 45+ days — use as trade/promo sample',
    category: 'discount',
    severity: 'INFO',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 45 },
      { field: 'Quantity', operator: 'lte', value: 10 },
      { field: 'Quantity', operator: 'gt', value: 0 },
    ],
    actionType: 'SAMPLE_OUT',
    actionParams: { suggestedAction: 'Use as trade/promo sample' },
    metadata: { actionParams: { suggestedAction: 'Use as trade/promo sample' } },
  },
  {
    name: 'Promo Flag: Excess Supply',
    description: 'Package aged 30+ days — safe for promotional pricing',
    category: 'discount',
    severity: 'INFO',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 30 },
      { field: 'Quantity', operator: 'gt', value: 0 },
    ],
    actionType: 'PROMO_FLAG',
    actionParams: { suggestedAction: 'Safe for promotions' },
    metadata: { actionParams: { suggestedAction: 'Safe for promotions' } },
  },
  {
    name: 'Consolidate: Fragmented Small Qty (30+ days)',
    description: 'Small quantity package aged 30+ days — consolidate with same-item packages',
    category: 'discount',
    severity: 'INFO',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 30 },
      { field: 'Quantity', operator: 'gt', value: 0 },
      { field: 'Quantity', operator: 'lt', value: 50 },
    ],
    actionType: 'CONSOLIDATE',
    actionParams: { suggestedAction: 'Consolidate fragmented packages' },
    metadata: { actionParams: { suggestedAction: 'Consolidate fragmented packages' } },
  },

  // --- State-Specific Rules ---
  {
    name: 'CO: Lab Testing Not Submitted (72h)',
    description: 'Colorado regulation: package not submitted for lab testing within 72 hours of creation',
    category: 'compliance',
    severity: 'CRITICAL',
    conditions: [
      { field: 'LabTestingState', operator: 'eq', value: 'NotSubmitted' },
      { field: 'ageDays', operator: 'gte', value: 3 },
    ],
    actionType: 'ALERT',
    stateCode: 'CO',
    metadata: { gracePeriodDays: 3 },
  },
  {
    name: 'MA: Test Expiry Warning (330+ days)',
    description: 'Massachusetts: lab test results approaching 365-day expiration (35 days remaining)',
    category: 'compliance',
    severity: 'WARNING',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 330 },
      { field: 'LabTestingState', operator: 'eq', value: 'TestPassed' },
    ],
    actionType: 'ALERT',
    stateCode: 'MA',
    metadata: { expirationDays: 365, warningDaysRemaining: 35 },
  },
  {
    name: 'MA: Test Expired (365+ days)',
    description: 'Massachusetts: lab test results have expired after 365 days — package cannot be sold',
    category: 'compliance',
    severity: 'CRITICAL',
    conditions: [
      { field: 'ageDays', operator: 'gte', value: 365 },
      { field: 'LabTestingState', operator: 'eq', value: 'TestPassed' },
    ],
    actionType: 'ALERT',
    stateCode: 'MA',
    metadata: { expirationDays: 365 },
  },
]
