// Dutchie POS API types and client interface
// Based on actual Dutchie Swagger spec (api.pos.dutchie.com/swagger/v001/swagger.json)

// ============================================================
// Mapped Response Types (backward-compatible interface)
// ============================================================

export interface DutchieDelivery {
  TransactionId: string;
  PreOrderId: string | null;
  Status: string; // "Completed" or "Voided"
  CustomerName: string | null;
  CustomerType: string | null;
  OrderTotal: number;
  TaxAmount: number;
  DiscountAmount: number;
  SubTotal: number;
  PaymentMethod: string | null;
  EmployeeName: string | null;
  CompletedDate: string | null;
  CreatedDate: string;
  LineItems?: DutchieLineItem[];
}

export interface DutchieLineItem {
  ProductName: string;
  Quantity: number;
  Price: number;
  TotalPrice: number;
  MetrcPackageLabel: string | null; // Key for Metrc reconciliation
  Category: string;
  Brand: string | null;
  StrainName: string | null;
  Weight: number | null;
  WeightUnit: string | null;
  DiscountAmount: number;
}

// ============================================================
// Raw API Response Types (from /reporting/transactions)
// ============================================================

export interface DutchieRawTransaction {
  transactionId: number;
  customerId: number | null;
  employeeId: number;
  transactionDate: string;
  voidDate: string | null;
  isVoid: boolean;
  subtotal: number;
  totalDiscount: number;
  totalBeforeTax: number;
  tax: number;
  tipAmount: number;
  total: number;
  paid: number;
  changeDue: number;
  totalItems: number;
  terminalName: string;
  checkInDate: string | null;
  invoiceNumber: string | null;
  isTaxInclusive: boolean;
  transactionType: string; // "Retail", "Medical", etc.
  loyaltyEarned: number;
  loyaltySpent: number;
  items?: DutchieRawTransactionItem[];
}

export interface DutchieRawTransactionItem {
  transactionId: number;
  transactionItemId: number;
  productId: number;
  totalPrice: number;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  packageId: string | null; // Metrc package label
  sourcePackageId: string | null;
  totalDiscount: number;
  inventoryId: number;
  unitWeight: number | null;
  unitWeightUnit: string | null;
  flowerEquivalent: number | null;
  flowerEquivalentUnit: string | null;
  batchName: string | null;
  isReturned: boolean;
  returnDate: string | null;
  returnReason: string | null;
}

export interface DutchieRawProduct {
  productId: number;
  globalProductId: string;
  productName: string;
  internalName: string | null;
  description: string | null;
  sku: string | null;
  category: string;
  masterCategory: string;
  categoryId: number;
}

export interface DutchieCustomer {
  Id: string;
  FirstName: string;
  LastName: string;
  Email: string | null;
  Phone: string | null;
  CustomerType: string;
  CreatedDate: string;
  LastModifiedDate: string;
  TotalOrders: number;
  TotalSpent: number;
}

export interface DutchieCustomerType {
  Id: string;
  Name: string;
}

export interface DutchieDiscount {
  Id: string;
  Name: string;
  DiscountType: string;
  Amount: number;
  IsActive: boolean;
}

export interface DutchieBrand {
  Id: string;
  Name: string;
}

export interface DutchieHarvest {
  Id: string;
  HarvestName: string;
  StrainName: string;
  StartDate: string;
  IsActive: boolean;
  LastModifiedDate: string;
}

export interface DutchieEmployee {
  Id: string;
  FirstName: string;
  LastName: string;
  Role: string;
  IsActive: boolean;
}

export interface DutchieWhoAmI {
  LocationName: string;
  LocationId: string;
  ApiKeyType: string;
}

// ============================================================
// Product Management Types (POST /products/*)
// ============================================================

/** Full product detail from GET/POST /products/products */
export interface DutchieProductDetail {
  productId: number;
  globalProductId: string | null;
  name: string;
  sku: string | null;
  internalName: string | null;
  description: string | null;
  brandId: number | null;
  brandName: string | null;
  categoryId: number;
  categoryName: string | null;
  masterCategory: string | null;
  unitPrice: number | null;
  unitCost: number | null;
  weightPerUnit: number | null;
  weightUnit: string | null;
  flowerEquivalent: number | null;
  flowerEquivalentUnit: string | null;
  isTaxExempt: boolean;
  isActive: boolean;
  isVisible: boolean;
  requiresWeighing: boolean;
  lowInventoryThreshold: number | null;
  strainName: string | null;
  thcContent: number | null;
  cbdContent: number | null;
  labTestDate: string | null;
  imageUrl: string | null;
  lastModifiedDateUtc: string | null;
  createdDateUtc: string | null;
}

/** Location-level override for pricing/visibility (POST /products/location-overrides) */
export interface DutchieLocationOverride {
  productId: number;
  locationId?: string;
  unitPrice?: number;
  quantityAvailable?: number;
  isVisible?: boolean;
  isActive?: boolean;
}

/** Result of a bulk product update operation */
export interface DutchieBulkUpdateResult {
  succeeded: string[];
  failed: { productId: string; error: string }[];
}

/** Cross-store product match for comparison view */
export interface CrossStoreProductMatch {
  /** Primary key for the match group (SKU or normalized name) */
  matchKey: string;
  matchType: 'sku' | 'name';
  /** Product details per facility — key is facilityId */
  byFacility: Record<string, DutchieProductDetail>;
  /** Fields that differ across stores */
  inconsistencies: string[];
}

/** Find-replace rule for bulk operations */
export interface FindReplaceRule {
  field: 'name' | 'description' | 'unitPrice' | 'categoryId' | 'brandId' | 'isActive' | 'isVisible';
  find: string;
  replace: string;
  /** Regex mode — find is treated as regex pattern */
  isRegex?: boolean;
  /** Case-insensitive matching for string fields */
  caseInsensitive?: boolean;
}

/** Preview of what a find-replace would change per facility */
export interface FindReplacePreview {
  facilityId: string;
  facilityName: string;
  changes: {
    productId: number;
    productName: string;
    field: string;
    oldValue: string;
    newValue: string;
  }[];
}

// ============================================================
// Reporting Inventory (Dutchie /reporting/inventory endpoint)
// ============================================================

export interface DutchieInventoryItem {
  ProductId: number;
  ProductName: string;
  MetrcPackageLabel: string | null;
  CategoryName: string | null;
  BrandName: string | null;
  StrainName: string | null;
  Quantity: number;
  UnitOfMeasure: string | null;
  RoomName: string | null;
  RoomQuantity: number | null; // present when includeRoomQuantities=true
  BatchDate: string | null;
  ExpirationDate: string | null;
  IsActive: boolean;
  LastModifiedDate: string;
}

// ============================================================
// Facility Scope
// ============================================================

export type DutchieFacilityScope = 'retail' | 'cultivation' | 'manufacturing';

// ============================================================
// Client Interface
// ============================================================

export interface IDutchieClient {
  // Sales/transactions (backed by /reporting/transactions)
  getDeliveries(params?: {
    includeLineItems?: boolean;
    deliveryStatus?: string;
    pageNumber?: number;
    pageSize?: number;
    fromDateUTC?: string;
    toDateUTC?: string;
  }): Promise<DutchieDelivery[]>;

  getDeliveryByTransaction(transactionId: string): Promise<DutchieDelivery | null>;

  // Raw transaction data (richer than mapped getDeliveries)
  getTransactions(params?: {
    fromDateUTC?: string;
    toDateUTC?: string;
    fromLastModifiedDateUTC?: string;
    toLastModifiedDateUTC?: string;
    transactionId?: number;
    includeDetail?: boolean;
    includeTaxes?: boolean;
  }): Promise<DutchieRawTransaction[]>;

  // Reporting endpoints
  getReportingProducts(params?: {
    fromLastModifiedDateUTC?: string;
  }): Promise<DutchieRawProduct[]>;

  getReportingInventory(params?: {
    includeLabResults?: boolean;
    includeRoomQuantities?: boolean;
    includeLineage?: boolean;
  }): Promise<DutchieInventoryItem[]>;

  // Customers
  getCustomers(params?: {
    fromLastModifiedDateUTC?: string;
    pageNumber?: number;
    pageSize?: number;
  }): Promise<DutchieCustomer[]>;

  getCustomerTypes(): Promise<DutchieCustomerType[]>;

  searchCustomers(query: string): Promise<DutchieCustomer[]>;

  // Inventory context
  getDiscounts(): Promise<DutchieDiscount[]>;
  getBrands(): Promise<DutchieBrand[]>;

  // Harvest (parallel Metrc data source)
  getHarvests(params?: {
    fromLastModifiedDateUTC?: string;
    activeHarvests?: boolean;
  }): Promise<DutchieHarvest[]>;

  // Staff
  getEmployees(): Promise<DutchieEmployee[]>;

  // Auth verification
  whoami(): Promise<DutchieWhoAmI>;

  // Product management (write operations for bulk ops)
  getProducts(params?: {
    categoryId?: number;
    brandId?: number;
    isActive?: boolean;
  }): Promise<DutchieProductDetail[]>;

  updateProducts(products: Partial<DutchieProductDetail>[]): Promise<DutchieBulkUpdateResult>;

  updateLocationOverrides(overrides: DutchieLocationOverride[]): Promise<DutchieBulkUpdateResult>;
}
