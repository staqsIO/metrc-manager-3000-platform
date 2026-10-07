// Canix ERP API types and client interface
// Based on Canix API v1.3.5 (https://api.canix.com/api/v1)
// Auth: X-API-KEY header (company-level)
// Pagination: limit/offset/orderBy/where

// ============================================================
// Pagination & Filters
// ============================================================

export interface CanixFilters {
  limit?: number;
  offset?: number;
  orderBy?: string;
  where?: Record<string, unknown>;
}

export interface CanixPaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================
// Standard Costs
// ============================================================

export interface CanixStandardCost {
  id: string;
  itemId: string;
  itemName: string;
  costPerUnit: number;
  unit: string; // 'g', 'oz', 'each', etc.
  effectiveDate: string;
  updatedAt: string;
  category?: string;
}

// ============================================================
// Bills of Materials
// ============================================================

export interface CanixBOMComponent {
  id: string;
  itemId: string;
  itemName: string;
  quantityPerUnit: number;
  unit: string;
  unitCost: number | null;
  isCannabisDerived: boolean;
}

export interface CanixBOM {
  id: string;
  outputItemId: string;
  outputItemName: string;
  outputQuantity: number;
  outputUnit: string;
  components: CanixBOMComponent[];
  yieldPercentage: number | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Items
// ============================================================

export interface CanixItem {
  id: string;
  name: string;
  category: string;
  metrcItemId: string | null;
  unit: string;
  standardCost: number | null;
  lastPurchasePrice: number | null;
  isActive: boolean;
  updatedAt: string;
}

// ============================================================
// Non-Cannabis Products
// ============================================================

export interface CanixNonCannabisProduct {
  id: string;
  name: string;
  category: string; // 'packaging', 'solvent', 'supply', 'label', etc.
  unit: string;
  standardCost: number | null;
  currentStock: number;
  reorderPoint: number | null;
  supplierId: string | null;
  supplierName: string | null;
  isActive: boolean;
  updatedAt: string;
}

// ============================================================
// Sales Orders (B2B)
// ============================================================

export type CanixSalesOrderStatus =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'invoiced'
  | 'cancelled';

export interface CanixSalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: CanixSalesOrderStatus;
  subtotal: number;
  taxAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  lineItemCount: number;
}

export interface CanixLineItem {
  id: string;
  itemId: string;
  itemName: string;
  metrcPackageLabel: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  discount: number;
}

// ============================================================
// Purchase Orders
// ============================================================

export type CanixPurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'in_transit'
  | 'received'
  | 'cancelled';

export interface CanixPurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  status: CanixPurchaseOrderStatus;
  subtotal: number;
  taxAmount: number;
  total: number;
  expectedDeliveryDate: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  lineItemCount: number;
}

export interface CanixPurchaseOrderPayment {
  id: string;
  purchaseOrderId: string;
  amount: number;
  method: string;
  paidAt: string;
  reference: string | null;
}

// ============================================================
// Vendors & Customers
// ============================================================

export interface CanixVendor {
  id: string;
  name: string;
  licenseNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanixCustomer {
  id: string;
  name: string;
  licenseNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Audited Actions
// ============================================================

export interface CanixAuditedAction {
  id: string;
  entityType: string; // 'package', 'plant', 'harvest', 'transfer', etc.
  entityId: string;
  action: string; // 'create', 'update', 'delete', 'adjust', 'move', etc.
  userId: string;
  userName: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  performedAt: string;
  source: string; // 'canix', 'metrc_sync', 'api', etc.
}

// ============================================================
// Auth Verification
// ============================================================

export interface CanixWhoAmI {
  companyId: string;
  companyName: string;
  facilityId: string | null;
  facilityName: string | null;
  apiKeyType: string; // 'company'
}

// ============================================================
// Client Interface
// ============================================================

export interface ICanixClient {
  // ── Phase 0: Costs + BOMs ──────────────────────────────────
  getStandardCosts(itemId?: string): Promise<CanixStandardCost[]>;
  getBillsOfMaterials(filters?: CanixFilters): Promise<CanixBOM[]>;
  getBillOfMaterials(id: string): Promise<CanixBOM | null>;
  getNonCannabisProducts(filters?: CanixFilters): Promise<CanixNonCannabisProduct[]>;
  getItems(filters?: CanixFilters): Promise<CanixItem[]>;

  // ── Phase 1: Orders ────────────────────────────────────────
  getSalesOrders(filters?: CanixFilters): Promise<CanixSalesOrder[]>;
  getSalesOrder(id: string): Promise<CanixSalesOrder | null>;
  getSalesOrderContents(id: string): Promise<CanixLineItem[]>;
  getPurchaseOrders(filters?: CanixFilters): Promise<CanixPurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<CanixPurchaseOrder | null>;
  getPurchaseOrderContents(id: string): Promise<CanixLineItem[]>;
  getPurchaseOrderPayments(id: string): Promise<CanixPurchaseOrderPayment[]>;
  getVendors(filters?: CanixFilters): Promise<CanixVendor[]>;
  getCustomers(filters?: CanixFilters): Promise<CanixCustomer[]>;

  // ── Phase 2: Audit ─────────────────────────────────────────
  getAuditedActions(filters?: CanixFilters): Promise<CanixAuditedAction[]>;

  // ── Auth ───────────────────────────────────────────────────
  whoami(): Promise<CanixWhoAmI>;
}
