/**
 * Product Sync Engine — cross-store product matching, comparison, and bulk update logic.
 *
 * All functions are pure (no side effects beyond API calls) and independently testable.
 * The engine is decoupled from tRPC — it receives client factories, not raw facilities.
 */
import type { MetrcFacility } from '@prisma/client';
import type {
  IDutchieClient,
  DutchieProductDetail,
  DutchieBulkUpdateResult,
  CrossStoreProductMatch,
  FindReplaceRule,
  FindReplacePreview,
} from './types';

const API_CONCURRENCY = 5;

// ── Helpers ──────────────────────────────────────────────────

/** Run promises with bounded concurrency (pool of N). */
async function boundedAll<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]!() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Normalize a product name for whitespace-normalized exact matching. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Get a display value for a field, handling nulls and numbers. */
function fieldToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

// ── Core Functions ───────────────────────────────────────────

/**
 * Fetch all products from multiple stores in parallel with bounded concurrency.
 */
export async function fetchProductsFromStores(
  facilities: MetrcFacility[],
  getDutchieClient: (facility: MetrcFacility) => IDutchieClient,
): Promise<{
  products: Map<string, DutchieProductDetail[]>;
  skipped: { facilityId: string; facilityName: string; reason: string }[];
}> {
  const products = new Map<string, DutchieProductDetail[]>();
  const skipped: { facilityId: string; facilityName: string; reason: string }[] = [];

  const tasks = facilities.map((facility) => async () => {
    const client = getDutchieClient(facility);
    const result = await client.getProducts();
    return { facilityId: facility.id, products: result };
  });

  const results = await boundedAll(tasks, API_CONCURRENCY);

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const facility = facilities[i]!;
    if (result.status === 'fulfilled') {
      products.set(facility.id, result.value.products);
    } else {
      skipped.push({
        facilityId: facility.id,
        facilityName: facility.name,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  return { products, skipped };
}

/**
 * Match products across stores by SKU (primary) then name (fuzzy fallback).
 * Returns groups of products that represent the same item across different stores.
 */
export function matchProductsAcrossStores(
  storeProducts: Map<string, DutchieProductDetail[]>,
): CrossStoreProductMatch[] {
  // Index products by SKU and normalized name
  const bySku = new Map<string, Map<string, DutchieProductDetail>>();
  const byName = new Map<string, Map<string, DutchieProductDetail>>();

  Array.from(storeProducts.entries()).forEach(([facilityId, products]) => {
    for (const product of products) {
      // SKU matching (primary)
      if (product.sku) {
        const key = product.sku.toUpperCase();
        if (!bySku.has(key)) bySku.set(key, new Map());
        bySku.get(key)!.set(facilityId, product);
      }

      // Name matching (fallback)
      const nameKey = normalizeName(product.name);
      if (!byName.has(nameKey)) byName.set(nameKey, new Map());
      byName.get(nameKey)!.set(facilityId, product);
    }
  });

  const matches: CrossStoreProductMatch[] = [];
  const matchedProductIds = new Set<string>(); // "facilityId:productId" to avoid double-matching

  // Pass 1: SKU matches (products in 2+ stores with same SKU)
  Array.from(bySku.entries()).forEach(([sku, facilityMap]) => {
    if (facilityMap.size < 2) return;

    const byFacility: Record<string, DutchieProductDetail> = {};
    Array.from(facilityMap.entries()).forEach(([fId, product]) => {
      byFacility[fId] = product;
      matchedProductIds.add(`${fId}:${product.productId}`);
    });

    matches.push({
      matchKey: sku,
      matchType: 'sku',
      byFacility,
      inconsistencies: detectInconsistencies(Object.values(byFacility)),
    });
  });

  // Pass 2: Name matches (only for products not already matched by SKU)
  Array.from(byName.entries()).forEach(([nameKey, facilityMap]) => {
    if (facilityMap.size < 2) return;

    // Filter out already-matched products
    const unmatched = new Map<string, DutchieProductDetail>();
    Array.from(facilityMap.entries()).forEach(([fId, product]) => {
      if (!matchedProductIds.has(`${fId}:${product.productId}`)) {
        unmatched.set(fId, product);
      }
    });

    if (unmatched.size < 2) return;

    const byFacility: Record<string, DutchieProductDetail> = {};
    Array.from(unmatched.entries()).forEach(([fId, product]) => {
      byFacility[fId] = product;
      matchedProductIds.add(`${fId}:${product.productId}`);
    });

    matches.push({
      matchKey: nameKey,
      matchType: 'name',
      byFacility,
      inconsistencies: detectInconsistencies(Object.values(byFacility)),
    });
  });

  // Sort: inconsistencies first, then by matchKey
  return matches.sort((a, b) => {
    if (a.inconsistencies.length !== b.inconsistencies.length) {
      return b.inconsistencies.length - a.inconsistencies.length;
    }
    return a.matchKey.localeCompare(b.matchKey);
  });
}

/** Detect which fields differ across store copies of a product. */
function detectInconsistencies(products: DutchieProductDetail[]): string[] {
  if (products.length < 2) return [];

  const fields: (keyof DutchieProductDetail)[] = [
    'name', 'description', 'unitPrice', 'categoryId', 'brandId',
    'isActive', 'isVisible', 'strainName', 'thcContent', 'cbdContent',
  ];

  const inconsistent: string[] = [];
  const first = products[0]!;

  for (const field of fields) {
    const firstVal = fieldToString(first[field]);
    const differs = products.some(p => fieldToString(p[field]) !== firstVal);
    if (differs) inconsistent.push(field);
  }

  return inconsistent;
}

/**
 * Compute a preview of what a find-replace rule would change per facility.
 */
export function computeFindReplacePreview(
  matches: CrossStoreProductMatch[],
  rule: FindReplaceRule,
  facilityNames: Record<string, string>,
): FindReplacePreview[] {
  const previewByFacility = new Map<string, FindReplacePreview>();

  for (const match of matches) {
    for (const [facilityId, product] of Object.entries(match.byFacility)) {
      const oldValue = fieldToString(product[rule.field as keyof DutchieProductDetail]);
      const newValue = applyFindReplace(oldValue, rule);

      if (oldValue === newValue) continue; // No change

      if (!previewByFacility.has(facilityId)) {
        previewByFacility.set(facilityId, {
          facilityId,
          facilityName: facilityNames[facilityId] ?? facilityId,
          changes: [],
        });
      }

      previewByFacility.get(facilityId)!.changes.push({
        productId: product.productId,
        productName: product.name,
        field: rule.field,
        oldValue,
        newValue,
      });
    }
  }

  return Array.from(previewByFacility.values());
}

/** Apply a find-replace rule to a single value. */
function applyFindReplace(value: string, rule: FindReplaceRule): string {
  // For numeric/boolean fields, do exact match replacement
  if (['unitPrice', 'categoryId', 'brandId', 'isActive', 'isVisible'].includes(rule.field)) {
    return value === rule.find ? rule.replace : value;
  }

  // String fields — support regex and case-insensitive
  if (rule.isRegex) {
    // ReDoS protection: reject overly complex patterns
    if (rule.find.length > 100) return value;
    try {
      const flags = rule.caseInsensitive ? 'gi' : 'g';
      const regex = new RegExp(rule.find, flags);
      return value.replace(regex, rule.replace);
    } catch {
      return value; // Invalid regex — no change
    }
  }

  if (rule.caseInsensitive) {
    // Case-insensitive string replacement (all occurrences)
    const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return value.replace(new RegExp(escaped, 'gi'), rule.replace);
  }

  // Plain string replacement (all occurrences)
  return value.split(rule.find).join(rule.replace);
}

/**
 * Execute bulk update for a single facility with GET-before-POST safety.
 *
 * For each product change:
 * 1. GET the current full product state
 * 2. Merge the changed fields
 * 3. POST the complete object back
 *
 * This prevents Dutchie's POST /products/products from nulling un-sent fields.
 */
export async function executeBulkUpdate(
  facility: MetrcFacility,
  changes: FindReplacePreview['changes'],
  getDutchieClient: (facility: MetrcFacility) => IDutchieClient,
): Promise<{
  result: DutchieBulkUpdateResult;
  beforeState: Record<string, DutchieProductDetail>;
  afterState: Record<string, DutchieProductDetail>;
}> {
  const client = getDutchieClient(facility);
  const succeeded: string[] = [];
  const failed: { productId: string; error: string }[] = [];
  const beforeState: Record<string, DutchieProductDetail> = {};
  const afterState: Record<string, DutchieProductDetail> = {};

  // Fetch all current products once to have the full state
  const allProducts = await client.getProducts();
  const productMap = new Map(allProducts.map(p => [p.productId, p]));

  // Group changes by productId
  const changesByProduct = new Map<number, typeof changes>();
  for (const change of changes) {
    if (!changesByProduct.has(change.productId)) {
      changesByProduct.set(change.productId, []);
    }
    changesByProduct.get(change.productId)!.push(change);
  }

  // Process updates with bounded concurrency
  const updateTasks = Array.from(changesByProduct.entries()).map(
    ([productId, productChanges]) => async () => {
      const current = productMap.get(productId);
      if (!current) {
        failed.push({ productId: String(productId), error: 'Product not found during execution' });
        return;
      }

      // Save before state
      beforeState[String(productId)] = { ...current };

      // Apply all changes for this product
      const updated = { ...current };
      for (const change of productChanges) {
        applyChangeToProduct(updated, change.field, change.newValue);
      }

      // POST the complete updated product
      const result = await client.updateProducts([updated]);
      if (result.succeeded.length > 0) {
        succeeded.push(String(productId));
        afterState[String(productId)] = updated;
      } else if (result.failed.length > 0) {
        failed.push(...result.failed);
      }
    },
  );

  await boundedAll(updateTasks, API_CONCURRENCY);

  return {
    result: { succeeded, failed },
    beforeState,
    afterState,
  };
}

/**
 * Execute a rollback for a single facility using the saved beforeState snapshot.
 *
 * Restores ALL tracked fields from the snapshot, not just the fields that were
 * changed in the original operation. This ensures consistency but may overwrite
 * changes made to other fields AFTER the original operation.
 *
 * For each product in beforeState:
 * 1. GET the current full product state (to avoid nulling un-sent fields)
 * 2. Overwrite ALL tracked fields with the beforeState values
 * 3. POST the complete object back
 *
 * The caller is responsible for filtering beforeState to only include products
 * that actually need to be rolled back (e.g. only succeeded products from the
 * original operation).
 */
export async function executeRollback(
  facility: MetrcFacility,
  beforeState: Record<string, DutchieProductDetail>,
  getDutchieClient: (facility: MetrcFacility) => IDutchieClient,
): Promise<{
  result: DutchieBulkUpdateResult;
  afterState: Record<string, DutchieProductDetail>;
}> {
  const client = getDutchieClient(facility);
  const succeeded: string[] = [];
  const failed: { productId: string; error: string }[] = [];
  const afterState: Record<string, DutchieProductDetail> = {};

  // Fetch current products to have the full state for merging
  const allProducts = await client.getProducts();
  const productMap = new Map(allProducts.map(p => [String(p.productId), p]));

  const rollbackTasks = Object.entries(beforeState).map(
    ([productId, savedState]) => async () => {
      const current = productMap.get(productId);
      if (!current) {
        failed.push({ productId, error: 'Product not found — may have been deleted since original operation' });
        return;
      }

      // Merge: start with current full state, overwrite with saved before-state fields
      const restored: DutchieProductDetail = {
        ...current,
        name: savedState.name,
        description: savedState.description,
        unitPrice: savedState.unitPrice,
        unitCost: savedState.unitCost,
        categoryId: savedState.categoryId,
        brandId: savedState.brandId,
        isActive: savedState.isActive,
        isVisible: savedState.isVisible,
        strainName: savedState.strainName,
        thcContent: savedState.thcContent,
        cbdContent: savedState.cbdContent,
        sku: savedState.sku,
        internalName: savedState.internalName,
        weightPerUnit: savedState.weightPerUnit,
        weightUnit: savedState.weightUnit,
        flowerEquivalent: savedState.flowerEquivalent,
        flowerEquivalentUnit: savedState.flowerEquivalentUnit,
        isTaxExempt: savedState.isTaxExempt,
        requiresWeighing: savedState.requiresWeighing,
        lowInventoryThreshold: savedState.lowInventoryThreshold,
      };

      const result = await client.updateProducts([restored]);
      if (result.succeeded.length > 0) {
        succeeded.push(productId);
        afterState[productId] = restored;
      } else if (result.failed.length > 0) {
        failed.push(...result.failed);
      }
    },
  );

  await boundedAll(rollbackTasks, API_CONCURRENCY);

  return {
    result: { succeeded, failed },
    afterState,
  };
}

/** Apply a single field change to a product object. */
function applyChangeToProduct(
  product: DutchieProductDetail,
  field: string,
  newValue: string,
): void {
  switch (field) {
    case 'name':
      product.name = newValue;
      break;
    case 'description':
      product.description = newValue || null;
      break;
    case 'unitPrice': {
      const parsed = parseFloat(newValue);
      product.unitPrice = isNaN(parsed) ? null : parsed;
      break;
    }
    case 'categoryId': {
      const parsed = parseInt(newValue, 10);
      product.categoryId = isNaN(parsed) ? 0 : parsed;
      break;
    }
    case 'brandId': {
      const parsed = parseInt(newValue, 10);
      product.brandId = isNaN(parsed) ? null : parsed;
      break;
    }
    case 'isActive':
      product.isActive = newValue === 'true';
      break;
    case 'isVisible':
      product.isVisible = newValue === 'true';
      break;
  }
}
