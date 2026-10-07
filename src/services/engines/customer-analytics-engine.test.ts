import { describe, it, expect } from 'vitest'
import { computeCustomerAnalytics } from './customer-analytics-engine'
import type { CanixCustomer, CanixSalesOrder } from '../canix/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCustomer(overrides: Partial<CanixCustomer> = {}): CanixCustomer {
  return {
    id: 'cust-1',
    name: 'Green Leaf Dispensary',
    licenseNumber: 'LIC-001',
    contactEmail: null,
    contactPhone: null,
    address: null,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

/**
 * Build a sales order with a createdAt relative to now.
 * daysAgo: positive number → in the past
 */
function makeSalesOrder(daysAgo: number, overrides: Partial<CanixSalesOrder> = {}): CanixSalesOrder {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return {
    id: `so-${daysAgo}`,
    orderNumber: `ORD-${daysAgo}`,
    customerId: 'cust-1',
    customerName: 'Green Leaf Dispensary',
    status: 'confirmed',
    subtotal: 1000,
    taxAmount: 0,
    total: 1000,
    createdAt: d.toISOString(),
    updatedAt: d.toISOString(),
    shippedAt: null,
    deliveredAt: null,
    lineItemCount: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Grouping by customer
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — grouping', () => {
  it('should group orders by customer', () => {
    const customers = [
      makeCustomer({ id: 'c1', name: 'Customer A' }),
      makeCustomer({ id: 'c2', name: 'Customer B' }),
    ]
    const orders = [
      makeSalesOrder(5, { id: 'so-1', customerId: 'c1', customerName: 'Customer A', total: 500 }),
      makeSalesOrder(3, { id: 'so-2', customerId: 'c1', customerName: 'Customer A', total: 300 }),
      makeSalesOrder(10, { id: 'so-3', customerId: 'c2', customerName: 'Customer B', total: 700 }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers).toHaveLength(2)
    const custA = result.customers.find(c => c.customerId === 'c1')
    expect(custA?.totalOrders).toBe(2)
    expect(custA?.totalRevenue).toBe(800)
  })
})

// ---------------------------------------------------------------------------
// Revenue and average order value
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — revenue', () => {
  it('should compute total revenue and average order value', () => {
    const customers = [makeCustomer()]
    const orders = [
      makeSalesOrder(2, { id: 'so-a', total: 1000 }),
      makeSalesOrder(5, { id: 'so-b', total: 600 }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.totalRevenue).toBe(1600)
    expect(result.customers[0]?.avgOrderValue).toBe(800)
    expect(result.totalRevenue).toBe(1600)
  })

  it('should aggregate total revenue across all customers', () => {
    const customers = [
      makeCustomer({ id: 'c1', name: 'A' }),
      makeCustomer({ id: 'c2', name: 'B' }),
    ]
    const orders = [
      makeSalesOrder(1, { id: 'so-1', customerId: 'c1', customerName: 'A', total: 1000 }),
      makeSalesOrder(1, { id: 'so-2', customerId: 'c2', customerName: 'B', total: 2000 }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.totalRevenue).toBe(3000)
  })
})

// ---------------------------------------------------------------------------
// Order frequency
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — order frequency', () => {
  it('should compute frequency as average days between orders', () => {
    const customers = [makeCustomer()]
    // Two orders: 20 and 0 days ago — span is 20 days, 1 interval
    const orders = [
      makeSalesOrder(20, { id: 'so-old', total: 500 }),
      makeSalesOrder(0, { id: 'so-recent', total: 500 }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    // 20 days between 2 orders = frequency of 20 days
    expect(result.customers[0]?.orderFrequencyDays).toBeCloseTo(20, 0)
  })

  it('should return 0 orderFrequencyDays for customers with only 1 order', () => {
    const customers = [makeCustomer()]
    const orders = [makeSalesOrder(5, { id: 'so-only' })]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.orderFrequencyDays).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — status classification', () => {
  it('should classify customer as active when last order was <30 days ago', () => {
    const customers = [makeCustomer()]
    const orders = [makeSalesOrder(10)]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.status).toBe('active')
  })

  it('should classify customer as at_risk when last order was 30-90 days ago', () => {
    const customers = [makeCustomer()]
    const orders = [makeSalesOrder(45)]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.status).toBe('at_risk')
  })

  it('should classify customer as churned when last order was >90 days ago', () => {
    const customers = [makeCustomer()]
    const orders = [makeSalesOrder(100)]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.status).toBe('churned')
  })

  it('should correctly count atRiskCount in the result', () => {
    const customers = [
      makeCustomer({ id: 'c1', name: 'Active' }),
      makeCustomer({ id: 'c2', name: 'AtRisk' }),
      makeCustomer({ id: 'c3', name: 'Churned' }),
    ]
    const orders = [
      makeSalesOrder(5, { id: 'so-1', customerId: 'c1', customerName: 'Active' }),
      makeSalesOrder(60, { id: 'so-2', customerId: 'c2', customerName: 'AtRisk' }),
      makeSalesOrder(120, { id: 'so-3', customerId: 'c3', customerName: 'Churned' }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.atRiskCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Cancelled and draft order filtering
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — order filtering', () => {
  it('should exclude cancelled orders from metrics', () => {
    const customers = [makeCustomer()]
    const orders = [
      makeSalesOrder(5, { id: 'so-good', total: 1000, status: 'confirmed' }),
      makeSalesOrder(3, { id: 'so-cancelled', total: 9999, status: 'cancelled' }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.totalRevenue).toBe(1000)
    expect(result.customers[0]?.totalOrders).toBe(1)
  })

  it('should exclude draft orders from metrics', () => {
    const customers = [makeCustomer()]
    const orders = [
      makeSalesOrder(5, { id: 'so-good', total: 500, status: 'delivered' }),
      makeSalesOrder(2, { id: 'so-draft', total: 9999, status: 'draft' }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.totalRevenue).toBe(500)
  })

  it('should exclude submitted orders from metrics', () => {
    const customers = [makeCustomer()]
    const orders = [
      makeSalesOrder(1, { id: 'so-submitted', total: 9999, status: 'submitted' }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    // 'submitted' is not in ACTIVE_ORDER_STATUSES — customer should not appear
    expect(result.customers).toHaveLength(0)
  })

  it('should include confirmed, processing, shipped, delivered, and invoiced orders', () => {
    const customers = [makeCustomer()]
    const statuses: CanixSalesOrder['status'][] = ['confirmed', 'processing', 'shipped', 'delivered', 'invoiced']
    const orders = statuses.map((status, i) =>
      makeSalesOrder(i + 1, { id: `so-${i}`, total: 100, status }),
    )

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.totalOrders).toBe(5)
    expect(result.customers[0]?.totalRevenue).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — empty inputs', () => {
  it('should return empty result for empty inputs', () => {
    const result = computeCustomerAnalytics([], [])

    expect(result.customers).toHaveLength(0)
    expect(result.totalRevenue).toBe(0)
    expect(result.atRiskCount).toBe(0)
  })

  it('should handle customers with no active orders (no entries produced)', () => {
    const customers = [makeCustomer()]
    const orders = [makeSalesOrder(5, { status: 'cancelled' })]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Sorting by revenue descending
// ---------------------------------------------------------------------------

describe('computeCustomerAnalytics — sorting', () => {
  it('should sort customers by total revenue descending', () => {
    const customers = [
      makeCustomer({ id: 'c1', name: 'Small Customer' }),
      makeCustomer({ id: 'c2', name: 'Big Customer' }),
    ]
    const orders = [
      makeSalesOrder(5, { id: 'so-1', customerId: 'c1', customerName: 'Small Customer', total: 100 }),
      makeSalesOrder(5, { id: 'so-2', customerId: 'c2', customerName: 'Big Customer', total: 9000 }),
    ]

    const result = computeCustomerAnalytics(customers, orders)

    expect(result.customers[0]?.customerId).toBe('c2')
    expect(result.customers[1]?.customerId).toBe('c1')
  })
})
