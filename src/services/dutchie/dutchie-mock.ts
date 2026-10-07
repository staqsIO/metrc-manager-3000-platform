import type {
  IDutchieClient,
  DutchieDelivery,
  DutchieLineItem,
  DutchieCustomer,
  DutchieCustomerType,
  DutchieDiscount,
  DutchieBrand,
  DutchieHarvest,
  DutchieEmployee,
  DutchieWhoAmI,
  DutchieRawTransaction,
  DutchieRawProduct,
  DutchieProductDetail,
  DutchieLocationOverride,
  DutchieBulkUpdateResult,
  DutchieFacilityScope,
  DutchieInventoryItem,
} from './types';
import { MOCK_PACKAGE_LABELS } from '../metrc/metrc-mock';

// Realistic cannabis product data for mock generation
const STRAINS = [
  'Blue Dream', 'OG Kush', 'Girl Scout Cookies', 'Sour Diesel', 'Gorilla Glue',
  'Wedding Cake', 'Gelato', 'Jack Herer', 'Northern Lights', 'White Widow',
  'Granddaddy Purple', 'Pineapple Express', 'Durban Poison', 'Lemon Haze',
  'Purple Punch', 'Zkittlez', 'Runtz', 'Ice Cream Cake', 'Do-Si-Dos', 'Mimosa',
];

const CATEGORIES = ['Flower', 'Pre-Roll', 'Vape Cartridge', 'Edible', 'Concentrate', 'Tincture', 'Topical'];

const BRANDS = [
  'Green Thumb', 'Kiva Confections', 'STIIIZY', 'Raw Garden', 'Connected',
  'Alien Labs', 'Cookies', 'Lowell Farms', 'Papa & Barkley', 'Select',
];

const PRODUCT_TEMPLATES: Record<string, { priceRange: [number, number]; weightRange?: [number, number]; weightUnit?: string }> = {
  'Flower': { priceRange: [25, 65], weightRange: [1, 28], weightUnit: 'g' },
  'Pre-Roll': { priceRange: [8, 25], weightRange: [0.5, 2], weightUnit: 'g' },
  'Vape Cartridge': { priceRange: [30, 60], weightRange: [0.5, 1], weightUnit: 'g' },
  'Edible': { priceRange: [15, 45] },
  'Concentrate': { priceRange: [35, 80], weightRange: [0.5, 3.5], weightUnit: 'g' },
  'Tincture': { priceRange: [30, 70] },
  'Topical': { priceRange: [20, 50] },
};

const EMPLOYEE_NAMES = [
  { first: 'Alex', last: 'Rivera' },
  { first: 'Jordan', last: 'Chen' },
  { first: 'Sam', last: 'Patel' },
  { first: 'Taylor', last: 'Kim' },
  { first: 'Morgan', last: 'Johnson' },
  { first: 'Casey', last: 'Williams' },
];

const PAYMENT_METHODS = ['Cash', 'Debit', 'Credit', 'ACH'];
const CUSTOMER_TYPES = ['Recreational', 'Medical'];
const DELIVERY_STATUSES = ['Completed', 'Completed', 'Completed', 'Completed', 'Pending', 'InTransit', 'Cancelled'];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateMetrcLabel(): string {
  const prefix = '1A4060300';
  const suffix = String(randInt(10000, 99999)).padStart(5, '0');
  const check = String(randInt(1000, 9999));
  return `${prefix}${suffix}${check}`;
}

function generateTransactionId(): string {
  return `TXN-${Date.now().toString(36)}-${randInt(1000, 9999)}`;
}

export class DutchieMockClient implements IDutchieClient {
  private deliveries: DutchieDelivery[];
  private customers: DutchieCustomer[];
  private employees: DutchieEmployee[];
  private facilityScopes: DutchieFacilityScope[];
  private productCatalog: Map<number, DutchieProductDetail> = new Map();

  constructor(opts?: { stateCode?: string; facilityScopes?: DutchieFacilityScope[] }) {
    this.facilityScopes = opts?.facilityScopes ?? [];
    this.employees = EMPLOYEE_NAMES.map((e, i) => ({
      Id: `emp-${i + 1}`,
      FirstName: e.first,
      LastName: e.last,
      Role: i === 0 ? 'Manager' : 'Budtender',
      IsActive: true,
    }));

    this.customers = this.generateCustomers(200);
    this.deliveries = this.generateDeliveries(500);
  }

  private generateCustomers(count: number): DutchieCustomer[] {
    const firstNames = ['James', 'Maria', 'David', 'Sarah', 'Michael', 'Jennifer', 'Robert', 'Linda', 'William', 'Elizabeth', 'Carlos', 'Aisha', 'Wei', 'Priya', 'Omar'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Lee', 'Nguyen', 'Patel', 'Kim', 'Chen'];

    return Array.from({ length: count }, (_, i) => {
      const first = pick(firstNames);
      const last = pick(lastNames);
      const daysAgo = randInt(1, 365);
      return {
        Id: `cust-${i + 1}`,
        FirstName: first,
        LastName: last,
        Email: Math.random() > 0.3 ? `${first.toLowerCase()}.${last.toLowerCase()}@email.com` : null,
        Phone: Math.random() > 0.4 ? `(${randInt(200, 999)}) ${randInt(200, 999)}-${randInt(1000, 9999)}` : null,
        CustomerType: pick(CUSTOMER_TYPES),
        CreatedDate: new Date(Date.now() - daysAgo * 86400000).toISOString(),
        LastModifiedDate: new Date(Date.now() - randInt(0, daysAgo) * 86400000).toISOString(),
        TotalOrders: randInt(1, 50),
        TotalSpent: Math.round(rand(50, 5000) * 100) / 100,
      };
    });
  }

  private generateDeliveries(count: number): DutchieDelivery[] {
    return Array.from({ length: count }, () => {
      const status = pick(DELIVERY_STATUSES);
      const daysAgo = randInt(0, 90);
      const createdDate = new Date(Date.now() - daysAgo * 86400000);
      const lineItemCount = randInt(1, 5);
      const employee = pick(this.employees);
      const customer = Math.random() > 0.2 ? pick(this.customers) : null;

      const lineItems: DutchieLineItem[] = Array.from({ length: lineItemCount }, () => {
        const category = pick(CATEGORIES);
        const strain = pick(STRAINS);
        const brand = pick(BRANDS);
        const template = PRODUCT_TEMPLATES[category]!;
        const price = Math.round(rand(template.priceRange[0], template.priceRange[1]) * 100) / 100;
        const quantity = randInt(1, 3);
        const discount = Math.random() > 0.8 ? Math.round(rand(2, 10) * 100) / 100 : 0;
        const hasMetrcLabel = Math.random() < 0.7; // 70% have Metrc labels
        // Use real Metrc package labels from mock pool so reconciliation works in dev
        const metrcLabel = hasMetrcLabel
          ? (MOCK_PACKAGE_LABELS.length > 0
              ? pick(MOCK_PACKAGE_LABELS)
              : generateMetrcLabel())
          : null;

        return {
          ProductName: `${brand} ${strain} ${category}`,
          Quantity: quantity,
          Price: price,
          TotalPrice: Math.round((price * quantity - discount) * 100) / 100,
          MetrcPackageLabel: metrcLabel,
          Category: category,
          Brand: brand,
          StrainName: strain,
          Weight: template.weightRange ? Math.round(rand(template.weightRange[0], template.weightRange[1]) * 10) / 10 : null,
          WeightUnit: template.weightUnit ?? null,
          DiscountAmount: discount,
        };
      });

      const subTotal = lineItems.reduce((s, li) => s + li.TotalPrice, 0);
      const taxRate = rand(0.15, 0.35); // Cannabis tax rates vary
      const taxAmount = Math.round(subTotal * taxRate * 100) / 100;
      const discountAmount = lineItems.reduce((s, li) => s + li.DiscountAmount, 0);

      return {
        TransactionId: generateTransactionId(),
        PreOrderId: Math.random() > 0.85 ? `PRE-${randInt(10000, 99999)}` : null,
        Status: status,
        CustomerName: customer ? `${customer.FirstName} ${customer.LastName}` : null,
        CustomerType: customer?.CustomerType ?? pick(CUSTOMER_TYPES),
        OrderTotal: Math.round((subTotal + taxAmount) * 100) / 100,
        TaxAmount: taxAmount,
        DiscountAmount: Math.round(discountAmount * 100) / 100,
        SubTotal: Math.round(subTotal * 100) / 100,
        PaymentMethod: pick(PAYMENT_METHODS),
        EmployeeName: `${employee.FirstName} ${employee.LastName}`,
        CompletedDate: status === 'Completed' ? createdDate.toISOString() : null,
        CreatedDate: createdDate.toISOString(),
        LineItems: lineItems,
      };
    }).sort((a, b) => new Date(b.CreatedDate).getTime() - new Date(a.CreatedDate).getTime());
  }

  async getDeliveries(params?: {
    includeLineItems?: boolean;
    deliveryStatus?: string;
    pageNumber?: number;
    pageSize?: number;
    fromDateUTC?: string;
    toDateUTC?: string;
  }): Promise<DutchieDelivery[]> {
    let results = [...this.deliveries];

    if (params?.fromDateUTC) {
      const from = new Date(params.fromDateUTC).getTime();
      results = results.filter(d => new Date(d.CreatedDate).getTime() >= from);
    }
    if (params?.toDateUTC) {
      const to = new Date(params.toDateUTC).getTime();
      results = results.filter(d => new Date(d.CreatedDate).getTime() <= to);
    }

    if (params?.deliveryStatus) {
      results = results.filter(d => d.Status === params.deliveryStatus);
    }

    const page = params?.pageNumber ?? 0;
    const size = params?.pageSize ?? 50;
    const start = page * size;
    results = results.slice(start, start + size);

    if (params?.includeLineItems === false) {
      results = results.map(d => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { LineItems: _lineItems, ...rest } = d;
        return rest as DutchieDelivery;
      });
    }

    return results;
  }

  async getDeliveryByTransaction(transactionId: string): Promise<DutchieDelivery | null> {
    return this.deliveries.find(d => d.TransactionId === transactionId) ?? null;
  }

  async getTransactions(params?: {
    fromDateUTC?: string;
    toDateUTC?: string;
    fromLastModifiedDateUTC?: string;
    toLastModifiedDateUTC?: string;
    transactionId?: number;
    includeDetail?: boolean;
    includeTaxes?: boolean;
  }): Promise<DutchieRawTransaction[]> {
    // Map mock deliveries to raw transaction shape
    let results = [...this.deliveries];

    if (params?.transactionId) {
      results = results.filter(d => d.TransactionId === String(params.transactionId));
    }
    if (params?.fromDateUTC) {
      const from = new Date(params.fromDateUTC).getTime();
      results = results.filter(d => new Date(d.CreatedDate).getTime() >= from);
    }
    if (params?.toDateUTC) {
      const to = new Date(params.toDateUTC).getTime();
      results = results.filter(d => new Date(d.CreatedDate).getTime() <= to);
    }

    return results.map((d, i) => ({
      transactionId: i + 1,
      customerId: null,
      employeeId: 1,
      transactionDate: d.CreatedDate,
      voidDate: d.Status === 'Cancelled' ? d.CreatedDate : null,
      isVoid: d.Status === 'Cancelled',
      subtotal: d.SubTotal,
      totalDiscount: d.DiscountAmount,
      totalBeforeTax: d.SubTotal - d.DiscountAmount,
      tax: d.TaxAmount,
      tipAmount: 0,
      total: d.OrderTotal,
      paid: d.OrderTotal,
      changeDue: 0,
      totalItems: d.LineItems?.length ?? 0,
      terminalName: 'Mock Terminal',
      checkInDate: null,
      invoiceNumber: null,
      isTaxInclusive: false,
      transactionType: d.CustomerType ?? 'Recreational',
      loyaltyEarned: 0,
      loyaltySpent: 0,
      items: params?.includeDetail !== false ? d.LineItems?.map((li, j) => ({
        transactionId: i + 1,
        transactionItemId: j + 1,
        productId: j + 1,
        totalPrice: li.TotalPrice,
        quantity: li.Quantity,
        unitPrice: li.Price,
        unitCost: li.Price * 0.5,
        packageId: li.MetrcPackageLabel,
        sourcePackageId: li.MetrcPackageLabel,
        totalDiscount: li.DiscountAmount,
        inventoryId: j + 1,
        unitWeight: li.Weight,
        unitWeightUnit: li.WeightUnit,
        flowerEquivalent: null,
        flowerEquivalentUnit: null,
        batchName: li.MetrcPackageLabel,
        isReturned: false,
        returnDate: null,
        returnReason: null,
      })) : undefined,
    }));
  }

  async getReportingProducts(): Promise<DutchieRawProduct[]> {
    // Generate mock products from the delivery line items
    const seen = new Set<string>();
    const products: DutchieRawProduct[] = [];
    for (const d of this.deliveries) {
      for (const li of d.LineItems ?? []) {
        if (!seen.has(li.ProductName)) {
          seen.add(li.ProductName);
          products.push({
            productId: products.length + 1,
            globalProductId: `mock-${products.length + 1}`,
            productName: li.ProductName,
            internalName: li.Brand ? `${li.Brand} | ${li.ProductName}` : null,
            description: null,
            sku: null,
            category: li.Category,
            masterCategory: li.Category,
            categoryId: products.length + 1,
          });
        }
      }
    }
    return products;
  }

  async getReportingInventory(): Promise<DutchieInventoryItem[]> {
    return [];
  }

  async getCustomers(params?: {
    fromLastModifiedDateUTC?: string;
    pageNumber?: number;
    pageSize?: number;
  }): Promise<DutchieCustomer[]> {
    let results = [...this.customers];

    if (params?.fromLastModifiedDateUTC) {
      const since = new Date(params.fromLastModifiedDateUTC).getTime();
      results = results.filter(c => new Date(c.LastModifiedDate).getTime() >= since);
    }

    const page = params?.pageNumber ?? 0;
    const size = params?.pageSize ?? 50;
    const start = page * size;
    return results.slice(start, start + size);
  }

  async getCustomerTypes(): Promise<DutchieCustomerType[]> {
    return [
      { Id: 'rec', Name: 'Recreational' },
      { Id: 'med', Name: 'Medical' },
    ];
  }

  async searchCustomers(query: string): Promise<DutchieCustomer[]> {
    const q = query.toLowerCase();
    return this.customers.filter(c =>
      c.FirstName.toLowerCase().includes(q) ||
      c.LastName.toLowerCase().includes(q) ||
      (c.Email?.toLowerCase().includes(q) ?? false)
    ).slice(0, 25);
  }

  async getDiscounts(): Promise<DutchieDiscount[]> {
    return [
      { Id: 'disc-1', Name: 'Senior Discount', DiscountType: 'Percentage', Amount: 10, IsActive: true },
      { Id: 'disc-2', Name: 'Veterans Discount', DiscountType: 'Percentage', Amount: 15, IsActive: true },
      { Id: 'disc-3', Name: 'First Time Customer', DiscountType: 'Percentage', Amount: 20, IsActive: true },
      { Id: 'disc-4', Name: 'Happy Hour', DiscountType: 'Fixed', Amount: 5, IsActive: true },
      { Id: 'disc-5', Name: 'Industry', DiscountType: 'Percentage', Amount: 25, IsActive: false },
    ];
  }

  async getBrands(): Promise<DutchieBrand[]> {
    return BRANDS.map((name, i) => ({ Id: `brand-${i + 1}`, Name: name }));
  }

  async getHarvests(params?: {
    fromLastModifiedDateUTC?: string;
    activeHarvests?: boolean;
  }): Promise<DutchieHarvest[]> {
    // Match real client: no cultivation scope → empty result
    if (this.facilityScopes.length > 0 && !this.facilityScopes.includes('cultivation')) return [];

    const harvests = STRAINS.slice(0, 10).map((strain, i) => ({
      Id: `harvest-${i + 1}`,
      HarvestName: `${strain} Harvest ${i + 1}`,
      StrainName: strain,
      StartDate: new Date(Date.now() - randInt(10, 60) * 86400000).toISOString(),
      IsActive: i < 7,
      LastModifiedDate: new Date(Date.now() - randInt(0, 10) * 86400000).toISOString(),
    }));

    let results = harvests;
    if (params?.activeHarvests !== undefined) {
      results = results.filter(h => h.IsActive === params.activeHarvests);
    }
    if (params?.fromLastModifiedDateUTC) {
      const since = new Date(params.fromLastModifiedDateUTC).getTime();
      results = results.filter(h => new Date(h.LastModifiedDate).getTime() >= since);
    }
    return results;
  }

  async getEmployees(): Promise<DutchieEmployee[]> {
    return [...this.employees];
  }

  async whoami(): Promise<DutchieWhoAmI> {
    return {
      LocationName: 'Mock Dispensary',
      LocationId: 'mock-location-001',
      ApiKeyType: 'Location',
    };
  }

  // ── Product Management (write operations) ──────────────────

  private ensureProductCatalog(): void {
    if (this.productCatalog.size > 0) return;
    // Seed from delivery line items
    let nextId = 1;
    const seen = new Set<string>();
    for (const d of this.deliveries) {
      for (const li of d.LineItems ?? []) {
        if (seen.has(li.ProductName)) continue;
        seen.add(li.ProductName);
        const id = nextId++;
        this.productCatalog.set(id, {
          productId: id,
          globalProductId: `mock-global-${id}`,
          name: li.ProductName,
          sku: `SKU-${String(id).padStart(5, '0')}`,
          internalName: li.Brand ? `${li.Brand} | ${li.ProductName}` : null,
          description: `Mock description for ${li.ProductName}`,
          brandId: li.Brand ? BRANDS.indexOf(li.Brand) + 1 : null,
          brandName: li.Brand,
          categoryId: CATEGORIES.indexOf(li.Category) + 1,
          categoryName: li.Category,
          masterCategory: li.Category,
          unitPrice: li.Price,
          unitCost: Math.round(li.Price * 0.5 * 100) / 100,
          weightPerUnit: li.Weight,
          weightUnit: li.WeightUnit,
          flowerEquivalent: null,
          flowerEquivalentUnit: null,
          isTaxExempt: false,
          isActive: true,
          isVisible: true,
          requiresWeighing: li.Category === 'Flower',
          lowInventoryThreshold: 10,
          strainName: li.StrainName,
          thcContent: Math.round(rand(15, 30) * 10) / 10,
          cbdContent: Math.round(rand(0, 5) * 10) / 10,
          labTestDate: new Date(Date.now() - randInt(1, 30) * 86400000).toISOString(),
          imageUrl: null,
          lastModifiedDateUtc: new Date().toISOString(),
          createdDateUtc: new Date(Date.now() - randInt(30, 365) * 86400000).toISOString(),
        });
      }
    }
  }

  async getProducts(params?: {
    categoryId?: number;
    brandId?: number;
    isActive?: boolean;
  }): Promise<DutchieProductDetail[]> {
    this.ensureProductCatalog();
    let products = Array.from(this.productCatalog.values());

    if (params?.categoryId !== undefined) {
      products = products.filter(p => p.categoryId === params.categoryId);
    }
    if (params?.brandId !== undefined) {
      products = products.filter(p => p.brandId === params.brandId);
    }
    if (params?.isActive !== undefined) {
      products = products.filter(p => p.isActive === params.isActive);
    }

    return products;
  }

  async updateProducts(products: Partial<DutchieProductDetail>[]): Promise<DutchieBulkUpdateResult> {
    this.ensureProductCatalog();
    const succeeded: string[] = [];
    const failed: { productId: string; error: string }[] = [];

    for (const update of products) {
      if (!update.productId) {
        failed.push({ productId: 'unknown', error: 'Missing productId' });
        continue;
      }
      const existing = this.productCatalog.get(update.productId);
      if (!existing) {
        failed.push({ productId: String(update.productId), error: 'Product not found' });
        continue;
      }
      // Merge — POST overwrites all fields, so spread the full update
      this.productCatalog.set(update.productId, {
        ...existing,
        ...update,
        lastModifiedDateUtc: new Date().toISOString(),
      } as DutchieProductDetail);
      succeeded.push(String(update.productId));
    }

    return { succeeded, failed };
  }

  async updateLocationOverrides(overrides: DutchieLocationOverride[]): Promise<DutchieBulkUpdateResult> {
    this.ensureProductCatalog();
    const succeeded: string[] = [];
    const failed: { productId: string; error: string }[] = [];

    for (const override of overrides) {
      const existing = this.productCatalog.get(override.productId);
      if (!existing) {
        failed.push({ productId: String(override.productId), error: 'Product not found' });
        continue;
      }
      // Location overrides are sparse — only update provided fields
      if (override.unitPrice !== undefined) existing.unitPrice = override.unitPrice;
      if (override.isVisible !== undefined) existing.isVisible = override.isVisible;
      if (override.isActive !== undefined) existing.isActive = override.isActive;
      existing.lastModifiedDateUtc = new Date().toISOString();
      succeeded.push(String(override.productId));
    }

    return { succeeded, failed };
  }
}
