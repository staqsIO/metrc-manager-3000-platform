import type { MetrcPackage } from '@/services/metrc/types'
import { calculateAgeDays, getAgeCategory } from '@/services/metrc/types'

// --- Rule DSL Types ---

export type RuleOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'contains' | 'not_contains' | 'in' | 'not_in'

export interface RuleCondition {
  field: string
  operator: RuleOperator
  value: string | number | boolean | string[]
  itemCategory?: string // optional: only apply to specific category
}

export interface RuleDefinition {
  id: string
  name: string
  description?: string
  category: string
  severity: string
  isActive: boolean
  conditions: RuleCondition[]
  actionType: string
  metadata?: Record<string, unknown>
}

export interface RuleViolation {
  ruleId: string
  ruleName: string
  category: string
  severity: string
  title: string
  description: string
  packageLabel?: string
  plantLabel?: string
  actionType?: string
  actionParams?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// --- Condition Evaluator ---

function getFieldValue(pkg: MetrcPackage & { ageDays: number; ageCategory: string }, field: string): unknown {
  switch (field) {
    case 'ageDays': return pkg.ageDays
    case 'ageCategory': return pkg.ageCategory
    case 'Quantity': return pkg.Quantity
    case 'ItemCategory': return pkg.ItemCategory
    case 'ItemName': return pkg.ItemName
    case 'ItemStrainName': return pkg.ItemStrainName
    case 'LabTestingState': return pkg.LabTestingState
    case 'IsOnHold': return pkg.IsOnHold
    case 'IsTestingSample': return pkg.IsTestingSample
    case 'IsTradesSample': return pkg.IsTradesSample
    case 'ProductRequiresRemediation': return pkg.ProductRequiresRemediation
    case 'LocationName': return pkg.LocationName
    case 'PackageType': return pkg.PackageType
    case 'PackagedDate': return pkg.PackagedDate
    case 'UnitOfMeasureName': return pkg.UnitOfMeasureName
    default: return undefined
  }
}

function evaluateCondition(value: unknown, operator: RuleOperator, target: string | number | boolean | string[]): boolean {
  if (value === undefined || value === null) return false

  switch (operator) {
    case 'gt': return typeof value === 'number' && value > (target as number)
    case 'lt': return typeof value === 'number' && value < (target as number)
    case 'gte': return typeof value === 'number' && value >= (target as number)
    case 'lte': return typeof value === 'number' && value <= (target as number)
    case 'eq': return value === target
    case 'neq': return value !== target
    case 'contains': return typeof value === 'string' && value.toLowerCase().includes(String(target).toLowerCase())
    case 'not_contains': return typeof value === 'string' && !value.toLowerCase().includes(String(target).toLowerCase())
    case 'in': return Array.isArray(target) && target.includes(String(value))
    case 'not_in': return Array.isArray(target) && !target.includes(String(value))
    default: return false
  }
}

// --- Rules Engine ---

export function evaluateRulesAgainstPackages(
  rules: RuleDefinition[],
  packages: MetrcPackage[]
): RuleViolation[] {
  const violations: RuleViolation[] = []
  const activeRules = rules.filter(r => r.isActive)

  for (const pkg of packages) {
    const ageDays = calculateAgeDays(pkg.PackagedDate)
    const enrichedPkg = { ...pkg, ageDays, ageCategory: getAgeCategory(ageDays) }

    for (const rule of activeRules) {
      const conditions = rule.conditions as RuleCondition[]
      if (!conditions || conditions.length === 0) continue

      // Check category filter first
      const hasCategory = conditions.some(c => c.itemCategory)
      if (hasCategory) {
        const categoryMatch = conditions.some(
          c => !c.itemCategory || c.itemCategory === pkg.ItemCategory
        )
        if (!categoryMatch) continue
      }

      // All conditions must match (AND logic)
      const allMatch = conditions.every(c => {
        if (c.itemCategory && c.itemCategory !== pkg.ItemCategory) return true // skip category-filtered conditions that don't match
        const fieldValue = getFieldValue(enrichedPkg, c.field)
        return evaluateCondition(fieldValue, c.operator, c.value)
      })

      if (allMatch) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          title: buildAlertTitle(rule, enrichedPkg),
          description: buildAlertDescription(rule, enrichedPkg),
          packageLabel: pkg.Label,
          actionType: rule.actionType,
          actionParams: rule.metadata?.actionParams as Record<string, unknown> | undefined,
          metadata: {
            ageDays,
            quantity: pkg.Quantity,
            itemCategory: pkg.ItemCategory,
            itemName: pkg.ItemName,
            ...rule.metadata,
          },
        })
      }
    }
  }

  return violations
}

function buildAlertTitle(rule: RuleDefinition, pkg: MetrcPackage & { ageDays: number }): string {
  switch (rule.category) {
    case 'aging':
      return `${rule.severity === 'CRITICAL' ? 'Critical' : 'Warning'}: ${pkg.ItemName} aged ${pkg.ageDays} days`
    case 'inventory':
      return `${rule.name}: ${pkg.ItemName}`
    case 'compliance':
      return `Compliance: ${rule.name} - ${pkg.Label}`
    default:
      return `${rule.name}: ${pkg.ItemName} (${pkg.Label})`
  }
}

function buildAlertDescription(rule: RuleDefinition, pkg: MetrcPackage & { ageDays: number }): string {
  const desc = rule.description || rule.name
  return `${desc}. Package: ${pkg.Label}, Item: ${pkg.ItemName}, Qty: ${pkg.Quantity} ${pkg.UnitOfMeasureName}, Age: ${pkg.ageDays} days, Location: ${pkg.LocationName}`
}
