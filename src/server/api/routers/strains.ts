import { z } from 'zod';
import { createTRPCRouter, facilityProcedure } from '@/lib/trpc';
import { prisma } from '@/lib/prisma';

/**
 * Phase 3: reads now come from StrainSnapshot / PackageSnapshot.
 * catalog-sync.ts keeps StrainSnapshot current; package-sync.ts keeps PackageSnapshot current.
 * Zero Metrc API calls on page load.
 */
export const strainsRouter = createTRPCRouter({
  getActive: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const where: Parameters<typeof prisma.strainSnapshot.findMany>[0] = {
        where: { facilityId: input.facilityId, isActive: true },
        orderBy: { name: 'asc' },
      };
      if (input.search) {
        where.where = {
          ...where.where,
          name: { contains: input.search, mode: 'insensitive' },
        };
      }
      const rows = await prisma.strainSnapshot.findMany(where);

      const strains = rows.map(s => ({
        id: s.metrcStrainId,
        name: s.name,
        testingStatus: s.testingStatus ?? null,
        indicaPercentage: s.indicaPercentage != null ? Number(s.indicaPercentage) : null,
        sativaPercentage: s.sativaPercentage != null ? Number(s.sativaPercentage) : null,
        thcLevel: s.thcLevel != null ? Number(s.thcLevel) : null,
        cbdLevel: s.cbdLevel != null ? Number(s.cbdLevel) : null,
      }));

      return { items: strains, total: strains.length };
    }),

  getSummary: facilityProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ input }) => {
      const [strains, packages] = await Promise.all([
        prisma.strainSnapshot.findMany({
          where: { facilityId: input.facilityId, isActive: true },
        }),
        prisma.packageSnapshot.findMany({
          where: { facilityId: input.facilityId, isActive: true },
          select: { itemStrainName: true },
        }),
      ]);

      const strainPackageCounts = new Map<string, number>();
      for (const pkg of packages) {
        const strain = pkg.itemStrainName || 'Unknown';
        strainPackageCounts.set(strain, (strainPackageCounts.get(strain) ?? 0) + 1);
      }

      const summary = strains.map(s => ({
        id: s.metrcStrainId,
        name: s.name,
        packageCount: strainPackageCounts.get(s.name) ?? 0,
        testingStatus: s.testingStatus ?? null,
        indicaPercentage: s.indicaPercentage != null ? Number(s.indicaPercentage) : null,
        sativaPercentage: s.sativaPercentage != null ? Number(s.sativaPercentage) : null,
      }));

      summary.sort((a, b) => b.packageCount - a.packageCount);

      return {
        totalStrains: strains.length,
        strainsInUse: summary.filter(s => s.packageCount > 0).length,
        strains: summary,
      };
    }),
});
