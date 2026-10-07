import { describe, it, expect } from 'vitest'
import { computeVendorAnalytics } from './vendor-analytics-engine'
import type { CanixVendor, CanixPurchaseOrder, CanixLineItem, CanixItem } from '../canix/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVendor(overrides: Partial<CanixVendor> = {}): CanixVendor {
  return {
    id: 'vendor-1',
    name: 'Green Supplies Co',
    licenseNumber: 'LIC-001',
    contactEmail: 'contact@greensupplies.com',
    contactPhone: null,
    address: null,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

function makePO(overrides: Partial<CanixPurchaseOrder> = {}): CanixPurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'PO-001',
    vendorId: 'vendor-1',
    vendorName: 'Green Supplies Co',
    status: 'received',
    subtotal: 1000,
    taxAmount: 0,
    total: 1000,
    expectedDeliveryDate: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-05',
    receivedAt: '2026-01-08',
    lineItemCount: 2,
    ...overrides,
  }
}

function makeLineItem(overrides: Partial<CanixLineItem> = {}): CanixLineItem {
  return {
    id: 'li-1',
    itemId: 'item-1',
    itemName: 'Trim',
    metrcPackageLabel: null,
    quantity: 100,
    unit: 'g',
    unitPrice: 5.0,
    totalPrice: 500,
    discount: 0,
    ...overrides,
  }
}

function makeItem(overrides: Partial<CanixItem> = {}): CanixItem {
  return {
    id: 'item-1',
    name: 'Trim',
    category: 'Cannabis',
    metrcItemId: null,
    unit: 'g',
    standardCost: 5.0,
    lastPurchasePrice: 5.0,
    isActive: true,
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Grouping by vendor
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — grouping', () => {
  it('should group POs by vendor correctly', () => {
    const vendors = [
      makeVendor({ id: 'v1', name: 'Vendor A' }),
      makeVendor({ id: 'v2', name: 'Vendor B' }),
    ]
    const pos = [
      makePO({ id: 'po-1', vendorId: 'v1', total: 1000, createdAt: '2026-01-01', receivedAt: null }),
      makePO({ id: 'po-2', vendorId: 'v1', total: 500, createdAt: '2026-01-02', receivedAt: null }),
      makePO({ id: 'po-3', vendorId: 'v2', total: 2000, createdAt: '2026-01-01', receivedAt: null }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.vendors).toHaveLength(2)
    const vendorA = result.vendors.find(v => v.vendorId === 'v1')
    const vendorB = result.vendors.find(v => v.vendorId === 'v2')
    expect(vendorA?.totalPOs).toBe(2)
    expect(vendorB?.totalPOs).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Total spend and average order value
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — spend metrics', () => {
  it('should compute total spend and average order value correctly', () => {
    const vendors = [makeVendor()]
    const pos = [
      makePO({ id: 'po-1', vendorId: 'vendor-1', total: 1000, receivedAt: null }),
      makePO({ id: 'po-2', vendorId: 'vendor-1', total: 600, receivedAt: null }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    const vendor = result.vendors[0]!
    expect(vendor.totalSpend).toBe(1600)
    expect(vendor.avgOrderValue).toBe(800)
    expect(result.totalSpend).toBe(1600)
  })

  it('should aggregate total spend across all vendors', () => {
    const vendors = [
      makeVendor({ id: 'v1', name: 'Vendor A' }),
      makeVendor({ id: 'v2', name: 'Vendor B' }),
    ]
    const pos = [
      makePO({ id: 'po-1', vendorId: 'v1', total: 1000, receivedAt: null }),
      makePO({ id: 'po-2', vendorId: 'v2', total: 2000, receivedAt: null }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.totalSpend).toBe(3000)
  })
})

// ---------------------------------------------------------------------------
// Average lead time
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — lead time', () => {
  it('should compute average lead time from createdAt to receivedAt', () => {
    const vendors = [makeVendor()]
    const pos = [
      makePO({
        id: 'po-1',
        vendorId: 'vendor-1',
        createdAt: '2026-01-01',
        receivedAt: '2026-01-08', // 7 days
        total: 1000,
      }),
      makePO({
        id: 'po-2',
        vendorId: 'vendor-1',
        createdAt: '2026-01-10',
        receivedAt: '2026-01-13', // 3 days
        total: 500,
      }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    // Average: (7 + 3) / 2 = 5 days
    expect(result.vendors[0]?.avgLeadTimeDays).toBe(5)
  })

  it('should return 0 avgLeadTimeDays when no POs have received dates', () => {
    const vendors = [makeVendor()]
    const pos = [makePO({ vendorId: 'vendor-1', receivedAt: null, total: 1000 })]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.vendors[0]?.avgLeadTimeDays).toBe(0)
  })

  it('should exclude POs where received date is before created date', () => {
    const vendors = [makeVendor()]
    const pos = [
      makePO({
        id: 'po-weird',
        vendorId: 'vendor-1',
        createdAt: '2026-01-10',
        receivedAt: '2026-01-05', // received before created — ignore
        total: 500,
      }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.vendors[0]?.avgLeadTimeDays).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Category breakdown
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — category breakdown', () => {
  it('should compute category spend from line items', () => {
    const vendors = [makeVendor()]
    const po = makePO({ vendorId: 'vendor-1', total: 700 })
    const lineItems = [
      makeLineItem({ id: 'li-1', itemId: 'item-cannabis', totalPrice: 500 }),
      makeLineItem({ id: 'li-2', itemId: 'item-packaging', totalPrice: 200 }),
    ]
    const poContents = new Map([['po-1', lineItems]])
    const items = [
      makeItem({ id: 'item-cannabis', category: 'Cannabis' }),
      makeItem({ id: 'item-packaging', category: 'Packaging' }),
    ]

    const result = computeVendorAnalytics(vendors, [po], poContents, items)

    const topCats = result.vendors[0]?.topCategories ?? []
    const cannabisCat = topCats.find(c => c.category === 'Cannabis')
    const packagingCat = topCats.find(c => c.category === 'Packaging')

    expect(cannabisCat?.spend).toBe(500)
    expect(packagingCat?.spend).toBe(200)
  })

  it('should label items with unknown itemId category as Unknown', () => {
    const vendors = [makeVendor()]
    const po = makePO({ vendorId: 'vendor-1', total: 100 })
    const lineItems = [makeLineItem({ itemId: 'item-not-in-catalog', totalPrice: 100 })]
    const poContents = new Map([['po-1', lineItems]])

    const result = computeVendorAnalytics(vendors, [po], poContents, [])

    const unknownCat = result.vendors[0]?.topCategories.find(c => c.category === 'Unknown')
    expect(unknownCat?.spend).toBe(100)
  })

  it('should cap topCategories at 5 entries', () => {
    const vendors = [makeVendor()]
    const po = makePO({ vendorId: 'vendor-1', total: 600 })
    const lineItems = Array.from({ length: 7 }, (_, i) =>
      makeLineItem({ id: `li-${i}`, itemId: `item-${i}`, totalPrice: 100 - i }),
    )
    const poContents = new Map([['po-1', lineItems]])
    const items = Array.from({ length: 7 }, (_, i) =>
      makeItem({ id: `item-${i}`, category: `Cat${i}` }),
    )

    const result = computeVendorAnalytics(vendors, [po], poContents, items)

    expect(result.vendors[0]?.topCategories.length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// Sorting by spend descending
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — sorting', () => {
  it('should sort vendors by total spend descending', () => {
    const vendors = [
      makeVendor({ id: 'v1', name: 'Small Vendor' }),
      makeVendor({ id: 'v2', name: 'Big Vendor' }),
    ]
    const pos = [
      makePO({ id: 'po-1', vendorId: 'v1', total: 100, receivedAt: null }),
      makePO({ id: 'po-2', vendorId: 'v2', total: 9000, receivedAt: null }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.vendors[0]?.vendorId).toBe('v2')
    expect(result.vendors[1]?.vendorId).toBe('v1')
  })
})

// ---------------------------------------------------------------------------
// Last order date
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — lastOrderDate', () => {
  it('should return the most recent PO createdAt as lastOrderDate', () => {
    const vendors = [makeVendor()]
    const pos = [
      makePO({ id: 'po-1', vendorId: 'vendor-1', total: 500, createdAt: '2026-01-01', receivedAt: null }),
      makePO({ id: 'po-2', vendorId: 'vendor-1', total: 500, createdAt: '2026-03-01', receivedAt: null }),
    ]

    const result = computeVendorAnalytics(vendors, pos, new Map(), [])

    expect(result.vendors[0]?.lastOrderDate).toBe('2026-03-01')
  })
})

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe('computeVendorAnalytics — empty inputs', () => {
  it('should return empty vendors and zero spend for empty inputs', () => {
    const result = computeVendorAnalytics([], [], new Map(), [])

    expect(result.vendors).toHaveLength(0)
    expect(result.totalSpend).toBe(0)
  })

  it('should handle vendors with no POs (no entries produced)', () => {
    const vendors = [makeVendor()]
    const result = computeVendorAnalytics(vendors, [], new Map(), [])

    expect(result.vendors).toHaveLength(0)
  })
})
