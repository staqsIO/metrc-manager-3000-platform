import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc';

/**
 * Per-call Metrc API observability — read-only stats over `MetrcApiCall` rows.
 *
 * Admin-gated: matches the gate used in `admin.ts`
 * (`ctx.session.user.isPlatformAdmin`).
 *
 * Aggregation is performed in-process. With per-facility row volumes typically
 * <50k/day and `days <= 90`, the materialized scan + JS reduce is faster and
 * simpler than a raw-SQL `percentile_cont`. If volumes grow, switch the inner
 * read to `prisma.$queryRaw` against `metrc_api_calls` with `percentile_cont`.
 */
const InputSchema = z.object({
  facilityId: z.string().min(1),
  days: z.number().int().min(1).max(90).default(7),
});

interface CallRow {
  endpoint: string;
  statusCode: number | null;
  durationMs: number;
  ts: Date;
  remainingQuota: number | null;
  error: string | null;
}

interface EndpointStats {
  endpoint: string;
  count: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorRate: number;
  lastRemainingQuota: number | null;
}

function aggregate(rows: CallRow[]): EndpointStats[] {
  const groups = new Map<string, CallRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.endpoint);
    if (arr) arr.push(r);
    else groups.set(r.endpoint, [r]);
  }
  const result: EndpointStats[] = [];
  groups.forEach((calls: CallRow[], endpoint: string) => {
    const count = calls.length;
    let totalDuration = 0;
    let errors = 0;
    for (const c of calls) {
      totalDuration += c.durationMs;
      // Treat any non-2xx as an error; null statusCode + non-null error counts.
      if (c.error != null || (c.statusCode != null && (c.statusCode < 200 || c.statusCode >= 300))) {
        errors += 1;
      }
    }
    const sortedDurations = calls.map((c: CallRow) => c.durationMs).sort((a: number, b: number) => a - b);
    // p95 — nearest-rank: ceil(0.95 * n) - 1 (0-indexed).
    const p95Index = Math.max(0, Math.ceil(0.95 * sortedDurations.length) - 1);
    const p95DurationMs = sortedDurations[p95Index] ?? 0;
    // Latest non-null remainingQuota wins. Sort by ts desc.
    const sortedByTs = [...calls].sort((a: CallRow, b: CallRow) => b.ts.getTime() - a.ts.getTime());
    const lastRemainingQuota =
      sortedByTs.find((c: CallRow) => c.remainingQuota != null)?.remainingQuota ?? null;

    result.push({
      endpoint,
      count,
      avgDurationMs: count > 0 ? totalDuration / count : 0,
      p95DurationMs,
      errorRate: count > 0 ? errors / count : 0,
      lastRemainingQuota,
    });
  });
  // Sort most-frequent endpoint first for predictable UI order.
  result.sort((a: EndpointStats, b: EndpointStats) => b.count - a.count);
  return result;
}

export const observabilityRouter = createTRPCRouter({
  getApiCallStats: protectedProcedure
    .input(InputSchema)
    .query(async ({ ctx, input }): Promise<EndpointStats[]> => {
      if (!ctx.session.user.isPlatformAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' });
      }
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await ctx.prisma.metrcApiCall.findMany({
        where: {
          facilityId: input.facilityId,
          ts: { gte: since },
        },
        select: {
          endpoint: true,
          statusCode: true,
          durationMs: true,
          ts: true,
          remainingQuota: true,
          error: true,
        },
      });
      return aggregate(rows as CallRow[]);
    }),
});
