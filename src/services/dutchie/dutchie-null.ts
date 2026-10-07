import type {
  IDutchieClient,
  DutchieDelivery,
  DutchieRawTransaction,
  DutchieRawProduct,
  DutchieInventoryItem,
  DutchieCustomer,
  DutchieCustomerType,
  DutchieDiscount,
  DutchieBrand,
  DutchieHarvest,
  DutchieEmployee,
  DutchieWhoAmI,
  DutchieProductDetail,
  DutchieBulkUpdateResult,
} from './types';

/**
 * Null-object Dutchie client for facilities that don't use Dutchie POS.
 * Every method returns an empty array, null, or minimal empty response.
 * Stateless — no caching needed.
 */
export class DutchieNullClient implements IDutchieClient {
  async getDeliveries(): Promise<DutchieDelivery[]> { return []; }
  async getDeliveryByTransaction(): Promise<DutchieDelivery | null> { return null; }
  async getTransactions(): Promise<DutchieRawTransaction[]> { return []; }
  async getReportingProducts(): Promise<DutchieRawProduct[]> { return []; }
  async getReportingInventory(): Promise<DutchieInventoryItem[]> { return []; }
  async getCustomers(): Promise<DutchieCustomer[]> { return []; }
  async getCustomerTypes(): Promise<DutchieCustomerType[]> { return []; }
  async searchCustomers(): Promise<DutchieCustomer[]> { return []; }
  async getDiscounts(): Promise<DutchieDiscount[]> { return []; }
  async getBrands(): Promise<DutchieBrand[]> { return []; }
  async getHarvests(): Promise<DutchieHarvest[]> { return []; }
  async getEmployees(): Promise<DutchieEmployee[]> { return []; }
  async whoami(): Promise<DutchieWhoAmI> {
    return { LocationName: '', LocationId: '', ApiKeyType: '' };
  }
  async getProducts(): Promise<DutchieProductDetail[]> { return []; }
  async updateProducts(): Promise<DutchieBulkUpdateResult> { return { succeeded: [], failed: [] }; }
  async updateLocationOverrides(): Promise<DutchieBulkUpdateResult> { return { succeeded: [], failed: [] }; }
}
