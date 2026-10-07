/**
 * sales-reconciliation.ts — Match Dutchie POS sales to Metrc packages.
 *
 * Joins DutchieLineItem.MetrcPackageLabel to a target package label.
 * Confidence is 'exact' because the match is on the authoritative Metrc label
 * that Dutchie records at point of sale.
 */

import type { IDutchieClient } from '../dutchie/types'
import type { ProvenanceTree } from './provenance-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalesMatch {
  transactionId: string
  productName: string
  quantity: number
  totalPrice: number
  saleDate: string
  confidence: 'exact'
  // Enriched fields from DutchieDelivery + DutchieLineItem
  customerName: string | null
  customerType: string | null
  paymentMethod: string | null
  employeeName: string | null
  category: string
  brand: string | null
  strainName: string | null
  discountAmount: number
  unitPrice: number
}

export interface SalesAnalytics {
  totalRevenue: number
  totalTransactions: number
  totalUnitsSold: number
  avgPrice: number
  totalDiscount: number
  timeInSystem: {
    minDays: number | null
    maxDays: number | null
    avgDays: number | null
  }
  revenueByDescendant: {
    packageLabel: string
    revenue: number
    transactions: number
  }[]
}

/** Map of MetrcPackageLabel -> enriched sales matches */
export type SalesIndex = Map<string, SalesMatch[]>

// ---------------------------------------------------------------------------
// Batch Sales Index Builder
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50
const MAX_PAGES = 200 // Safety cap: 10,000 deliveries max

/**
 * Fetch ALL completed deliveries ONCE and build an O(1) lookup index
 * keyed by MetrcPackageLabel. Far more efficient than scanning per-package.
 */
export async function buildSalesIndex(
  dutchieClient: IDutchieClient,
  opts?: { fromDateUTC?: string; toDateUTC?: string },
): Promise<SalesIndex> {
  const index: SalesIndex = new Map()
  let page = 0

  while (page < MAX_PAGES) {
    const deliveries = await dutchieClient.getDeliveries({
      includeLineItems: true,
      deliveryStatus: 'Completed',
      pageNumber: page,
      pageSize: PAGE_SIZE,
      fromDateUTC: opts?.fromDateUTC,
      toDateUTC: opts?.toDateUTC,
    })

    if (deliveries.length === 0) break

    for (const delivery of deliveries) {
      if (!delivery.LineItems) continue
      for (const li of delivery.LineItems) {
        if (!li.MetrcPackageLabel) continue

        const match: SalesMatch = {
          transactionId: delivery.TransactionId,
          productName: li.ProductName,
          quantity: li.Quantity,
          totalPrice: li.TotalPrice,
          saleDate: delivery.CompletedDate ?? delivery.CreatedDate,
          confidence: 'exact',
          customerName: delivery.CustomerName,
          customerType: delivery.CustomerType,
          paymentMethod: delivery.PaymentMethod,
          employeeName: delivery.EmployeeName,
          category: li.Category,
          brand: li.Brand,
          strainName: li.StrainName,
          discountAmount: li.DiscountAmount,
          unitPrice: li.Price,
        }

        const existing = index.get(li.MetrcPackageLabel)
        if (existing) {
          existing.push(match)
        } else {
          index.set(li.MetrcPackageLabel, [match])
        }
      }
    }

    if (deliveries.length < PAGE_SIZE) break
    page++
  }

  return index
}

// ---------------------------------------------------------------------------
// Sales Analytics
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/**
 * Compute revenue attribution and time-in-system analytics across a provenance tree.
 * Sums sales for the target package + all downstream descendants.
 */
export function computeSalesAnalytics(
  salesIndex: SalesIndex,
  provenanceTree: ProvenanceTree,
): SalesAnalytics {
  // Collect all labels: target + downstream
  const targetLabel = provenanceTree.targetLabel
  const downstreamLabels = provenanceTree.downstream.map((n) => n.label)
  const allLabels = [targetLabel, ...downstreamLabels]

  let totalRevenue = 0
  let totalTransactions = 0
  let totalUnitsSold = 0
  let totalDiscount = 0
  const revenueByDescendant: SalesAnalytics['revenueByDescendant'] = []
  const saleDates: number[] = []

  for (const label of allLabels) {
    const sales = salesIndex.get(label) ?? []
    let labelRevenue = 0
    let labelTxCount = 0

    for (const s of sales) {
      totalRevenue += s.totalPrice
      totalUnitsSold += s.quantity
      totalDiscount += s.discountAmount
      labelRevenue += s.totalPrice
      labelTxCount++

      const saleTs = new Date(s.saleDate).getTime()
      if (!isNaN(saleTs)) saleDates.push(saleTs)
    }

    totalTransactions += labelTxCount

    if (labelTxCount > 0) {
      revenueByDescendant.push({
        packageLabel: label,
        revenue: labelRevenue,
        transactions: labelTxCount,
      })
    }
  }

  // Time-in-system: earliest harvest date -> each sale date
  let earliestHarvestTs: number | null = null
  for (const node of provenanceTree.nodes) {
    if (node.type === 'harvest' && node.harvestStartDate) {
      const ts = new Date(node.harvestStartDate).getTime()
      if (!isNaN(ts) && (earliestHarvestTs === null || ts < earliestHarvestTs)) {
        earliestHarvestTs = ts
      }
    }
  }

  let timeInSystem: SalesAnalytics['timeInSystem'] = {
    minDays: null,
    maxDays: null,
    avgDays: null,
  }

  if (earliestHarvestTs !== null && saleDates.length > 0) {
    let minDays = Infinity
    let maxDays = -Infinity
    let totalDays = 0
    let count = 0

    for (const sd of saleDates) {
      const d = Math.floor((sd - earliestHarvestTs) / MS_PER_DAY)
      if (d >= 0) {
        if (d < minDays) minDays = d
        if (d > maxDays) maxDays = d
        totalDays += d
        count++
      }
    }

    if (count > 0) {
      timeInSystem = {
        minDays,
        maxDays,
        avgDays: Math.round(totalDays / count),
      }
    }
  }

  return {
    totalRevenue,
    totalTransactions,
    totalUnitsSold,
    avgPrice: totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0,
    totalDiscount,
    timeInSystem,
    revenueByDescendant,
  }
}
