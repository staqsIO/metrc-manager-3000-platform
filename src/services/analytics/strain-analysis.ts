import type { MetrcPackage, MetrcLabTest } from '@/services/metrc/types'
import { calculateAgeDays } from '@/services/metrc/types'

// --- Types ---

export interface StrainPerformance {
  strainName: string
  packageCount: number
  totalQuantity: number
  unitOfMeasure: string
  averageQuantity: number
  averageAgeDays: number
  categories: string[]
  labTestCount: number
  labTestPassRate: number // 0-1
  avgTestResultLevel: number
  locations: string[]
  onHoldCount: number
  remediationCount: number
}

export interface StrainComparison {
  strains: StrainPerformance[]
  totalStrains: number
  topByQuantity: { strainName: string; totalQuantity: number }[]
  topByPassRate: { strainName: string; passRate: number; testCount: number }[]
  topByPackageCount: { strainName: string; count: number }[]
}

// --- Helpers ---

function buildLabTestIndex(labTests: MetrcLabTest[]): Map<string, MetrcLabTest[]> {
  const index = new Map<string, MetrcLabTest[]>()

  for (const test of labTests) {
    const existing = index.get(test.PackageLabel) ?? []
    existing.push(test)
    index.set(test.PackageLabel, existing)
  }

  return index
}

function computeStrainPerformance(
  strainName: string,
  packages: MetrcPackage[],
  labTestIndex: Map<string, MetrcLabTest[]>,
): StrainPerformance {
  let totalQuantity = 0
  let totalAgeDays = 0
  let onHoldCount = 0
  let remediationCount = 0
  const categorySet = new Set<string>()
  const locationSet = new Set<string>()
  let unitOfMeasure = ''

  // Collect all lab tests associated with this strain's packages
  const strainLabTests: MetrcLabTest[] = []

  for (const pkg of packages) {
    totalQuantity += pkg.Quantity
    totalAgeDays += calculateAgeDays(pkg.PackagedDate)

    if (!unitOfMeasure && pkg.UnitOfMeasureName) {
      unitOfMeasure = pkg.UnitOfMeasureName
    }

    if (pkg.ItemCategory) {
      categorySet.add(pkg.ItemCategory)
    }

    if (pkg.LocationName) {
      locationSet.add(pkg.LocationName)
    }

    if (pkg.IsOnHold) {
      onHoldCount++
    }

    if (pkg.ProductRequiresRemediation || pkg.ContainsRemediatedProduct) {
      remediationCount++
    }

    // Cross-reference lab tests by package label
    const testsForPackage = labTestIndex.get(pkg.Label)
    if (testsForPackage) {
      for (const test of testsForPackage) {
        strainLabTests.push(test)
      }
    }
  }

  const packageCount = packages.length
  const averageQuantity = packageCount > 0
    ? Math.round((totalQuantity / packageCount) * 100) / 100
    : 0
  const averageAgeDays = packageCount > 0
    ? Math.round(totalAgeDays / packageCount)
    : 0

  // Compute lab test metrics
  const labTestCount = strainLabTests.length
  let labTestPassRate = 0
  let avgTestResultLevel = 0

  if (labTestCount > 0) {
    const passedCount = strainLabTests.filter(t => t.OverallPassed).length
    labTestPassRate = Math.round((passedCount / labTestCount) * 1000) / 1000

    const totalResultLevel = strainLabTests.reduce(
      (sum, t) => sum + t.TestResultLevel, 0,
    )
    avgTestResultLevel = Math.round((totalResultLevel / labTestCount) * 100) / 100
  }

  return {
    strainName,
    packageCount,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    unitOfMeasure,
    averageQuantity,
    averageAgeDays,
    categories: Array.from(categorySet),
    labTestCount,
    labTestPassRate,
    avgTestResultLevel,
    locations: Array.from(locationSet),
    onHoldCount,
    remediationCount,
  }
}

// --- Main Analysis ---

export function analyzeStrainPerformance(
  packages: MetrcPackage[],
  labTests: MetrcLabTest[],
): StrainComparison {
  // Group packages by strain name
  const strainGroups = new Map<string, MetrcPackage[]>()

  for (const pkg of packages) {
    const strain = pkg.ItemStrainName
    if (!strain) continue

    const group = strainGroups.get(strain) ?? []
    group.push(pkg)
    strainGroups.set(strain, group)
  }

  // Build lab test index once for efficient lookups
  const labTestIndex = buildLabTestIndex(labTests)

  // Compute performance for each strain
  const strains: StrainPerformance[] = []

  for (const [strainName, strainPackages] of Array.from(strainGroups.entries())) {
    strains.push(computeStrainPerformance(strainName, strainPackages, labTestIndex))
  }

  // Sort strains alphabetically by default
  strains.sort((a, b) => a.strainName.localeCompare(b.strainName))

  // Top 5 by total quantity
  const topByQuantity = Array.from(strains)
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 5)
    .map(s => ({ strainName: s.strainName, totalQuantity: s.totalQuantity }))

  // Top 5 by pass rate (require minimum 2 test results)
  const topByPassRate = Array.from(strains)
    .filter(s => s.labTestCount >= 2)
    .sort((a, b) => b.labTestPassRate - a.labTestPassRate)
    .slice(0, 5)
    .map(s => ({
      strainName: s.strainName,
      passRate: s.labTestPassRate,
      testCount: s.labTestCount,
    }))

  // Top 5 by package count
  const topByPackageCount = Array.from(strains)
    .sort((a, b) => b.packageCount - a.packageCount)
    .slice(0, 5)
    .map(s => ({ strainName: s.strainName, count: s.packageCount }))

  return {
    strains,
    totalStrains: strains.length,
    topByQuantity,
    topByPassRate,
    topByPackageCount,
  }
}
