import { describe, it, expect } from 'vitest';
import { computeDailySales } from '../sales';
import type { DutchieDelivery } from '@/services/dutchie/types';

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
    CompletedDate: '2026-04-20T10:00:00Z',
    CreatedDate: '2026-04-20T09:00:00Z',
    ...overrides,
  };
}

describe('computeDailySales', () => {
  it('groups completed deliveries by their CompletedDate ISO day and sums revenue and order count', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ OrderTotal: 100, CompletedDate: '2026-04-20T08:00:00Z' }),
      makeDelivery({ OrderTotal: 50.5, CompletedDate: '2026-04-20T18:30:00Z' }),
      makeDelivery({ OrderTotal: 200, CompletedDate: '2026-04-21T12:00:00Z' }),
    ];

    const result = computeDailySales(deliveries, {});

    expect(result).toHaveLength(2);
    const apr20 = result.find(p => p.date === '2026-04-20');
    const apr21 = result.find(p => p.date === '2026-04-21');
    expect(apr20).toBeDefined();
    expect(apr20!.revenue).toBeCloseTo(150.5, 2);
    expect(apr20!.orderCount).toBe(2);
    expect(apr21).toBeDefined();
    expect(apr21!.revenue).toBe(200);
    expect(apr21!.orderCount).toBe(1);
  });

  it('excludes deliveries where Status is not Completed', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ Status: 'Completed', OrderTotal: 100, CompletedDate: '2026-04-20T08:00:00Z' }),
      makeDelivery({ Status: 'Voided', OrderTotal: 999, CompletedDate: '2026-04-20T09:00:00Z' }),
      makeDelivery({ Status: 'InProgress', OrderTotal: 999, CompletedDate: '2026-04-20T10:00:00Z' }),
    ];

    const result = computeDailySales(deliveries, {});

    expect(result).toHaveLength(1);
    expect(result[0].revenue).toBe(100);
    expect(result[0].orderCount).toBe(1);
  });

  it('excludes deliveries with null CompletedDate even when Status is Completed', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ Status: 'Completed', OrderTotal: 100, CompletedDate: '2026-04-20T08:00:00Z' }),
      makeDelivery({ Status: 'Completed', OrderTotal: 999, CompletedDate: null }),
    ];

    const result = computeDailySales(deliveries, {});

    expect(result).toHaveLength(1);
    expect(result[0].revenue).toBe(100);
  });

  it('honors fromDate cutoff to drop earlier days', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ OrderTotal: 100, CompletedDate: '2026-04-15T12:00:00Z' }),
      makeDelivery({ OrderTotal: 200, CompletedDate: '2026-04-20T12:00:00Z' }),
      makeDelivery({ OrderTotal: 300, CompletedDate: '2026-04-22T12:00:00Z' }),
    ];

    const result = computeDailySales(deliveries, { fromDate: new Date('2026-04-19T00:00:00Z') });

    expect(result.map(p => p.date)).toEqual(['2026-04-20', '2026-04-22']);
    expect(result.find(p => p.date === '2026-04-15')).toBeUndefined();
  });

  it('honors toDate cutoff to drop later days', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ OrderTotal: 100, CompletedDate: '2026-04-20T12:00:00Z' }),
      makeDelivery({ OrderTotal: 200, CompletedDate: '2026-04-25T12:00:00Z' }),
    ];

    const result = computeDailySales(deliveries, { toDate: new Date('2026-04-22T00:00:00Z') });

    expect(result.map(p => p.date)).toEqual(['2026-04-20']);
  });

  it('returns daily points sorted ascending by date', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ OrderTotal: 1, CompletedDate: '2026-04-22T01:00:00Z' }),
      makeDelivery({ OrderTotal: 1, CompletedDate: '2026-04-20T01:00:00Z' }),
      makeDelivery({ OrderTotal: 1, CompletedDate: '2026-04-21T01:00:00Z' }),
    ];

    const result = computeDailySales(deliveries, {});

    expect(result.map(p => p.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
  });

  it('returns an empty array when no deliveries qualify', () => {
    const deliveries: DutchieDelivery[] = [
      makeDelivery({ Status: 'Voided', OrderTotal: 100, CompletedDate: '2026-04-20T08:00:00Z' }),
    ];

    expect(computeDailySales(deliveries, {})).toEqual([]);
    expect(computeDailySales([], {})).toEqual([]);
  });
});
