/**
 * Customer Analytics Engine
 *
 * Computes per-customer B2B sales metrics from Canix sales orders.
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { CanixCustomer, CanixSalesOrder } from '../canix/types';

// ============================================================
// Types
// ============================================================

export type CustomerStatus = 'active' | 'at_risk' | 'churned';

export interface CustomerMetrics {
  customerId: string;
  customerName: string;
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  orderFrequencyDays: number;
  lastOrderDate: string | null;
  status: CustomerStatus;
}

export interface CustomerAnalyticsResult {
  customers: CustomerMetrics[];
  totalRevenue: number;
  atRiskCount: number;
}

// ============================================================
// Core computation
// ============================================================

/** Statuses that represent completed/active orders */
const ACTIVE_ORDER_STATUSES = new Set([
  'confirmed', 'processing', 'shipped', 'delivered', 'invoiced',
]);

/**
 * Classify customer health based on days since last order.
 * >90 days = churned, 30-90 days = at_risk, <30 days = active.
 */
function classifyCustomerStatus(lastOrderDate: string | null, now: Date): CustomerStatus {
  if (!lastOrderDate) return 'churned';
  const daysSince = (now.getTime() - new Date(lastOrderDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 90) return 'churned';
  if (daysSince > 30) return 'at_risk';
  return 'active';
}

/**
 * Compute per-customer analytics from sales orders.
 *
 * Groups orders by customer, computes revenue, frequency, and churn status.
 */
export function computeCustomerAnalytics(
  customers: CanixCustomer[],
  salesOrders: CanixSalesOrder[],
  // soContents reserved for future per-line-item breakdown
): CustomerAnalyticsResult {
  const now = new Date();

  // Build customer name lookup
  const customerNameMap = new Map<string, string>();
  for (const c of customers) {
    customerNameMap.set(c.id, c.name);
  }

  // Group active orders by customer
  const customerOrders = new Map<string, CanixSalesOrder[]>();
  for (const so of salesOrders) {
    if (!ACTIVE_ORDER_STATUSES.has(so.status)) continue;
    const existing = customerOrders.get(so.customerId) ?? [];
    existing.push(so);
    customerOrders.set(so.customerId, existing);
  }

  let totalRevenue = 0;
  let atRiskCount = 0;
  const customerMetrics: CustomerMetrics[] = [];

  for (const [customerId, orders] of Array.from(customerOrders.entries())) {
    const customerName = customerNameMap.get(customerId) ?? orders[0]?.customerName ?? 'Unknown';
    const customerRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    totalRevenue += customerRevenue;

    // Sort orders chronologically
    const sortedOrders = orders
      .filter(o => o.createdAt)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Compute average frequency between orders
    let frequencyDays = 0;
    if (sortedOrders.length >= 2) {
      const firstOrder = new Date(sortedOrders[0]!.createdAt).getTime();
      const lastOrder = new Date(sortedOrders[sortedOrders.length - 1]!.createdAt).getTime();
      const totalDays = (lastOrder - firstOrder) / (1000 * 60 * 60 * 24);
      frequencyDays = Math.round((totalDays / (sortedOrders.length - 1)) * 10) / 10;
    }

    const lastOrderDate = sortedOrders.length > 0
      ? sortedOrders[sortedOrders.length - 1]!.createdAt
      : null;

    const status = classifyCustomerStatus(lastOrderDate, now);
    if (status === 'at_risk') atRiskCount++;

    customerMetrics.push({
      customerId,
      customerName,
      totalOrders: orders.length,
      totalRevenue: Math.round(customerRevenue * 100) / 100,
      avgOrderValue: orders.length > 0 ? Math.round((customerRevenue / orders.length) * 100) / 100 : 0,
      orderFrequencyDays: frequencyDays,
      lastOrderDate,
      status,
    });
  }

  // Sort by revenue descending
  customerMetrics.sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    customers: customerMetrics,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    atRiskCount,
  };
}
