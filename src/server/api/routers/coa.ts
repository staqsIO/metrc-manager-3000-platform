import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import type { Prisma } from '@prisma/client';
import { parseCOAText } from '@/services/engines/coa-parsing-engine';
import { parseCOAWithLLM } from '@/services/copilot/coa-llm-parser';
import { takeDemoQuestion } from '@/server/api/demo-ai-gate';
import type { TerpeneResult, CannabinoidResult, LabInfo, BatchInfo } from '@/services/engines/coa-parsing-engine';

/**
 * COA (Certificate of Analysis) router — FOR-959, FOR-970
 *
 * Two-tier parsing system:
 * - Tier 1: Pure regex engine (fast, free)
 * - Tier 2: GPT-4o via OpenRouter (fallback when Tier 1 confidence < 0.8 on cannabinoids)
 *
 * Follows Preview → Confirm → Execute mutation pattern.
 * Preview returns parsed data; Confirm accepts that data back (no re-parsing).
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_BASE64_LENGTH = 14_000_000; // ~10MB file in base64 + margin
const TIER2_CONFIDENCE_THRESHOLD = 0.8;
const MAX_LLM_TEXT_LENGTH = 30_000; // Truncate PDF text before sending to LLM

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate base64 string and decode to Buffer with PDF magic bytes check. */
function decodeAndValidatePDF(fileBase64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+=*$/.test(fileBase64)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid base64 encoding' });
  }

  const buffer = Buffer.from(fileBase64, 'base64');

  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is not a valid PDF' });
  }

  return buffer;
}

/** Extract text from a PDF buffer. */
async function extractPDFText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import: pdf-parse reads a test fixture at module eval time,
    // which breaks Next.js SSG. Lazy-loading avoids the issue.
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Failed to parse PDF: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
}

interface ParsedCOAData {
  terpenes: TerpeneResult[];
  cannabinoids: CannabinoidResult[];
  labInfo: LabInfo;
  batchInfo: BatchInfo;
  totalTerpenes: number | null;
  totalCannabinoids: number | null;
  overallConfidence: number;
  warnings: string[];
  parseTier: 'regex' | 'llm';
}

/**
 * Run the two-tier parsing pipeline.
 * Tier 1 (regex) first. If cannabinoid confidence < threshold, Tier 2 (LLM).
 */
async function runParsingPipeline(pdfText: string, mayUseLlm: () => Promise<boolean>): Promise<ParsedCOAData> {
  const tier1Result = parseCOAText(pdfText);

  const avgCannabinoidConf = tier1Result.cannabinoids.length > 0
    ? tier1Result.cannabinoids.reduce((sum, c) => sum + c.confidence, 0) / tier1Result.cannabinoids.length
    : 0;

  if (avgCannabinoidConf >= TIER2_CONFIDENCE_THRESHOLD) {
    return { ...tier1Result, parseTier: 'regex' };
  }

  // Tier 2: LLM fallback. On the demo it costs a free question; when none are left, keep the regex result.
  if (!(await mayUseLlm())) return { ...tier1Result, parseTier: 'regex' };
  try {
    const truncatedText = pdfText.length > MAX_LLM_TEXT_LENGTH
      ? pdfText.slice(0, MAX_LLM_TEXT_LENGTH)
      : pdfText;
    const tier2Result = await parseCOAWithLLM(truncatedText, tier1Result);

    if (
      tier2Result.overallConfidence > tier1Result.overallConfidence ||
      tier2Result.cannabinoids.length > tier1Result.cannabinoids.length
    ) {
      return {
        terpenes: tier2Result.terpenes,
        cannabinoids: tier2Result.cannabinoids,
        labInfo: tier2Result.labInfo,
        batchInfo: tier2Result.batchInfo,
        totalTerpenes: tier2Result.totalTerpenes,
        totalCannabinoids: tier2Result.totalCannabinoids,
        overallConfidence: tier2Result.overallConfidence,
        warnings: tier2Result.warnings,
        parseTier: 'llm',
      };
    }
  } catch {
    // Tier 2 failure is non-fatal — fall back to Tier 1 results
    return {
      ...tier1Result,
      warnings: [...tier1Result.warnings, 'LLM fallback failed — using regex results only.'],
      parseTier: 'regex',
    };
  }

  return { ...tier1Result, parseTier: 'regex' };
}

// ---------------------------------------------------------------------------
// Zod schemas for confirm mode (accepts preview data back from client)
// ---------------------------------------------------------------------------

const compoundResultSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  confidence: z.number(),
});

const labInfoSchema = z.object({
  labName: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  testDate: z.string().nullable(),
  confidence: z.number(),
});

const batchInfoSchema = z.object({
  batchNumber: z.string().nullable(),
  sampleId: z.string().nullable(),
  productName: z.string().nullable(),
  confidence: z.number(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const coaRouter = createTRPCRouter({
  /**
   * Parse a COA PDF (preview mode) or save a previously parsed COA (confirm mode).
   *
   * Preview mode (confirmed=false):
   *   Requires fileBase64. Extracts text, runs two-tier parser, returns results.
   *
   * Confirm mode (confirmed=true):
   *   Requires previewData (from the preview response). Saves to database.
   *   Does NOT re-parse — the user confirmed what they reviewed.
   */
  parseCOA: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      fileName: z.string().min(1).max(255),
      packageLabel: z.string().optional(),
      confirmed: z.boolean().default(false),
      // Preview mode: send the PDF
      fileBase64: z.string().min(1).max(MAX_BASE64_LENGTH).optional(),
      // Confirm mode: send the preview data back (no re-parsing)
      previewData: z.object({
        terpenes: z.array(compoundResultSchema),
        cannabinoids: z.array(compoundResultSchema),
        labInfo: labInfoSchema,
        batchInfo: batchInfoSchema,
        totalTerpenes: z.number().nullable(),
        totalCannabinoids: z.number().nullable(),
        overallConfidence: z.number(),
        warnings: z.array(z.string()),
        parseTier: z.enum(['regex', 'llm']),
        fileSize: z.number(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // --- PREVIEW MODE ---
      if (!input.confirmed) {
        if (!input.fileBase64) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'fileBase64 required for preview' });
        }

        const estimatedSize = Math.ceil(input.fileBase64.length * 0.75);
        if (estimatedSize > MAX_FILE_SIZE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
          });
        }

        const buffer = decodeAndValidatePDF(input.fileBase64);
        const pdfText = await extractPDFText(buffer);

        if (!pdfText || pdfText.trim().length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'PDF contains no extractable text. The file may be image-only or corrupted.',
          });
        }

        const result = await runParsingPipeline(pdfText, () => takeDemoQuestion(ctx));

        const preview = {
          fileName: input.fileName,
          fileSize: estimatedSize,
          packageLabel: input.packageLabel ?? null,
          parseTier: result.parseTier,
          parseConfidence: result.overallConfidence,
          terpeneCount: result.terpenes.length,
          cannabinoidCount: result.cannabinoids.length,
          terpenes: result.terpenes,
          cannabinoids: result.cannabinoids,
          labInfo: result.labInfo,
          batchInfo: result.batchInfo,
          totalTerpenes: result.totalTerpenes,
          totalCannabinoids: result.totalCannabinoids,
          warnings: result.warnings,
        };

        await ctx.prisma.actionLog.create({
          data: {
            facilityId: input.facilityId,
            userId: ctx.session.user.id,
            actionType: 'COA_UPLOAD',
            status: 'PREVIEWING',
            targetType: 'PACKAGE',
            targetIds: input.packageLabel ? [input.packageLabel] : [],
            targetCount: input.packageLabel ? 1 : 0,
            previewData: preview as unknown as Prisma.InputJsonValue,
          },
        });

        return { status: 'preview' as const, preview };
      }

      // --- CONFIRM MODE ---
      if (!input.previewData) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'previewData required for confirm' });
      }

      const data = input.previewData;

      // Parse test date for DB storage
      let testDate: Date | null = null;
      if (data.labInfo.testDate) {
        const parsed = new Date(data.labInfo.testDate);
        if (!isNaN(parsed.getTime())) {
          testDate = parsed;
        }
      }

      // Compute expiration date (1 year from test date is standard for COAs)
      let expirationDate: Date | null = null;
      if (testDate) {
        expirationDate = new Date(testDate);
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      }

      // Save COARecord — isExpired computed at query time, not stored
      const record = await ctx.prisma.cOARecord.create({
        data: {
          facilityId: input.facilityId,
          packageLabel: input.packageLabel ?? null,
          fileName: input.fileName,
          fileSize: data.fileSize,
          terpenes: data.terpenes as unknown as Prisma.InputJsonValue,
          cannabinoids: data.cannabinoids as unknown as Prisma.InputJsonValue,
          labInfo: data.labInfo as unknown as Prisma.InputJsonValue,
          batchInfo: data.batchInfo as unknown as Prisma.InputJsonValue,
          totalTerpenes: data.totalTerpenes,
          totalCannabinoids: data.totalCannabinoids,
          parseTier: data.parseTier,
          parseConfidence: data.overallConfidence,
          parseWarnings: data.warnings,
          status: 'PARSED',
          testDate,
          expirationDate,
          isExpired: expirationDate ? expirationDate < new Date() : false,
          createdBy: ctx.session.user.id,
        },
      });

      await ctx.prisma.actionLog.create({
        data: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          actionType: 'COA_UPLOAD',
          status: 'COMPLETED',
          targetType: 'PACKAGE',
          targetIds: input.packageLabel ? [input.packageLabel] : [],
          targetCount: input.packageLabel ? 1 : 0,
          executedAt: new Date(),
          metadata: { coaRecordId: record.id } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        status: 'completed' as const,
        recordId: record.id,
        parseTier: data.parseTier,
        parseConfidence: data.overallConfidence,
      };
    }),

  /**
   * List COA records for a facility with pagination and search.
   */
  getRecords: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ ctx, input }) => {
      const where: Prisma.COARecordWhereInput = {
        facilityId: input.facilityId,
      };

      if (input.status) {
        where.status = input.status;
      }

      if (input.search) {
        where.OR = [
          { fileName: { contains: input.search, mode: 'insensitive' } },
          { packageLabel: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await Promise.all([
        ctx.prisma.cOARecord.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.cOARecord.count({ where }),
      ]);

      // Compute isExpired at query time (Q8: don't rely on persisted boolean)
      const now = new Date();
      const enrichedItems = items.map(item => ({
        ...item,
        isExpired: item.expirationDate ? item.expirationDate < now : false,
      }));

      return {
        items: enrichedItems,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  /**
   * Get a single COA record by ID.
   */
  getRecord: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      recordId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const record = await ctx.prisma.cOARecord.findFirst({
        where: {
          id: input.recordId,
          facilityId: input.facilityId,
        },
      });

      if (!record) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'COA record not found',
        });
      }

      // Compute isExpired at query time
      return {
        ...record,
        isExpired: record.expirationDate ? record.expirationDate < new Date() : false,
      };
    }),

  /**
   * Get COAs expiring within N days (FOR-970 expiration tracking).
   * Also includes already-expired COAs (for compliance visibility).
   */
  getExpiring: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      withinDays: z.number().min(1).max(365).optional().default(30),
      includeExpired: z.boolean().optional().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + input.withinDays);

      const where: Prisma.COARecordWhereInput = {
        facilityId: input.facilityId,
        expirationDate: { not: null },
        status: { not: 'REJECTED' },
      };

      if (input.includeExpired) {
        // Already expired OR expiring within window
        where.expirationDate = { lte: futureDate };
      } else {
        // Only expiring soon (not yet expired)
        where.expirationDate = { gte: now, lte: futureDate };
      }

      const records = await ctx.prisma.cOARecord.findMany({
        where,
        orderBy: { expirationDate: 'asc' },
      });

      const enrichedRecords = records.map(r => ({
        ...r,
        isExpired: r.expirationDate ? r.expirationDate < now : false,
      }));

      return {
        items: enrichedRecords,
        total: enrichedRecords.length,
        expiredCount: enrichedRecords.filter(r => r.isExpired).length,
        expiringCount: enrichedRecords.filter(r => !r.isExpired).length,
        withinDays: input.withinDays,
      };
    }),
});
