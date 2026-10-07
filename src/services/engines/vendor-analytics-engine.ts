/**
 * Vendor Analytics Engine
 *
 * Computes per-vendor procurement metrics from Canix purchase orders.
 * Pure functions — no React, no Prisma, no tRPC imports.
 */

import type { CanixVendor, CanixPurchaseOrder, CanixLineItem, CanixItem } from '../canix/types';

// ============================================================
// Types
// ============================================================

export interface VendorMetrics {
  vendorId: string;
  vendorName: string;
  totalPOs: number;
  totalSpend: number;
  avgOrderValue: number;
  avgLeadTimeDays: number;
  topCategories: Array<{ category: string; spend: number }>;
  lastOrderDate: string | null;
}

export interface VendorAnalyticsResult {
  vendors: VendorMetrics[];
  totalSpend: number;
}

// ============================================================
// Core computation
// ============================================================

/**
 * Compute per-vendor analytics from purchase orders and line items.
 *
 * Groups POs by vendor, computes spend, lead time, and category breakdown.
 */
export function computeVendorAnalytics(
  vendors: CanixVendor[],
  purchaseOrders: CanixPurchaseOrder[],
  poContents: Map<string, CanixLineItem[]>,
  items: CanixItem[],
): VendorAnalyticsResult {
  // Build item category lookup
  const itemCategoryMap = new Map<string, string>();
  for (const item of items) {
    itemCategoryMap.set(item.id, item.category);
  }

  // Group POs by vendor
  const vendorPOs = new Map<string, CanixPurchaseOrder[]>();
  for (const po of purchaseOrders) {
    const existing = vendorPOs.get(po.vendorId) ?? [];
    existing.push(po);
    vendorPOs.set(po.vendorId, existing);
  }

  // Build vendor name lookup
  const vendorNameMap = new Map<string, string>();
  for (const v of vendors) {
    vendorNameMap.set(v.id, v.name);
  }

  let totalSpend = 0;
  const vendorMetrics: VendorMetrics[] = [];

  for (const [vendorId, pos] of Array.from(vendorPOs.entries())) {
    const vendorName = vendorNameMap.get(vendorId) ?? pos[0]?.vendorName ?? 'Unknown';
    const vendorSpend = pos.reduce((sum, po) => sum + po.total, 0);
    totalSpend += vendorSpend;

    // Compute average lead time from POs that have both created and received dates
    let totalLeadTimeDays = 0;
    let leadTimeCount = 0;
    for (const po of pos) {
      if (po.receivedAt && po.createdAt) {
        const created = new Date(po.createdAt).getTime();
        const received = new Date(po.receivedAt).getTime();
        const days = (received - created) / (1000 * 60 * 60 * 24);
        if (days > 0) {
          totalLeadTimeDays += days;
          leadTimeCount++;
        }
      }
    }

    // Compute category breakdown from line items
    const categorySpend = new Map<string, number>();
    for (const po of pos) {
      const lineItems = poContents.get(po.id) ?? [];
      for (const li of lineItems) {
        const category = itemCategoryMap.get(li.itemId) ?? 'Unknown';
        categorySpend.set(category, (categorySpend.get(category) ?? 0) + li.totalPrice);
      }
    }

    const topCategories = Array.from(categorySpend.entries())
      .map(([category, spend]) => ({ category, spend: Math.round(spend * 100) / 100 }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    // Find last order date
    const sortedByDate = pos
      .filter(po => po.createdAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    vendorMetrics.push({
      vendorId,
      vendorName,
      totalPOs: pos.length,
      totalSpend: Math.round(vendorSpend * 100) / 100,
      avgOrderValue: pos.length > 0 ? Math.round((vendorSpend / pos.length) * 100) / 100 : 0,
      avgLeadTimeDays: leadTimeCount > 0 ? Math.round((totalLeadTimeDays / leadTimeCount) * 10) / 10 : 0,
      topCategories,
      lastOrderDate: sortedByDate[0]?.createdAt ?? null,
    });
  }

  // Sort by total spend descending
  vendorMetrics.sort((a, b) => b.totalSpend - a.totalSpend);

  return {
    vendors: vendorMetrics,
    totalSpend: Math.round(totalSpend * 100) / 100,
  };
}
