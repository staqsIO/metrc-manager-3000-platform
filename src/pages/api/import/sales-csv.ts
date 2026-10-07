/**
 * POST /api/import/sales-csv — Import Metrc Sales Transactions CSV
 *
 * Accepts JSON body with:
 *   - csvText: string (raw CSV content)
 *   - facilityId: string
 *
 * Parses the Metrc "Sales Transactions Report" CSV (per-package line items)
 * and batch-inserts into RetailSale + RetailSaleReceipt tables.
 * Uses skipDuplicates for safe re-runs.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '250mb',
    },
    responseLimit: false,
  },
};

// CSV columns (0-indexed):
// 0: Sales Document No.  ("Receipt 0171122765")
// 1: Sales Date/Time     ("04/13/2026 20:58:57")
// 2: Customer            ("Consumer")
// 6: Total Price         (receipt total)
// 7: Label               (package label)
// 8: Item                (product name)
// 9: Category
// 10: Quantity Sold
// 11: UoM
// 12: Price              (per-line-item price)

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseDate(dateStr: string): Date {
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart) throw new Error(`Invalid date: ${dateStr}`);
  const [month, day, year] = datePart.split('/');
  const isoStr = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T${timePart || '00:00:00'}`;
  return new Date(isoStr);
}

function parseReceiptNumber(raw: string): { receiptNumber: string; receiptId: number } {
  const num = raw.replace(/^Receipt\s*/i, '').trim();
  return { receiptNumber: num, receiptId: parseInt(num, 10) };
}

interface ReceiptSummary {
  receiptId: number;
  receiptNumber: string;
  customerType: string | null;
  lineItemCount: number;
  totalPrice: number;
  soldAt: Date;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { csvText, facilityId } = req.body as {
    csvText?: string;
    facilityId?: string;
  };

  if (!csvText || !facilityId) {
    return res.status(400).json({ error: 'Missing required fields: csvText, facilityId' });
  }

  // Verify facility
  const facility = await prisma.metrcFacility.findUnique({
    where: { id: facilityId },
    select: { id: true, name: true },
  });

  if (!facility) {
    return res.status(404).json({ error: 'Facility not found' });
  }

  try {
    const lines = csvText.split('\n');
    const BATCH_SIZE = 500;
    let batch: Prisma.RetailSaleCreateManyInput[] = [];
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Track receipt summaries for RetailSaleReceipt upsert
    const receiptMap = new Map<number, ReceiptSummary>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      try {
        const fields = parseCSVLine(line);
        const { receiptNumber, receiptId } = parseReceiptNumber(fields[0] ?? '');
        const soldAt = parseDate(fields[1] ?? '');
        const customerType = fields[2] || null;
        const totalPrice = parseFloat(fields[6] ?? '0') || 0;
        const packageLabel = fields[7] ?? '';
        const productName = fields[8] ?? '';
        const productCategory = fields[9] || null;
        const quantity = parseFloat(fields[10] ?? '0') || 0;
        const unitOfMeasure = fields[11] || null;
        const unitPrice = fields[12] ? parseFloat(fields[12]) : null;

        if (!packageLabel || !receiptNumber) {
          totalErrors++;
          continue;
        }

        batch.push({
          facilityId,
          receiptId,
          receiptNumber,
          packageLabel,
          productName,
          productCategory,
          customerType,
          quantity: new Prisma.Decimal(quantity),
          unitPrice: unitPrice != null ? new Prisma.Decimal(unitPrice) : null,
          totalPrice: new Prisma.Decimal(totalPrice),
          unitOfMeasure,
          soldAt,
          finalized: true,
        });

        // Track receipt summary
        const existing = receiptMap.get(receiptId);
        if (existing) {
          existing.lineItemCount++;
          if (soldAt > existing.soldAt) existing.soldAt = soldAt;
        } else {
          receiptMap.set(receiptId, {
            receiptId,
            receiptNumber,
            customerType,
            lineItemCount: 1,
            totalPrice,
            soldAt,
          });
        }

        if (batch.length >= BATCH_SIZE) {
          const result = await prisma.retailSale.createMany({
            data: batch,
            skipDuplicates: true,
          });
          totalInserted += result.count;
          totalSkipped += batch.length - result.count;
          batch = [];
        }
      } catch {
        totalErrors++;
      }
    }

    // Flush remaining line items
    if (batch.length > 0) {
      const result = await prisma.retailSale.createMany({
        data: batch,
        skipDuplicates: true,
      });
      totalInserted += result.count;
      totalSkipped += batch.length - result.count;
    }

    // Upsert receipt summaries in batches
    let receiptsUpserted = 0;
    const receiptBatch = Array.from(receiptMap.values());
    const RECEIPT_BATCH = 100;

    for (let i = 0; i < receiptBatch.length; i += RECEIPT_BATCH) {
      const slice = receiptBatch.slice(i, i + RECEIPT_BATCH);
      await Promise.all(
        slice.map(r =>
          prisma.retailSaleReceipt.upsert({
            where: {
              facilityId_receiptId: { facilityId, receiptId: r.receiptId },
            },
            update: {
              lineItemCount: r.lineItemCount,
              totalPrice: new Prisma.Decimal(r.totalPrice),
              soldAt: r.soldAt,
              finalized: true,
              updatedAt: new Date(),
            },
            create: {
              facilityId,
              receiptId: r.receiptId,
              receiptNumber: r.receiptNumber,
              customerType: r.customerType,
              lineItemCount: r.lineItemCount,
              totalPrice: new Prisma.Decimal(r.totalPrice),
              soldAt: r.soldAt,
              finalized: true,
            },
          })
        )
      );
      receiptsUpserted += slice.length;
    }

    return res.status(200).json({
      success: true,
      facilityName: facility.name,
      lineItems: {
        total: lines.length - 1,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
      },
      receipts: {
        upserted: receiptsUpserted,
      },
    });
  } catch (err) {
    console.error('[SALES-CSV-IMPORT] Error:', err);
    return res.status(500).json({
      error: 'Import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
