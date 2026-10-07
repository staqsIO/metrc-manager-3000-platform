import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DutchieDelivery } from '@/services/dutchie/types';
import { computeDailySales } from '@/server/api/routers/sales';

// Mock the Dutchie factory so the chat tool's `getDutchieClient(fac)` returns
// a stub whose `getDeliveries` resolves to our fixture.
const mockGetDeliveries = vi.fn();
vi.mock('@/services/dutchie/dutchie-factory', () => ({
  getDutchieClient: () => ({
    getDeliveries: mockGetDeliveries,
  }),
}));

import { createToolExecutor } from '../copilot-tools';

function makeDelivery(overrides: Partial<DutchieDelivery>): DutchieDelivery {
  return {
    TransactionId: 'tx-' + Math.random().toString(36).slice(2),
    PreOrderId: null,
    Status: 'Completed',
    CustomerName: null,
    CustomerType: null,
    OrderTotal: 100,
    TaxAmount: 0,
    DiscountAmount: 0,
    SubTotal: 100,
    PaymentMethod: null,
    EmployeeName: null,
    CompletedDate: recentIso(10),
    CreatedDate: '2026-04-20T09:00:00Z',
    LineItems: [],
    ...overrides,
  };
}

// Fixture dates must fall inside the tool's default 30-day window, which is
// relative to "now"; hardcoded calendar dates silently age out of it.
function recentIso(hourUtc: number): string {
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return `${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`;
}

function makeFacilityCtx() {
  return {
    packages: [],
    facility: {
      id: 'fac-1',
      organizationId: 'org-1',
      dutchieEnvironment: 'production',
    } as never,
    facilityId: 'fac-1',
  };
}

describe('get_daily_sales chat tool ↔ dashboard parity', () => {
  beforeEach(() => {
    mockGetDeliveries.mockReset();
  });

  it('returns the same per-day revenue and order counts the dashboard helper produces for the same fixture', async () => {
    // Dates within the default 30-day window (relative to "now")
    const now = Date.now();
    const day1 = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    const day2 = new Date(now - 1 * 86400000).toISOString().slice(0, 10);
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ OrderTotal: 100, CompletedDate: day1 + 'T08:00:00Z' }),
      makeDelivery({ OrderTotal: 50.5, CompletedDate: day1 + 'T18:30:00Z' }),
      makeDelivery({ OrderTotal: 200, CompletedDate: day2 + 'T12:00:00Z' }),
    ];
    mockGetDeliveries.mockResolvedValue(deliveries);

    const exec = createToolExecutor(makeFacilityCtx());
    const raw = await exec('get_daily_sales', { days: 30 });
    const parsed = JSON.parse(raw);

    const dashboardPoints = computeDailySales(deliveries, {});

    const chatSlim = parsed.days.map((d: { date: string; revenue: number; orderCount: number }) => ({
      date: d.date,
      revenue: d.revenue,
      orderCount: d.orderCount,
    }));
    const dashSlim = dashboardPoints.map(d => ({
      date: d.date,
      revenue: d.revenue,
      orderCount: d.orderCount,
    }));
    expect(chatSlim).toEqual(dashSlim);
  });

  it('excludes voided and in-progress deliveries (matches dashboard rule)', async () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ Status: 'Completed', OrderTotal: 100, CompletedDate: recentIso(8) }),
      makeDelivery({ Status: 'Voided', OrderTotal: 999, CompletedDate: recentIso(9) }),
      makeDelivery({ Status: 'InProgress', OrderTotal: 999, CompletedDate: recentIso(10) }),
    ];
    mockGetDeliveries.mockResolvedValue(deliveries);

    const exec = createToolExecutor(makeFacilityCtx());
    const raw = await exec('get_daily_sales', { days: 30 });
    const parsed = JSON.parse(raw);

    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0].revenue).toBe(100);
    expect(parsed.totalRevenue).toBe(100);
  });

  it('picks the top category from category totals across all deliveries on a day', async () => {
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const deliveries: DutchieDelivery[] = [
      // First delivery: Edibles dominates by itself
      makeDelivery({
        OrderTotal: 50,
        CompletedDate: day + 'T08:00:00Z',
        LineItems: [
          { ProductName: 'Gummy', Quantity: 1, Price: 50, TotalPrice: 50, MetrcPackageLabel: null, Category: 'Edibles', Brand: null, StrainName: null, Weight: null, WeightUnit: null, DiscountAmount: 0 },
        ],
      }),
      // Second + third deliveries: Flower revenue sums to 200, beating Edibles
      makeDelivery({
        OrderTotal: 100,
        CompletedDate: day + 'T12:00:00Z',
        LineItems: [
          { ProductName: 'Pre-roll', Quantity: 1, Price: 100, TotalPrice: 100, MetrcPackageLabel: null, Category: 'Flower', Brand: null, StrainName: null, Weight: null, WeightUnit: null, DiscountAmount: 0 },
        ],
      }),
      makeDelivery({
        OrderTotal: 100,
        CompletedDate: day + 'T16:00:00Z',
        LineItems: [
          { ProductName: 'Eighth', Quantity: 1, Price: 100, TotalPrice: 100, MetrcPackageLabel: null, Category: 'Flower', Brand: null, StrainName: null, Weight: null, WeightUnit: null, DiscountAmount: 0 },
        ],
      }),
    ];
    mockGetDeliveries.mockResolvedValue(deliveries);

    const exec = createToolExecutor(makeFacilityCtx());
    const raw = await exec('get_daily_sales', { days: 30 });
    const parsed = JSON.parse(raw);

    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0].topCategory).toBe('Flower');
  });

  it('excludes deliveries with null CompletedDate even if Status is Completed (no CreatedDate fallback)', async () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ Status: 'Completed', OrderTotal: 100, CompletedDate: recentIso(8) }),
      makeDelivery({ Status: 'Completed', OrderTotal: 999, CompletedDate: null, CreatedDate: recentIso(7) }),
    ];
    mockGetDeliveries.mockResolvedValue(deliveries);

    const exec = createToolExecutor(makeFacilityCtx());
    const raw = await exec('get_daily_sales', { days: 30 });
    const parsed = JSON.parse(raw);

    expect(parsed.totalRevenue).toBe(100);
  });
});
