import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { getDutchieClient } from '@/services/dutchie/dutchie-factory';
import { computeRunRates } from '@/services/engines/run-rate-engine';
import { getActivePackagesFromDb } from '@/services/metrc/snapshot-utils';
import type { MetrcFacility } from '@prisma/client';

export const runRatesRouter = createTRPCRouter({
  /**
   * Get inventory run-rate analysis: weeks-of-supply by category and SKU,
   * promo opportunities, and restock priorities.
   *
   * Reads active packages from PackageSnapshot DB (synced nightly) instead of
   * live Metrc API — eliminates 111 API calls per page load.
   */
  getRunRates: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string().optional(),
      daysLookback: z.number().min(1).max(3650).optional().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const metrcClient = getMetrcClient(facility);
      const dutchieClient = getDutchieClient(facility);

      // Read from PackageSnapshot DB (zero API calls). Cron syncs daily;
      // operator can trigger refresh via inventory.refreshFromMetrc.
      const packages = await getActivePackagesFromDb(ctx.prisma, input.facilityId);

      return computeRunRates(packages, dutchieClient, {
        category: input.category,
        daysLookback: input.daysLookback,
        metrcClient,
        prisma: ctx.prisma,
        facilityId: input.facilityId,
      });
    }),
});
