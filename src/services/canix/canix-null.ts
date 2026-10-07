import type {
  ICanixClient,
  CanixStandardCost,
  CanixBOM,
  CanixNonCannabisProduct,
  CanixItem,
  CanixSalesOrder,
  CanixLineItem,
  CanixPurchaseOrder,
  CanixPurchaseOrderPayment,
  CanixVendor,
  CanixCustomer,
  CanixAuditedAction,
  CanixWhoAmI,
} from './types';

/**
 * Null-object Canix client for facilities that don't use Canix ERP.
 * Every method returns an empty array, null, or minimal empty response.
 * All features degrade gracefully to existing behavior (Metrc + Dutchie only).
 */
export class CanixNullClient implements ICanixClient {
  // Phase 0: Costs + BOMs
  async getStandardCosts(): Promise<CanixStandardCost[]> { return []; }
  async getBillsOfMaterials(): Promise<CanixBOM[]> { return []; }
  async getBillOfMaterials(): Promise<CanixBOM | null> { return null; }
  async getNonCannabisProducts(): Promise<CanixNonCannabisProduct[]> { return []; }
  async getItems(): Promise<CanixItem[]> { return []; }

  // Phase 1: Orders
  async getSalesOrders(): Promise<CanixSalesOrder[]> { return []; }
  async getSalesOrder(): Promise<CanixSalesOrder | null> { return null; }
  async getSalesOrderContents(): Promise<CanixLineItem[]> { return []; }
  async getPurchaseOrders(): Promise<CanixPurchaseOrder[]> { return []; }
  async getPurchaseOrder(): Promise<CanixPurchaseOrder | null> { return null; }
  async getPurchaseOrderContents(): Promise<CanixLineItem[]> { return []; }
  async getPurchaseOrderPayments(): Promise<CanixPurchaseOrderPayment[]> { return []; }
  async getVendors(): Promise<CanixVendor[]> { return []; }
  async getCustomers(): Promise<CanixCustomer[]> { return []; }

  // Phase 2: Audit
  async getAuditedActions(): Promise<CanixAuditedAction[]> { return []; }

  // Auth
  async whoami(): Promise<CanixWhoAmI> {
    throw new Error('Canix ERP is not configured for this facility');
  }
}
