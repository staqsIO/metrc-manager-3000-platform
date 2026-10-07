import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import type { MetrcFacility } from '@prisma/client';
import { abbreviateTag } from '@/features/tags/utils';

/**
 * Tags router — manages Metrc tag inventory.
 *
 * Tags are Metrc-managed resources fetched live (cached 30s by MetrcCacheClient).
 * No local DB persistence needed. Provides inventory view, auto-suggest (FIFO),
 * and validation for use by processing and other mutation flows.
 */
export const tagsRouter = createTRPCRouter({
  /**
   * Get tag inventory with summary, filtering, and pagination.
   * Fetches all available tags and filters/paginates in memory.
   */
  getInventory: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
      search: z.string().optional(),
      tagType: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      // Intentional: fetch all tags (cached 30s) for accurate summary counts.
      // Server-side pagination via Metrc's API would lose the ability to compute
      // cross-page summaries. Acceptable for tag sets up to ~5K.
      const allTags = await client.getAvailableTags();

      // Build summary from unfiltered data
      const byType = new Map<string, number>();
      for (const tag of allTags) {
        const type = tag.TagTypeName || 'Unknown';
        byType.set(type, (byType.get(type) ?? 0) + 1);
      }
      const available = allTags.filter(t => t.StatusName === 'Available').length;
      const summary = {
        total: allTags.length,
        available,
        byType: Object.fromEntries(byType),
      };

      // Filter
      let filtered = [...allTags];
      if (input.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(t => t.Label.toLowerCase().includes(s));
      }
      if (input.tagType) {
        filtered = filtered.filter(t => t.TagTypeName === input.tagType);
      }

      // Sort by label ascending (oldest/lowest tags first)
      filtered.sort((a, b) => a.Label.localeCompare(b.Label));

      const total = filtered.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const tags = filtered.slice(start, start + input.pageSize).map(t => ({
        id: t.Id,
        label: t.Label,
        shortLabel: abbreviateTag(t.Label),
        tagType: t.TagTypeName,
        status: t.StatusName,
        usedDateTime: t.UsedDateTime,
      }));

      return { tags, total, page: input.page, pageSize: input.pageSize, totalPages, summary };
    }),

  /**
   * Get next N available tags sorted by label ascending (FIFO — oldest first).
   */
  getNextAvailable: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      count: z.number().min(1).max(50).optional().default(1),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const allTags = await client.getAvailableTags();

      const available = allTags
        .filter(t => t.StatusName === 'Available')
        .sort((a, b) => a.Label.localeCompare(b.Label))
        .slice(0, input.count)
        .map(t => ({
          id: t.Id,
          label: t.Label,
          shortLabel: abbreviateTag(t.Label),
          tagType: t.TagTypeName,
        }));

      return { tags: available };
    }),

  /**
   * Validate a specific tag label — checks existence and availability.
   */
  validateTag: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      tag: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);
      const allTags = await client.getAvailableTags();

      const match = allTags.find(t => t.Label === input.tag);
      if (!match) {
        return { valid: false, error: `Tag ${input.tag} not found in available tags` };
      }
      if (match.StatusName !== 'Available') {
        return {
          valid: false,
          error: `Tag ${input.tag} has status "${match.StatusName}" (expected "Available")`,
          tag: {
            id: match.Id,
            label: match.Label,
            shortLabel: abbreviateTag(match.Label),
            tagType: match.TagTypeName,
            status: match.StatusName,
            usedDateTime: match.UsedDateTime,
          },
        };
      }
      return {
        valid: true,
        tag: {
          id: match.Id,
          label: match.Label,
          shortLabel: abbreviateTag(match.Label),
          tagType: match.TagTypeName,
          status: match.StatusName,
          usedDateTime: match.UsedDateTime,
        },
      };
    }),
});
