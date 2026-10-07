import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, facilityProcedure, facilityWriteProcedure } from '@/lib/trpc';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { executeMutationWithVerification } from '@/services/metrc/mutation-executor';
import { prisma } from '@/lib/prisma';
import type { MetrcFacility } from '@prisma/client';

/**
 * Catalog router — master list views for Strains, Items, and Locations,
 * plus create/update mutations for manual catalog management.
 *
 * Phase 3: reads come from StrainSnapshot / ItemSnapshot / LocationSnapshot /
 * PackageSnapshot / PlantBatchSnapshot. catalog-sync.ts keeps master lists
 * fresh (daily). Mutations still call Metrc inline (real-time compliance
 * requirement), and dedup checks also read from the snapshot tables.
 */
export const catalogRouter = createTRPCRouter({
  /**
   * Get strains master list with summary, search, and pagination.
   */
  getStrains: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ input }) => {
      const allStrains = await prisma.strainSnapshot.findMany({
        where: { facilityId: input.facilityId, isActive: true },
      });

      // Fallback: strain sync may not have populated StrainSnapshot for this
      // facility (Example Farms had 0 rows across 5 facilities pre-fix). Derive
      // the strain list from packageSnapshot.itemStrainName so the page
      // shows something useful instead of empty. Loses genotype + lab
      // attributes (THC/CBD/indica/sativa) but keeps name + package count.
      if (allStrains.length === 0) {
        const grouped = await prisma.packageSnapshot.groupBy({
          by: ['itemStrainName'],
          where: { facilityId: input.facilityId, isActive: true, itemStrainName: { not: null } },
          _count: { _all: true },
        });
        const derived = grouped
          .map((g) => ({ name: g.itemStrainName as string, packageCount: g._count._all }))
          .filter((s) => !!s.name);

        let filtered = derived;
        if (input.search) {
          const q = input.search.toLowerCase();
          filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
        }
        filtered.sort((a, b) => a.name.localeCompare(b.name));

        const total = filtered.length;
        const totalPages = Math.ceil(total / input.pageSize);
        const start = (input.page - 1) * input.pageSize;
        const strains = filtered.slice(start, start + input.pageSize).map((s, i) => ({
          id: -(start + i + 1), // negative synthetic ID so it can't collide with real metrcStrainIds
          name: s.name,
          indicaPercentage: 0,
          sativaPercentage: 0,
          thcLevel: 0,
          cbdLevel: 0,
          testingStatus: '',
        }));

        return {
          strains,
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages,
          summary: { total: derived.length, indicaCount: 0, sativaCount: 0, hybridCount: 0 },
          derived: true, // UI can show "derived from package data" badge if it wants
        };
      }

      let indicaCount = 0;
      let sativaCount = 0;
      let hybridCount = 0;
      for (const s of allStrains) {
        const indica = s.indicaPercentage != null ? Number(s.indicaPercentage) : 0;
        const sativa = s.sativaPercentage != null ? Number(s.sativaPercentage) : 0;
        if (indica > sativa) indicaCount++;
        else if (sativa > indica) sativaCount++;
        else hybridCount++;
      }
      const summary = {
        total: allStrains.length,
        indicaCount,
        sativaCount,
        hybridCount,
      };

      let filtered = [...allStrains];
      if (input.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(strain => strain.name.toLowerCase().includes(s));
      }

      filtered.sort((a, b) => a.name.localeCompare(b.name));

      const total = filtered.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const strains = filtered.slice(start, start + input.pageSize).map(s => ({
        id: s.metrcStrainId,
        name: s.name,
        indicaPercentage: s.indicaPercentage != null ? Number(s.indicaPercentage) : 0,
        sativaPercentage: s.sativaPercentage != null ? Number(s.sativaPercentage) : 0,
        thcLevel: s.thcLevel != null ? Number(s.thcLevel) : 0,
        cbdLevel: s.cbdLevel != null ? Number(s.cbdLevel) : 0,
        testingStatus: s.testingStatus ?? '',
      }));

      return { strains, total, page: input.page, pageSize: input.pageSize, totalPages, summary, derived: false };
    }),

  /**
   * Get items master list with summary, search, category filter, and pagination.
   */
  getItems: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      categoryFilter: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ input }) => {
      const allItems = await prisma.itemSnapshot.findMany({
        where: { facilityId: input.facilityId, isActive: true },
      });

      const categoryMap = new Map<string, number>();
      const uomSet = new Set<string>();
      for (const item of allItems) {
        const cat = item.productCategoryName || 'Uncategorized';
        categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
        if (item.unitOfMeasureName) uomSet.add(item.unitOfMeasureName);
      }

      const categories = Array.from(categoryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      const summary = {
        total: allItems.length,
        categoryCount: categoryMap.size,
        uomCount: uomSet.size,
        categories,
      };

      let filtered = [...allItems];
      if (input.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(item => item.name.toLowerCase().includes(s));
      }
      if (input.categoryFilter) {
        filtered = filtered.filter(item => item.productCategoryName === input.categoryFilter);
      }

      filtered.sort((a, b) => a.name.localeCompare(b.name));

      const total = filtered.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const items = filtered.slice(start, start + input.pageSize).map(item => ({
        id: item.metrcItemId,
        name: item.name,
        category: item.productCategoryName || 'Uncategorized',
        categoryType: item.productCategoryType || '',
        quantityType: item.quantityType || '',
        unitOfMeasure: item.unitOfMeasureName || '',
        strainName: item.strainName || '',
        testingState: item.defaultLabTestingState || '',
      }));

      return { items, total, page: input.page, pageSize: input.pageSize, totalPages, summary };
    }),

  /**
   * Get locations from Metrc API with package/batch counts.
   * Uses getActiveLocations() for real location IDs, enriched with
   * package and batch counts from active data.
   */
  getLocations: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      search: z.string().optional(),
      page: z.number().min(1).optional().default(1),
      pageSize: z.number().min(1).max(100).optional().default(25),
    }))
    .query(async ({ input }) => {
      const [metrcLocations, packages, batches] = await Promise.all([
        prisma.locationSnapshot.findMany({
          where: { facilityId: input.facilityId, isActive: true },
        }),
        prisma.packageSnapshot.findMany({
          where: { facilityId: input.facilityId, isActive: true },
          select: { locationName: true },
        }),
        prisma.plantBatchSnapshot.findMany({
          where: { facilityId: input.facilityId, isActive: true },
          select: { locationName: true },
        }),
      ]);

      const pkgByLocation = new Map<string, number>();
      for (const pkg of packages) {
        const loc = pkg.locationName || '';
        if (loc) pkgByLocation.set(loc, (pkgByLocation.get(loc) ?? 0) + 1);
      }

      const batchByLocation = new Map<string, number>();
      for (const batch of batches) {
        const loc = batch.locationName || '';
        if (loc) batchByLocation.set(loc, (batchByLocation.get(loc) ?? 0) + 1);
      }

      // Fallback: if catalog sync has not yet populated LocationSnapshot (e.g. Metrc v1
      // deprecation, or fresh facility before first catalog-sync run), derive from
      // package/batch data so the locations page is never empty.
      let locations: { id: number; name: string; locationTypeName: string; packageCount: number; batchCount: number }[];
      if (metrcLocations.length > 0) {
        locations = metrcLocations.map(loc => ({
          id: loc.metrcLocationId,
          name: loc.name,
          locationTypeName: loc.locationTypeName ?? 'Default',
          packageCount: pkgByLocation.get(loc.name) ?? 0,
          batchCount: batchByLocation.get(loc.name) ?? 0,
        }));
      } else {
        const allLocationNames = new Set<string>();
        for (const name of Array.from(pkgByLocation.keys())) allLocationNames.add(name);
        for (const name of Array.from(batchByLocation.keys())) allLocationNames.add(name);
        let syntheticId = 1;
        locations = Array.from(allLocationNames).map(name => ({
          id: syntheticId++,
          name,
          locationTypeName: 'Default',
          packageCount: pkgByLocation.get(name) ?? 0,
          batchCount: batchByLocation.get(name) ?? 0,
        }));
      }

      const summary = {
        totalLocations: locations.length,
        totalPackages: packages.length,
        totalBatches: batches.length,
      };

      if (input.search) {
        const s = input.search.toLowerCase();
        locations = locations.filter(loc => loc.name.toLowerCase().includes(s));
      }

      locations.sort((a, b) => a.name.localeCompare(b.name));

      const total = locations.length;
      const totalPages = Math.ceil(total / input.pageSize);
      const start = (input.page - 1) * input.pageSize;
      const paged = locations.slice(start, start + input.pageSize);

      return { locations: paged, total, page: input.page, pageSize: input.pageSize, totalPages, summary };
    }),

  // ── Mutations ──

  createStrain: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(100),
      indicaPercentage: z.number().min(0).max(100).optional().default(0),
      sativaPercentage: z.number().min(0).max(100).optional().default(0),
      thcLevel: z.number().min(0).optional().default(0),
      cbdLevel: z.number().min(0).optional().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Validate indica + sativa <= 100
      if (input.indicaPercentage + input.sativaPercentage > 100) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Indica + Sativa percentages cannot exceed 100%',
        });
      }

      // Dedup: check StrainSnapshot (synced daily). Metrc will also reject true duplicates.
      const duplicate = await prisma.strainSnapshot.findFirst({
        where: {
          facilityId: input.facilityId,
          isActive: true,
          name: { equals: input.name, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Strain "${duplicate.name}" already exists (ID: ${duplicate.metrcStrainId})`,
        });
      }

      const payload = [{
        Name: input.name,
        TestingStatus: 'None',
        ThcLevel: input.thcLevel,
        CbdLevel: input.cbdLevel,
        IndicaPercentage: input.indicaPercentage,
        SativaPercentage: input.sativaPercentage,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'CREATE_STRAIN',
        targetType: 'STRAIN',
        targetIds: [input.name],
        targetCount: 1,
        executeFn: () => client.createStrains(payload),
      });

      return { status: result.status, name: input.name };
    }),

  updateStrain: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      indicaPercentage: z.number().min(0).max(100).optional(),
      sativaPercentage: z.number().min(0).max(100).optional(),
      thcLevel: z.number().min(0).optional(),
      cbdLevel: z.number().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Fetch current strain from snapshot for beforeState + merge
      const snapshot = await prisma.strainSnapshot.findUnique({
        where: { facilityId_metrcStrainId: { facilityId: input.facilityId, metrcStrainId: input.id } },
      });
      if (!snapshot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Strain with ID ${input.id} not found`,
        });
      }
      const currentIndica = snapshot.indicaPercentage != null ? Number(snapshot.indicaPercentage) : 0;
      const currentSativa = snapshot.sativaPercentage != null ? Number(snapshot.sativaPercentage) : 0;
      const currentThc = snapshot.thcLevel != null ? Number(snapshot.thcLevel) : 0;
      const currentCbd = snapshot.cbdLevel != null ? Number(snapshot.cbdLevel) : 0;

      const indica = input.indicaPercentage ?? currentIndica;
      const sativa = input.sativaPercentage ?? currentSativa;
      if (indica + sativa > 100) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Indica + Sativa percentages cannot exceed 100%',
        });
      }

      const payload = {
        Id: input.id,
        Name: input.name ?? snapshot.name,
        IndicaPercentage: input.indicaPercentage ?? currentIndica,
        SativaPercentage: input.sativaPercentage ?? currentSativa,
        ThcLevel: input.thcLevel ?? currentThc,
        CbdLevel: input.cbdLevel ?? currentCbd,
      };
      const current = snapshot;

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'UPDATE_STRAIN',
        targetType: 'STRAIN',
        targetIds: [String(input.id)],
        targetCount: 1,
        executeFn: () => client.updateStrains([payload]),
        beforeState: current,
      });

      return { status: result.status, id: input.id };
    }),

  createItem: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(150),
      itemCategory: z.string().min(1),
      unitOfMeasure: z.string().min(1),
      strain: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Dedup: check ItemSnapshot (synced daily). Metrc will also reject true duplicates.
      const duplicate = await prisma.itemSnapshot.findFirst({
        where: {
          facilityId: input.facilityId,
          isActive: true,
          name: { equals: input.name, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Item "${duplicate.name}" already exists (ID: ${duplicate.metrcItemId})`,
        });
      }

      const payload: Record<string, unknown> = {
        Name: input.name,
        ItemCategory: input.itemCategory,
        UnitOfMeasure: input.unitOfMeasure,
      };
      if (input.strain) {
        payload.StrainName = input.strain;
      }

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'CREATE_ITEM',
        targetType: 'ITEM',
        targetIds: [input.name],
        targetCount: 1,
        executeFn: () => client.createItems([payload]),
      });

      return { status: result.status, name: input.name };
    }),

  updateItem: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      id: z.number(),
      name: z.string().min(1).max(150).optional(),
      itemCategory: z.string().optional(),
      unitOfMeasure: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      // Fetch current item from snapshot for beforeState + merge
      const current = await prisma.itemSnapshot.findUnique({
        where: { facilityId_metrcItemId: { facilityId: input.facilityId, metrcItemId: input.id } },
      });
      if (!current) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Item with ID ${input.id} not found`,
        });
      }

      const payload = {
        Id: input.id,
        Name: input.name ?? current.name,
        ItemCategory: input.itemCategory ?? current.productCategoryName ?? '',
        UnitOfMeasure: input.unitOfMeasure ?? current.unitOfMeasureName ?? '',
      };

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'UPDATE_ITEM',
        targetType: 'ITEM',
        targetIds: [String(input.id)],
        targetCount: 1,
        executeFn: () => client.updateItems([payload]),
        beforeState: current,
      });

      return { status: result.status, id: input.id };
    }),

  createLocation: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      name: z.string().min(1).max(150),
      locationTypeName: z.string().optional().default('Default Location Type'),
    }))
    .mutation(async ({ ctx, input }) => {
      const facility = ctx.facility as MetrcFacility;
      const client = getMetrcClient(facility);

      const payload = [{
        Name: input.name,
        LocationTypeName: input.locationTypeName,
      }];

      const result = await executeMutationWithVerification({
        prisma: ctx.prisma,
        facilityId: input.facilityId,
        userId: ctx.session.user.id,
        actionType: 'CREATE_LOCATION',
        targetType: 'LOCATION',
        targetIds: [input.name],
        targetCount: 1,
        executeFn: () => client.createLocations(payload),
      });

      return { status: result.status, name: input.name };
    }),
});
