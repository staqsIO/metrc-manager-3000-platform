import type {
  ICanixClient,
  CanixFilters,
  CanixStandardCost,
  CanixBOM,
  CanixNonCannabisProduct,
  CanixItem,
  CanixSalesOrder,
  CanixSalesOrderStatus,
  CanixLineItem,
  CanixPurchaseOrder,
  CanixPurchaseOrderStatus,
  CanixPurchaseOrderPayment,
  CanixVendor,
  CanixCustomer,
  CanixAuditedAction,
  CanixWhoAmI,
} from './types';

// ── Helpers ────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// ── Mock data constants ────────────────────────────────────────

const CANNABIS_ITEMS = [
  { name: 'Blue Dream Flower', category: 'Flower', unit: 'g', costRange: [3, 8] as [number, number] },
  { name: 'OG Kush Trim', category: 'Shake/Trim', unit: 'g', costRange: [0.5, 2] as [number, number] },
  { name: 'Gelato Pre-Roll', category: 'Pre-Roll', unit: 'each', costRange: [2, 5] as [number, number] },
  { name: 'Sour Diesel Distillate', category: 'Concentrate', unit: 'g', costRange: [8, 15] as [number, number] },
  { name: 'Wedding Cake Live Resin', category: 'Concentrate', unit: 'g', costRange: [12, 22] as [number, number] },
  { name: 'GSC Vape Cart 0.5g', category: 'Vape Cartridge', unit: 'each', costRange: [8, 14] as [number, number] },
  { name: 'Gorilla Glue Shatter', category: 'Concentrate', unit: 'g', costRange: [10, 18] as [number, number] },
  { name: 'Jack Herer Flower', category: 'Flower', unit: 'g', costRange: [4, 9] as [number, number] },
  { name: 'Northern Lights Edible 10mg', category: 'Edible', unit: 'each', costRange: [1, 4] as [number, number] },
  { name: 'Purple Punch Tincture 30ml', category: 'Tincture', unit: 'each', costRange: [5, 12] as [number, number] },
  { name: 'Zkittlez Fresh Frozen', category: 'Wet Whole Plant', unit: 'g', costRange: [1, 3] as [number, number] },
  { name: 'Runtz Extraction Buds', category: 'Extraction Buds', unit: 'g', costRange: [2, 5] as [number, number] },
];

const NON_CANNABIS_ITEMS = [
  { name: 'Child-Resistant Mylar Bag (1oz)', category: 'packaging', unit: 'each', cost: 0.35, stock: 5000 },
  { name: 'Glass Jar 3.5g with CR Lid', category: 'packaging', unit: 'each', cost: 0.85, stock: 3000 },
  { name: 'Butane (N-Tane)', category: 'solvent', unit: 'lb', cost: 12.50, stock: 200 },
  { name: 'Ethanol (Food Grade)', category: 'solvent', unit: 'gal', cost: 28.00, stock: 50 },
  { name: 'Pre-Roll Cone (King Size)', category: 'supply', unit: 'each', cost: 0.08, stock: 20000 },
  { name: 'Compliance Label (CO)', category: 'label', unit: 'each', cost: 0.02, stock: 50000 },
  { name: 'Vape Cart Hardware (CCELL)', category: 'supply', unit: 'each', cost: 2.50, stock: 1500 },
  { name: 'Terpene Blend (Gelato)', category: 'supply', unit: 'ml', cost: 3.20, stock: 500 },
];

const VENDOR_NAMES = [
  'Rocky Mountain Genetics', 'Mile High Supply Co', 'CannaPack Solutions',
  'Green State Farms', 'Peak Processing Supplies', 'Western Cannabis Distributors',
  'Elevated Extractions LLC', 'Summit Solvent Supply',
];

const CUSTOMER_NAMES = [
  'The Green Room Dispensary', 'Mountain View Cannabis', 'High Country Wellness',
  'Peak Dispensary', 'Alpine Leaf Co', 'Front Range Collective',
  'Boulder Bud Shop', 'Denver Dank Dispensary', 'Aspen Green Collective',
];

const SO_STATUSES: CanixSalesOrderStatus[] = ['draft', 'submitted', 'confirmed', 'processing', 'shipped', 'delivered', 'invoiced'];
const PO_STATUSES: CanixPurchaseOrderStatus[] = ['draft', 'submitted', 'confirmed', 'in_transit', 'received'];

export class CanixMockClient implements ICanixClient {
  private items: CanixItem[];
  private standardCosts: CanixStandardCost[];
  private boms: CanixBOM[];
  private nonCannabisProducts: CanixNonCannabisProduct[];
  private salesOrders: CanixSalesOrder[];
  private salesOrderContents: Map<string, CanixLineItem[]>;
  private purchaseOrders: CanixPurchaseOrder[];
  private purchaseOrderContents: Map<string, CanixLineItem[]>;
  private purchaseOrderPayments: Map<string, CanixPurchaseOrderPayment[]>;
  private vendors: CanixVendor[];
  private customers: CanixCustomer[];

  constructor() {
    this.items = this.generateItems();
    this.standardCosts = this.generateStandardCosts();
    this.boms = this.generateBOMs();
    this.nonCannabisProducts = this.generateNonCannabisProducts();
    this.vendors = this.generateVendors();
    this.customers = this.generateCustomers();

    const soResult = this.generateSalesOrders();
    this.salesOrders = soResult.orders;
    this.salesOrderContents = soResult.contents;

    const poResult = this.generatePurchaseOrders();
    this.purchaseOrders = poResult.orders;
    this.purchaseOrderContents = poResult.contents;
    this.purchaseOrderPayments = poResult.payments;
  }

  // ── Data generators ──────────────────────────────────────────

  private generateItems(): CanixItem[] {
    return CANNABIS_ITEMS.map((item, i) => ({
      id: `canix-item-${i + 1}`,
      name: item.name,
      category: item.category,
      metrcItemId: `metrc-item-${i + 1}`,
      unit: item.unit,
      standardCost: Math.round(rand(item.costRange[0], item.costRange[1]) * 100) / 100,
      lastPurchasePrice: Math.round(rand(item.costRange[0] * 0.9, item.costRange[1] * 1.1) * 100) / 100,
      isActive: true,
      updatedAt: daysAgo(randInt(0, 30)),
    }));
  }

  private generateStandardCosts(): CanixStandardCost[] {
    return this.items.map(item => ({
      id: `canix-cost-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      costPerUnit: item.standardCost ?? 5.0,
      unit: item.unit,
      effectiveDate: daysAgo(randInt(7, 90)),
      updatedAt: daysAgo(randInt(0, 7)),
      category: CANNABIS_ITEMS.find(ci => ci.name === item.name)?.category,
    }));
  }

  private generateBOMs(): CanixBOM[] {
    // Create realistic BOMs: concentrate products have flower/trim inputs + non-cannabis
    const boms: CanixBOM[] = [];

    // Distillate BOM: Trim → Distillate (with ethanol)
    boms.push({
      id: 'bom-distillate',
      outputItemId: this.items.find(i => i.name.includes('Distillate'))?.id ?? 'canix-item-4',
      outputItemName: 'Sour Diesel Distillate',
      outputQuantity: 1,
      outputUnit: 'g',
      components: [
        { id: 'bom-comp-1', itemId: 'canix-item-2', itemName: 'OG Kush Trim', quantityPerUnit: 5, unit: 'g', unitCost: 1.20, isCannabisDerived: true },
        { id: 'bom-comp-2', itemId: 'nc-ethanol', itemName: 'Ethanol (Food Grade)', quantityPerUnit: 0.05, unit: 'gal', unitCost: 28.00, isCannabisDerived: false },
      ],
      yieldPercentage: 20,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(5),
    });

    // Live Resin BOM: Fresh Frozen → Live Resin (with butane)
    boms.push({
      id: 'bom-live-resin',
      outputItemId: this.items.find(i => i.name.includes('Live Resin'))?.id ?? 'canix-item-5',
      outputItemName: 'Wedding Cake Live Resin',
      outputQuantity: 1,
      outputUnit: 'g',
      components: [
        { id: 'bom-comp-3', itemId: 'canix-item-11', itemName: 'Zkittlez Fresh Frozen', quantityPerUnit: 7, unit: 'g', unitCost: 2.00, isCannabisDerived: true },
        { id: 'bom-comp-4', itemId: 'nc-butane', itemName: 'Butane (N-Tane)', quantityPerUnit: 0.02, unit: 'lb', unitCost: 12.50, isCannabisDerived: false },
      ],
      yieldPercentage: 14,
      createdAt: daysAgo(45),
      updatedAt: daysAgo(3),
    });

    // Pre-Roll BOM: Flower + Cones + Labels
    boms.push({
      id: 'bom-preroll',
      outputItemId: this.items.find(i => i.name.includes('Pre-Roll'))?.id ?? 'canix-item-3',
      outputItemName: 'Gelato Pre-Roll',
      outputQuantity: 1,
      outputUnit: 'each',
      components: [
        { id: 'bom-comp-5', itemId: 'canix-item-1', itemName: 'Blue Dream Flower', quantityPerUnit: 1, unit: 'g', unitCost: 5.00, isCannabisDerived: true },
        { id: 'bom-comp-6', itemId: 'nc-cone', itemName: 'Pre-Roll Cone (King Size)', quantityPerUnit: 1, unit: 'each', unitCost: 0.08, isCannabisDerived: false },
        { id: 'bom-comp-7', itemId: 'nc-label', itemName: 'Compliance Label (CO)', quantityPerUnit: 1, unit: 'each', unitCost: 0.02, isCannabisDerived: false },
      ],
      yieldPercentage: 95,
      createdAt: daysAgo(90),
      updatedAt: daysAgo(10),
    });

    // Vape Cart BOM: Distillate + Hardware + Terpenes
    boms.push({
      id: 'bom-vape-cart',
      outputItemId: this.items.find(i => i.name.includes('Vape Cart'))?.id ?? 'canix-item-6',
      outputItemName: 'GSC Vape Cart 0.5g',
      outputQuantity: 1,
      outputUnit: 'each',
      components: [
        { id: 'bom-comp-8', itemId: 'canix-item-4', itemName: 'Sour Diesel Distillate', quantityPerUnit: 0.5, unit: 'g', unitCost: 12.00, isCannabisDerived: true },
        { id: 'bom-comp-9', itemId: 'nc-ccell', itemName: 'Vape Cart Hardware (CCELL)', quantityPerUnit: 1, unit: 'each', unitCost: 2.50, isCannabisDerived: false },
        { id: 'bom-comp-10', itemId: 'nc-terps', itemName: 'Terpene Blend (Gelato)', quantityPerUnit: 0.05, unit: 'ml', unitCost: 3.20, isCannabisDerived: false },
      ],
      yieldPercentage: 98,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(2),
    });

    // Shatter BOM: Extraction Buds → Shatter
    boms.push({
      id: 'bom-shatter',
      outputItemId: this.items.find(i => i.name.includes('Shatter'))?.id ?? 'canix-item-7',
      outputItemName: 'Gorilla Glue Shatter',
      outputQuantity: 1,
      outputUnit: 'g',
      components: [
        { id: 'bom-comp-11', itemId: 'canix-item-12', itemName: 'Runtz Extraction Buds', quantityPerUnit: 4.5, unit: 'g', unitCost: 3.50, isCannabisDerived: true },
        { id: 'bom-comp-12', itemId: 'nc-butane', itemName: 'Butane (N-Tane)', quantityPerUnit: 0.015, unit: 'lb', unitCost: 12.50, isCannabisDerived: false },
      ],
      yieldPercentage: 22,
      createdAt: daysAgo(55),
      updatedAt: daysAgo(8),
    });

    return boms;
  }

  private generateNonCannabisProducts(): CanixNonCannabisProduct[] {
    return NON_CANNABIS_ITEMS.map((item, i) => ({
      id: `nc-${item.category}-${i + 1}`,
      name: item.name,
      category: item.category,
      unit: item.unit,
      standardCost: item.cost,
      currentStock: item.stock + randInt(-100, 100),
      reorderPoint: Math.round(item.stock * 0.2),
      supplierId: this.vendors.length > 0 ? pick(this.vendors).id : `vendor-${i + 1}`,
      supplierName: pick(VENDOR_NAMES),
      isActive: true,
      updatedAt: daysAgo(randInt(0, 14)),
    }));
  }

  private generateVendors(): CanixVendor[] {
    return VENDOR_NAMES.map((name, i) => ({
      id: `vendor-${i + 1}`,
      name,
      licenseNumber: `VND-${String(randInt(100000, 999999))}`,
      contactEmail: `info@${name.toLowerCase().replace(/\s+/g, '')}.com`,
      contactPhone: `(${randInt(200, 999)}) ${randInt(200, 999)}-${randInt(1000, 9999)}`,
      address: `${randInt(100, 9999)} ${pick(['Main St', 'Industrial Blvd', 'Commerce Dr', 'Market Ave'])}`,
      isActive: true,
      createdAt: daysAgo(randInt(90, 365)),
      updatedAt: daysAgo(randInt(0, 30)),
    }));
  }

  private generateCustomers(): CanixCustomer[] {
    return CUSTOMER_NAMES.map((name, i) => ({
      id: `customer-${i + 1}`,
      name,
      licenseNumber: `DISP-${String(randInt(100000, 999999))}`,
      contactEmail: `orders@${name.toLowerCase().replace(/\s+/g, '')}.com`,
      contactPhone: `(${randInt(200, 999)}) ${randInt(200, 999)}-${randInt(1000, 9999)}`,
      address: `${randInt(100, 9999)} ${pick(['Broadway', 'Colfax Ave', 'Federal Blvd', 'Colorado Blvd'])}`,
      isActive: true,
      createdAt: daysAgo(randInt(30, 365)),
      updatedAt: daysAgo(randInt(0, 14)),
    }));
  }

  private generateSalesOrders(): { orders: CanixSalesOrder[]; contents: Map<string, CanixLineItem[]> } {
    const orders: CanixSalesOrder[] = [];
    const contents = new Map<string, CanixLineItem[]>();

    for (let i = 0; i < 25; i++) {
      const id = `so-${i + 1}`;
      const status = pick(SO_STATUSES);
      const customer = pick(this.customers);
      const lineCount = randInt(2, 6);
      const lines: CanixLineItem[] = [];

      for (let j = 0; j < lineCount; j++) {
        const item = pick(this.items);
        const qty = randInt(10, 500);
        const unitPrice = Math.round((item.standardCost ?? 5) * rand(1.5, 3.0) * 100) / 100;
        lines.push({
          id: `so-line-${id}-${j + 1}`,
          itemId: item.id,
          itemName: item.name,
          metrcPackageLabel: `1A4060300${String(randInt(10000, 99999))}${String(randInt(1000, 9999))}`,
          quantity: qty,
          unit: item.unit,
          unitPrice,
          totalPrice: Math.round(qty * unitPrice * 100) / 100,
          discount: Math.random() > 0.7 ? Math.round(rand(5, 15) * 100) / 100 : 0,
        });
      }

      const subtotal = lines.reduce((s, l) => s + l.totalPrice - l.discount, 0);
      const taxAmount = Math.round(subtotal * 0.08 * 100) / 100;

      orders.push({
        id,
        orderNumber: `SO-${2026}-${String(i + 1).padStart(4, '0')}`,
        customerId: customer.id,
        customerName: customer.name,
        status,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount,
        total: Math.round((subtotal + taxAmount) * 100) / 100,
        createdAt: daysAgo(randInt(0, 90)),
        updatedAt: daysAgo(randInt(0, 14)),
        shippedAt: ['shipped', 'delivered', 'invoiced'].includes(status) ? daysAgo(randInt(0, 10)) : null,
        deliveredAt: ['delivered', 'invoiced'].includes(status) ? daysAgo(randInt(0, 5)) : null,
        lineItemCount: lineCount,
      });
      contents.set(id, lines);
    }

    return { orders, contents };
  }

  private generatePurchaseOrders(): {
    orders: CanixPurchaseOrder[];
    contents: Map<string, CanixLineItem[]>;
    payments: Map<string, CanixPurchaseOrderPayment[]>;
  } {
    const orders: CanixPurchaseOrder[] = [];
    const contents = new Map<string, CanixLineItem[]>();
    const payments = new Map<string, CanixPurchaseOrderPayment[]>();

    for (let i = 0; i < 20; i++) {
      const id = `po-${i + 1}`;
      const status = pick(PO_STATUSES);
      const vendor = pick(this.vendors);
      const lineCount = randInt(1, 4);
      const lines: CanixLineItem[] = [];

      for (let j = 0; j < lineCount; j++) {
        const item = pick(this.items);
        const qty = randInt(50, 2000);
        const unitPrice = Math.round((item.standardCost ?? 5) * rand(0.8, 1.2) * 100) / 100;
        lines.push({
          id: `po-line-${id}-${j + 1}`,
          itemId: item.id,
          itemName: item.name,
          metrcPackageLabel: null,
          quantity: qty,
          unit: item.unit,
          unitPrice,
          totalPrice: Math.round(qty * unitPrice * 100) / 100,
          discount: 0,
        });
      }

      const subtotal = lines.reduce((s, l) => s + l.totalPrice, 0);
      const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;

      orders.push({
        id,
        poNumber: `PO-${2026}-${String(i + 1).padStart(4, '0')}`,
        vendorId: vendor.id,
        vendorName: vendor.name,
        status,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount,
        total: Math.round((subtotal + taxAmount) * 100) / 100,
        expectedDeliveryDate: ['submitted', 'confirmed', 'in_transit'].includes(status)
          ? new Date(Date.now() + randInt(3, 21) * 86400000).toISOString()
          : null,
        createdAt: daysAgo(randInt(0, 60)),
        updatedAt: daysAgo(randInt(0, 7)),
        receivedAt: status === 'received' ? daysAgo(randInt(0, 7)) : null,
        lineItemCount: lineCount,
      });
      contents.set(id, lines);

      // Generate payments for received POs
      if (status === 'received') {
        payments.set(id, [{
          id: `payment-${id}`,
          purchaseOrderId: id,
          amount: Math.round((subtotal + taxAmount) * 100) / 100,
          method: pick(['ACH', 'Wire', 'Check']),
          paidAt: daysAgo(randInt(0, 5)),
          reference: `PAY-${randInt(10000, 99999)}`,
        }]);
      }
    }

    return { orders, contents, payments };
  }

  // ── Filtering helper ─────────────────────────────────────────

  private applyFilters<T>(data: T[], filters?: CanixFilters): T[] {
    let results = [...data];
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? results.length;
    results = results.slice(offset, offset + limit);
    return results;
  }

  // ── ICanixClient implementation ──────────────────────────────

  async getStandardCosts(itemId?: string): Promise<CanixStandardCost[]> {
    if (itemId) {
      return this.standardCosts.filter(c => c.itemId === itemId);
    }
    return [...this.standardCosts];
  }

  async getBillsOfMaterials(filters?: CanixFilters): Promise<CanixBOM[]> {
    return this.applyFilters(this.boms, filters);
  }

  async getBillOfMaterials(id: string): Promise<CanixBOM | null> {
    return this.boms.find(b => b.id === id) ?? null;
  }

  async getNonCannabisProducts(filters?: CanixFilters): Promise<CanixNonCannabisProduct[]> {
    return this.applyFilters(this.nonCannabisProducts, filters);
  }

  async getItems(filters?: CanixFilters): Promise<CanixItem[]> {
    return this.applyFilters(this.items, filters);
  }

  async getSalesOrders(filters?: CanixFilters): Promise<CanixSalesOrder[]> {
    return this.applyFilters(this.salesOrders, filters);
  }

  async getSalesOrder(id: string): Promise<CanixSalesOrder | null> {
    return this.salesOrders.find(o => o.id === id) ?? null;
  }

  async getSalesOrderContents(id: string): Promise<CanixLineItem[]> {
    return this.salesOrderContents.get(id) ?? [];
  }

  async getPurchaseOrders(filters?: CanixFilters): Promise<CanixPurchaseOrder[]> {
    return this.applyFilters(this.purchaseOrders, filters);
  }

  async getPurchaseOrder(id: string): Promise<CanixPurchaseOrder | null> {
    return this.purchaseOrders.find(o => o.id === id) ?? null;
  }

  async getPurchaseOrderContents(id: string): Promise<CanixLineItem[]> {
    return this.purchaseOrderContents.get(id) ?? [];
  }

  async getPurchaseOrderPayments(id: string): Promise<CanixPurchaseOrderPayment[]> {
    return this.purchaseOrderPayments.get(id) ?? [];
  }

  async getVendors(filters?: CanixFilters): Promise<CanixVendor[]> {
    return this.applyFilters(this.vendors, filters);
  }

  async getCustomers(filters?: CanixFilters): Promise<CanixCustomer[]> {
    return this.applyFilters(this.customers, filters);
  }

  async getAuditedActions(filters?: CanixFilters): Promise<CanixAuditedAction[]> {
    // Generate some mock audit actions on demand
    const actions: CanixAuditedAction[] = Array.from({ length: 20 }, (_, i) => ({
      id: `audit-${i + 1}`,
      entityType: pick(['package', 'plant', 'harvest', 'transfer', 'item']),
      entityId: `entity-${randInt(1, 100)}`,
      action: pick(['create', 'update', 'adjust', 'move', 'delete']),
      userId: `user-${randInt(1, 5)}`,
      userName: pick(['Admin User', 'Lab Tech', 'Inventory Manager', 'Compliance Officer']),
      changes: { status: { before: 'active', after: 'inactive' } },
      performedAt: daysAgo(randInt(0, 30)),
      source: pick(['canix', 'metrc_sync', 'api', 'manual']),
    }));
    return this.applyFilters(actions, filters);
  }

  async whoami(): Promise<CanixWhoAmI> {
    return {
      companyId: 'mock-company-001',
      companyName: 'Mock Cannabis Co',
      facilityId: 'mock-facility-001',
      facilityName: 'Mock Cultivation & Processing',
      apiKeyType: 'company',
    };
  }
}
