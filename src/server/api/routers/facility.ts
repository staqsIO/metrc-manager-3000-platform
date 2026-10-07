import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, platformProcedure, facilityProcedure, facilityWriteProcedure, facilityAdminProcedure } from '@/lib/trpc';
import { dashboardPrisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { getMetrcClient, clearClientCache, clearUserClientCache } from '@/services/metrc/metrc-factory';
import { resetCircuitBreaker } from '@/services/metrc/metrc-cache';
import { getDutchieClient, clearDutchieClientCache } from '@/services/dutchie/dutchie-factory';
import { getCanixClient, clearCanixClientCache } from '@/services/canix/canix-factory';
import { getUserOrgIds, bumpJwtInvalidatedAt } from '@/lib/auth-helpers';
import { FACILITY_TYPE_VALUES } from '@/shared/constants/facility-types';
import { computeDataFidelity } from '@/services/engines/data-fidelity';
import { assertFacilityEnvironmentAllowed } from '@/services/tenant';

const metrcEnvironmentSchema = z.enum(['mock', 'sandbox', 'production']);
const facilityTypeSchema = z.enum(FACILITY_TYPE_VALUES).optional();

/** Whitelist of non-credential fields for client-facing queries. */
const FACILITY_PUBLIC_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  licenseNumber: true,
  stateCode: true,
  facilityType: true,
  metrcEnvironment: true,
  metrcKeyAccess: true,
  sandboxMetrcKeyAccess: true,
  requirePerUserCredentials: true,
  dutchieEnvironment: true,
  dutchieFacilityTypes: true,
  canixEnvironment: true,
  canixFacilityId: true,
  licenseExpiryDate: true,
  isActive: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  syncErrorMessage: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** FOR-1172: Filter facilities by user's facility-level access grants (if any). */
function filterByFacilityAccess<T extends { id: string }>(
  facilities: T[],
  facilityAccess: Record<string, string>,
): T[] {
  if (Object.keys(facilityAccess).length === 0) return facilities;
  const allowedIds = new Set(Object.keys(facilityAccess));
  return facilities.filter(f => allowedIds.has(f.id));
}

export const facilityRouter = createTRPCRouter({
  /**
   * List all facilities for the current user's organization.
   * Returns only public fields — no encrypted credentials.
   */
  list: platformProcedure.query(async ({ ctx }) => {
    const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

    // Scope to active org if set and user is a member; otherwise show all orgs
    const scoped = ctx.activeOrgId && orgIds.includes(ctx.activeOrgId);
    const scopedOrgIds = scoped ? [ctx.activeOrgId!] : orgIds;

    let facilities = await ctx.prisma.metrcFacility.findMany({
      where: {
        organizationId: { in: scopedOrgIds },
        isActive: true,
      },
      select: FACILITY_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    // FOR-1172: Filter by facility-level access grants
    facilities = filterByFacilityAccess(facilities, ctx.session.user?.facilityAccess ?? {});

    return facilities;
  }),

  /**
   * List facilities with computed health scores.
   * Fetches open ComplianceAlert counts and latest AuditSnapshot scores,
   * then computes a 0-100 health score per facility.
   */
  listWithHealth: platformProcedure
    .input(z.object({
      includeInactive: z.boolean().optional().default(false),
    }).optional())
    .query(async ({ ctx, input }) => {
    const includeInactive = input?.includeInactive ?? false;
    const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

    const scoped = ctx.activeOrgId && orgIds.includes(ctx.activeOrgId);
    const scopedOrgIds = scoped ? [ctx.activeOrgId!] : orgIds;

    let facilities = await ctx.prisma.metrcFacility.findMany({
      where: {
        organizationId: { in: scopedOrgIds },
        ...(!includeInactive && { isActive: true }),
      },
      select: FACILITY_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    // FOR-1172: Filter by facility-level access grants
    facilities = filterByFacilityAccess(facilities, ctx.session.user?.facilityAccess ?? {});

    if (facilities.length === 0) return [];

    const facilityIds = facilities.map((f) => f.id);

    // Fetch open alert counts per facility, split by severity.
    // Also expose totals in alertMap for backward compatibility.
    const alertCounts = await ctx.prisma.complianceAlert.groupBy({
      by: ['facilityId', 'severity'],
      where: {
        facilityId: { in: facilityIds },
        status: 'OPEN',
      },
      _count: { id: true },
    });

    const alertMap = new Map<string, number>();
    const alertBreakdownMap = new Map<string, { critical: number; warning: number; info: number }>();
    for (const row of alertCounts) {
      const facilityId = row.facilityId;
      const count = row._count.id;
      const sev = row.severity.toUpperCase();
      alertMap.set(facilityId, (alertMap.get(facilityId) ?? 0) + count);
      const bucket = alertBreakdownMap.get(facilityId) ?? { critical: 0, warning: 0, info: 0 };
      if (sev === 'CRITICAL') bucket.critical += count;
      else if (sev === 'INFO') bucket.info += count;
      else bucket.warning += count; // Default/unknown severity → warning bucket.
      alertBreakdownMap.set(facilityId, bucket);
    }

    // Surface the freshest sync timestamp from sync_watermarks. The denormalised
    // MetrcFacility.lastSyncAt / lastSyncStatus columns are only updated by the
    // legacy runFullSync orchestrator (Vercel cron), which has been superseded
    // by per-entity incremental cron endpoints that write SyncWatermark instead.
    // Without this override the UI shows a frozen April-17 timestamp even when
    // the incremental crons ran 30 minutes ago.
    const watermarkRows = await ctx.prisma.syncWatermark.findMany({
      where: {
        facilityId: { in: facilityIds },
        lastRunAt: { not: null },
      },
      orderBy: { lastRunAt: 'desc' },
      select: { facilityId: true, lastRunAt: true, lastRunStatus: true },
    });

    const latestWatermarkByFacility = new Map<
      string,
      { lastRunAt: Date; lastRunStatus: string | null }
    >();
    for (const row of watermarkRows) {
      if (!row.lastRunAt) continue;
      if (latestWatermarkByFacility.has(row.facilityId)) continue;
      latestWatermarkByFacility.set(row.facilityId, {
        lastRunAt: row.lastRunAt,
        lastRunStatus: row.lastRunStatus,
      });
    }

    return facilities.map((facility) => {
      const alertCount = alertMap.get(facility.id) ?? 0;
      const alertBreakdown = alertBreakdownMap.get(facility.id) ?? { critical: 0, warning: 0, info: 0 };
      const watermark = latestWatermarkByFacility.get(facility.id);
      // Watermark statuses are lowercase ('success' | 'partial' | 'failed' | 'skipped').
      // Legacy UI checks against 'SUCCESS' / 'FAILED' so we uppercase to match.
      const lastSyncAt = watermark?.lastRunAt ?? facility.lastSyncAt;
      const lastSyncStatus = watermark?.lastRunStatus
        ? watermark.lastRunStatus.toUpperCase()
        : facility.lastSyncStatus;
      return { ...facility, lastSyncAt, lastSyncStatus, alertCount, alertBreakdown };
    });
  }),

  /**
   * Get a single facility by ID, validating the user's org owns it.
   * Returns only public fields — no encrypted credentials.
   */
  getById: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      // FOR-1172: Check facility-level access if grants exist
      const facilityAccess: Record<string, string> = ctx.session.user?.facilityAccess ?? {};
      if (Object.keys(facilityAccess).length > 0 && !facilityAccess[input.facilityId]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found or access denied' });
      }

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
        select: FACILITY_PUBLIC_SELECT,
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      return facility;
    }),

  /**
   * Compute the data fidelity profile for a facility.
   * Returns which data layers are connected and what enrichment is possible.
   * Used by ProgressiveMetric, EnrichmentPrompt, and Copilot to adapt
   * rendering/responses based on data availability.
   */
  getDataFidelity: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
        select: {
          metrcEnvironment: true,
          dutchieEnvironment: true,
          canixEnvironment: true,
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      // Two cheap count queries to check for manual data entries
      const [opexCount, supplyCount] = await Promise.all([
        ctx.prisma.opExModel.count({
          where: { facilityId: input.facilityId },
          take: 1, // Only need to know if any exist
        }),
        ctx.prisma.supplyItem.count({
          where: { facilityId: input.facilityId },
          take: 1,
        }),
      ]);

      return computeDataFidelity(facility, opexCount > 0, supplyCount > 0);
    }),

  /**
   * Get all operator benchmarks for a facility, optionally filtered by category.
   * Used to load configurable thresholds (aging windows, yield targets, etc.).
   */
  getBenchmarks: facilityProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.operatorBenchmark.findMany({
        where: {
          facilityId: input.facilityId,
          ...(input.category ? { category: input.category } : {}),
        },
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      });
    }),

  /**
   * Upsert an operator benchmark (threshold, target, or cost basis).
   * Requires OPERATOR role via facilityWriteProcedure.
   */
  setBenchmark: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      category: z.string(),
      key: z.string(),
      value: z.number(),
      unit: z.string().optional(),
      label: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.operatorBenchmark.upsert({
        where: {
          facilityId_category_key: {
            facilityId: input.facilityId,
            category: input.category,
            key: input.key,
          },
        },
        update: {
          value: input.value,
          unit: input.unit,
          label: input.label,
          notes: input.notes,
        },
        create: {
          facilityId: input.facilityId,
          category: input.category,
          key: input.key,
          value: input.value,
          unit: input.unit,
          label: input.label,
          notes: input.notes,
        },
      });
    }),

  /**
   * Delete an operator benchmark. Requires OPERATOR role.
   */
  deleteBenchmark: facilityWriteProcedure
    .input(z.object({
      facilityId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.operatorBenchmark.delete({
        where: { id: input.id, facilityId: input.facilityId },
      });
    }),

  /**
   * Returns boolean flags for whether each credential slot is configured.
   * Never exposes actual ciphertext to the client.
   */
  credentialStatus: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
        select: {
          encryptedVendorApiKey: true,
          encryptedUserApiKey: true,
          encryptedSandboxVendorApiKey: true,
          encryptedSandboxUserApiKey: true,
          encryptedDutchieLocationKey: true,
          encryptedDutchieSandboxLocationKey: true,
          encryptedCanixApiKey: true,
          encryptedCanixSandboxApiKey: true,
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      return {
        metrc: {
          hasProductionVendorKey: !!facility.encryptedVendorApiKey,
          hasProductionUserKey: !!facility.encryptedUserApiKey,
          hasSandboxVendorKey: !!facility.encryptedSandboxVendorApiKey,
          hasSandboxUserKey: !!facility.encryptedSandboxUserApiKey,
        },
        dutchie: {
          hasProductionLocationKey: !!facility.encryptedDutchieLocationKey,
          hasSandboxLocationKey: !!facility.encryptedDutchieSandboxLocationKey,
        },
        canix: {
          hasProductionApiKey: !!facility.encryptedCanixApiKey,
          hasSandboxApiKey: !!facility.encryptedCanixSandboxApiKey,
        },
      };
    }),

  /**
   * Create a new MetrcFacility for the user's organization.
   */
  create: platformProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Facility name is required'),
        licenseNumber: z.string().min(1, 'License number is required'),
        stateCode: z.string().length(2, 'State code must be 2 characters'),
        facilityType: facilityTypeSchema,
        metrcEnvironment: metrcEnvironmentSchema.default('mock'),
        organizationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      // Priority: explicit input > active org cookie > first org
      const scoped = ctx.activeOrgId && orgIds.includes(ctx.activeOrgId);
      const targetOrgId = input.organizationId ?? (scoped ? ctx.activeOrgId! : orgIds[0]);
      if (!orgIds.includes(targetOrgId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
      }

      // ADR-020 Phase 3: DEMO/TEST orgs cannot host facilities wired to real Metrc.
      await assertFacilityEnvironmentAllowed(dashboardPrisma, targetOrgId, input.metrcEnvironment);

      try {
        const facility = await ctx.prisma.metrcFacility.create({
          data: {
            organizationId: targetOrgId,
            name: input.name,
            licenseNumber: input.licenseNumber,
            stateCode: input.stateCode.toUpperCase(),
            facilityType: input.facilityType,
            metrcEnvironment: input.metrcEnvironment,
          },
        });

        return facility;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `A facility with license number "${input.licenseNumber}" already exists in this organization.`,
            });
          }
          if (err.code === 'P2003') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Organization not found. Please refresh and try again.',
            });
          }
        }
        throw err;
      }
    }),

  /**
   * Update an existing facility. Validates ownership via user's org.
   */
  update: platformProcedure
    .input(
      z.object({
        facilityId: z.string(),
        name: z.string().min(1).optional(),
        licenseNumber: z.string().min(1).optional(),
        stateCode: z.string().length(2).optional(),
        facilityType: facilityTypeSchema,
        licenseExpiryDate: z.string().datetime().nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      // Verify facility belongs to any of user's orgs
      const existing = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const { facilityId, licenseExpiryDate: expiryDateStr, ...updateData } = input;

      // Normalize stateCode to uppercase if provided
      if (updateData.stateCode) {
        updateData.stateCode = updateData.stateCode.toUpperCase();
      }

      const facility = await ctx.prisma.metrcFacility.update({
        where: { id: facilityId },
        data: {
          ...updateData,
          ...(expiryDateStr !== undefined && {
            licenseExpiryDate: expiryDateStr ? new Date(expiryDateStr) : null,
          }),
        },
      });

      return facility;
    }),

  /**
   * Soft-delete a facility by setting isActive to false.
   */
  delete: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      // Verify facility belongs to any of user's orgs
      const existing = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const facility = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data: { isActive: false },
      });

      return facility;
    }),

  /**
   * Set Metrc API credentials for a facility. Credentials are AES-encrypted at rest.
   * Accepts an `environment` parameter to store sandbox or production credentials separately.
   */
  setCredentials: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      vendorApiKey: z.string().min(1).optional(),
      userApiKey: z.string().min(1),
      environment: z.enum(['sandbox', 'production']).default('production'),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      // Build update data — vendor key is optional (resolved from env vars at runtime)
      const data: Record<string, string> = {};
      if (input.environment === 'sandbox') {
        if (input.vendorApiKey) data.encryptedSandboxVendorApiKey = encrypt(input.vendorApiKey);
        data.encryptedSandboxUserApiKey = encrypt(input.userApiKey);
      } else {
        if (input.vendorApiKey) data.encryptedVendorApiKey = encrypt(input.vendorApiKey);
        data.encryptedUserApiKey = encrypt(input.userApiKey);
      }

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data,
      });

      // Clear cached client + circuit breaker so new credentials take effect immediately
      clearClientCache(input.facilityId);
      resetCircuitBreaker(input.facilityId);

      return { success: true, facilityId: updated.id };
    }),

  /**
   * Test the Metrc API connection for a facility.
   * In mock mode, returns success immediately.
   * In sandbox/production, attempts to fetch active packages as a connectivity test.
   */
  testConnection: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      if (facility.metrcEnvironment === 'mock') {
        return { success: true, message: 'Mock mode active', packageCount: 0 };
      }

      // Check credentials for current environment
      const isSandbox = facility.metrcEnvironment === 'sandbox';
      const hasCredentials = isSandbox
        ? !!(facility.encryptedSandboxVendorApiKey && facility.encryptedSandboxUserApiKey)
        : !!(facility.encryptedVendorApiKey && facility.encryptedUserApiKey);

      if (!hasCredentials) {
        return {
          success: false,
          message: `${isSandbox ? 'Sandbox' : 'Production'} API credentials not configured. Set credentials first.`,
        };
      }

      try {
        // Clear cached client + circuit breaker to ensure fresh auth config
        clearClientCache(input.facilityId);
        resetCircuitBreaker(input.facilityId);
        const client = getMetrcClient(facility);
        const packages = await client.getActivePackages();

        // Probe additional endpoints to detect read-only vs full access.
        // Only test endpoints the facility type actually supports — e.g., a Manufacturer
        // doesn't have sales or harvest access, so probing those would incorrectly mark
        // a valid read/write key as "readonly".
        let detectedAccess: 'full' | 'readonly' = 'full';
        const probes: Promise<unknown>[] = [];
        const fType = facility.facilityType;
        if (!fType || fType === 'Cultivator' || fType === 'Microbusiness') {
          probes.push(client.getActiveHarvests());
        }
        if (!fType || fType === 'Dispensary' || fType === 'Microbusiness') {
          probes.push(client.getSalesReceipts());
        }
        // For Manufacturers and other types without harvests/sales, probe transfers
        if (probes.length === 0) {
          probes.push(client.getOutgoingTransfers());
        }
        try {
          await Promise.all(probes);
        } catch {
          detectedAccess = 'readonly';
        }

        // Persist the detected access level
        const accessField = isSandbox ? 'sandboxMetrcKeyAccess' : 'metrcKeyAccess';
        await ctx.prisma.metrcFacility.update({
          where: { id: input.facilityId },
          data: { [accessField]: detectedAccess },
        });

        return {
          success: true,
          message: `${isSandbox ? 'Sandbox' : 'Production'} connection successful`,
          packageCount: packages.length,
          metrcKeyAccess: detectedAccess,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown connection error';
        return { success: false, message: msg };
      }
    }),

  /**
   * Set the Metrc environment for a facility (mock, sandbox, or production).
   * Validates that credentials exist before switching to sandbox or production.
   */
  setEnvironment: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      environment: metrcEnvironmentSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      // ADR-020 Phase 3: a DEMO/TEST org cannot flip a facility to sandbox/production.
      await assertFacilityEnvironmentAllowed(dashboardPrisma, facility.organizationId, input.environment);

      // Validate credentials exist for target environment
      if (input.environment === 'sandbox') {
        if (!facility.encryptedSandboxVendorApiKey || !facility.encryptedSandboxUserApiKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Sandbox credentials must be configured before switching to sandbox mode.',
          });
        }
      } else if (input.environment === 'production') {
        if (!facility.encryptedVendorApiKey || !facility.encryptedUserApiKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Production credentials must be configured before switching to production mode.',
          });
        }
      }

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data: { metrcEnvironment: input.environment },
      });

      // Clear client cache + circuit breaker when switching environments
      clearClientCache(input.facilityId);
      resetCircuitBreaker(input.facilityId);

      return updated;
    }),

  // ==========================================================
  // Dutchie POS Integration
  // ==========================================================

  /**
   * Set Dutchie POS API key for a facility.
   * Auth token is fetched server-side via /util/AuthorizationHeader/{apiKey}.
   * The key is AES-encrypted at rest.
   */
  setDutchieCredentials: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      apiKey: z.string().min(1),
      environment: z.enum(['sandbox', 'production']).default('production'),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const data = input.environment === 'sandbox'
        ? { encryptedDutchieSandboxLocationKey: encrypt(input.apiKey) }
        : { encryptedDutchieLocationKey: encrypt(input.apiKey) };

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data,
      });

      clearDutchieClientCache(input.facilityId, facility.stateCode);

      return { success: true, facilityId: updated.id };
    }),

  /**
   * Set the Dutchie environment for a facility (mock, sandbox, or production).
   * Validates that credentials exist before switching to sandbox or production.
   */
  setDutchieEnvironment: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      environment: z.enum(['none', 'mock', 'sandbox', 'production']),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      if (input.environment === 'sandbox') {
        if (!facility.encryptedDutchieSandboxLocationKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Dutchie sandbox API Key must be configured before switching to sandbox mode.',
          });
        }
      } else if (input.environment === 'production') {
        if (!facility.encryptedDutchieLocationKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Dutchie production API Key must be configured before switching to production mode.',
          });
        }
      }

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data: { dutchieEnvironment: input.environment },
      });

      clearDutchieClientCache(input.facilityId, facility.stateCode);

      return updated;
    }),

  /**
   * Test the Dutchie POS API connection for a facility.
   * In mock mode, returns success immediately.
   * In sandbox/production, calls /whoami to verify the API key and location access.
   */
  testDutchieConnection: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const dutchieEnv = facility.dutchieEnvironment ?? 'mock';

      if (dutchieEnv === 'mock') {
        return { success: true, message: 'Mock mode active' };
      }

      const isSandbox = dutchieEnv === 'sandbox';
      const hasCredentials = isSandbox
        ? !!facility.encryptedDutchieSandboxLocationKey
        : !!facility.encryptedDutchieLocationKey;

      if (!hasCredentials) {
        return {
          success: false,
          message: `Dutchie ${isSandbox ? 'sandbox' : 'production'} API key not configured. Set API key first.`,
        };
      }

      try {
        const client = getDutchieClient(facility);
        const identity = await client.whoami();
        return {
          success: true,
          message: `Dutchie ${isSandbox ? 'sandbox' : 'production'} connected — ${identity.LocationName}`,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown connection error';
        return { success: false, message: msg };
      }
    }),

  // ==========================================================
  // Canix ERP Integration
  // ==========================================================

  /**
   * Store an encrypted Canix API key for a facility.
   * Canix uses a company-level API key via X-API-KEY header.
   */
  setCanixCredentials: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      apiKey: z.string().min(1),
      environment: z.enum(['sandbox', 'production']).default('production'),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const data = input.environment === 'sandbox'
        ? { encryptedCanixSandboxApiKey: encrypt(input.apiKey) }
        : { encryptedCanixApiKey: encrypt(input.apiKey) };

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data,
      });

      clearCanixClientCache(input.facilityId);

      return { success: true, facilityId: updated.id };
    }),

  /**
   * Set the Canix environment for a facility (none, mock, sandbox, or production).
   * Validates that credentials exist before switching to sandbox or production.
   */
  setCanixEnvironment: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      environment: z.enum(['none', 'mock', 'sandbox', 'production']),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      if (input.environment === 'sandbox') {
        if (!facility.encryptedCanixSandboxApiKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Canix sandbox API key must be configured before switching to sandbox mode.',
          });
        }
      } else if (input.environment === 'production') {
        if (!facility.encryptedCanixApiKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Canix production API key must be configured before switching to production mode.',
          });
        }
      }

      const updated = await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data: { canixEnvironment: input.environment },
      });

      clearCanixClientCache(input.facilityId);

      return updated;
    }),

  /**
   * Test the Canix ERP API connection for a facility.
   * In mock mode, returns success immediately.
   * In sandbox/production, calls /whoami to verify the API key.
   */
  testCanixConnection: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: {
          id: input.facilityId,
          organizationId: { in: orgIds },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Facility not found or access denied',
        });
      }

      const canixEnv = facility.canixEnvironment ?? 'none';

      if (canixEnv === 'none') {
        return { success: false, message: 'Canix integration not enabled' };
      }

      if (canixEnv === 'mock') {
        return { success: true, message: 'Mock mode active' };
      }

      const isSandbox = canixEnv === 'sandbox';
      const hasCredentials = isSandbox
        ? !!facility.encryptedCanixSandboxApiKey
        : !!facility.encryptedCanixApiKey;

      if (!hasCredentials) {
        return {
          success: false,
          message: `Canix ${isSandbox ? 'sandbox' : 'production'} API key not configured. Set API key first.`,
        };
      }

      try {
        const client = getCanixClient(facility);
        const identity = await client.whoami();
        return {
          success: true,
          message: `Canix ${isSandbox ? 'sandbox' : 'production'} connected — ${identity.companyName}`,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown connection error';
        return { success: false, message: msg };
      }
    }),

  // ==========================================================
  // Per-User Metrc Credentials
  // ==========================================================

  /**
   * List all user credentials for a facility (shows status, not actual keys).
   * Returns org members with their credential status.
   */
  listUserCredentials: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: { id: input.facilityId, organizationId: { in: orgIds } },
        select: { id: true, organizationId: true, requirePerUserCredentials: true, metrcEnvironment: true },
      });

      if (!facility) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found or access denied' });
      }

      // Get org members from dashboard DB
      const memberships = await dashboardPrisma.membership.findMany({
        where: { organizationId: facility.organizationId },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      });

      // Get existing credentials for this facility
      const credentials = await ctx.prisma.facilityUserCredential.findMany({
        where: { facilityId: input.facilityId },
        select: {
          userId: true,
          metrcUsername: true,
          isActive: true,
          lastVerifiedAt: true,
          encryptedUserApiKey: true,
          encryptedSandboxUserApiKey: true,
          createdAt: true,
        },
      });

      const credMap = new Map(credentials.map(c => [c.userId, c]));
      const environment = facility.metrcEnvironment;

      return {
        requirePerUserCredentials: facility.requirePerUserCredentials,
        members: memberships.map(m => {
          const cred = credMap.get(m.user.id);
          const hasKey = environment === 'sandbox'
            ? !!cred?.encryptedSandboxUserApiKey
            : !!cred?.encryptedUserApiKey;
          return {
            userId: m.user.id,
            name: m.user.name,
            email: m.user.email,
            image: m.user.image,
            metrcUsername: cred?.metrcUsername ?? null,
            hasKey,
            isActive: cred?.isActive ?? false,
            lastVerifiedAt: cred?.lastVerifiedAt ?? null,
            configuredAt: cred?.createdAt ?? null,
          };
        }),
      };
    }),

  /**
   * Get the current user's own credential status for a facility.
   */
  getMyCredentialStatus: platformProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: { id: input.facilityId, organizationId: { in: orgIds } },
        select: { id: true, requirePerUserCredentials: true, metrcEnvironment: true },
      });

      if (!facility) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found or access denied' });
      }

      const cred = await ctx.prisma.facilityUserCredential.findUnique({
        where: { facilityId_userId: { facilityId: input.facilityId, userId: ctx.session.user.id } },
        select: {
          metrcUsername: true,
          isActive: true,
          lastVerifiedAt: true,
          encryptedUserApiKey: true,
          encryptedSandboxUserApiKey: true,
        },
      });

      const environment = facility.metrcEnvironment;
      const hasKey = environment === 'sandbox'
        ? !!cred?.encryptedSandboxUserApiKey
        : !!cred?.encryptedUserApiKey;

      return {
        requirePerUserCredentials: facility.requirePerUserCredentials,
        hasKey,
        isActive: cred?.isActive ?? false,
        metrcUsername: cred?.metrcUsername ?? null,
        lastVerifiedAt: cred?.lastVerifiedAt ?? null,
      };
    }),

  /**
   * Set the current user's Metrc User API Key for a facility.
   * Each user stores their own key — the Vendor Key stays at facility level.
   */
  setUserCredential: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      userApiKey: z.string().min(1),
      environment: z.enum(['sandbox', 'production']).default('production'),
      metrcUsername: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: { id: input.facilityId, organizationId: { in: orgIds } },
      });

      if (!facility) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found or access denied' });
      }

      const encryptedKey = encrypt(input.userApiKey);

      const createData = input.environment === 'sandbox'
        ? { encryptedUserApiKey: '', encryptedSandboxUserApiKey: encryptedKey }
        : { encryptedUserApiKey: encryptedKey };

      const updateData = input.environment === 'sandbox'
        ? { encryptedSandboxUserApiKey: encryptedKey }
        : { encryptedUserApiKey: encryptedKey };

      await ctx.prisma.facilityUserCredential.upsert({
        where: {
          facilityId_userId: { facilityId: input.facilityId, userId: ctx.session.user.id },
        },
        create: {
          facilityId: input.facilityId,
          userId: ctx.session.user.id,
          ...createData,
          metrcUsername: input.metrcUsername,
          isActive: true,
        },
        update: {
          ...updateData,
          ...(input.metrcUsername !== undefined ? { metrcUsername: input.metrcUsername } : {}),
          isActive: true,
        },
      });

      // Clear cached client so new credentials take effect
      clearUserClientCache(input.facilityId, ctx.session.user.id);

      return { success: true };
    }),

  /**
   * Toggle requirePerUserCredentials on a facility (admin action).
   */
  setRequirePerUserCredentials: platformProcedure
    .input(z.object({
      facilityId: z.string(),
      required: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgIds = await getUserOrgIds(dashboardPrisma, ctx.session.user.id);

      const facility = await ctx.prisma.metrcFacility.findFirst({
        where: { id: input.facilityId, organizationId: { in: orgIds } },
      });

      if (!facility) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found or access denied' });
      }

      await ctx.prisma.metrcFacility.update({
        where: { id: input.facilityId },
        data: { requirePerUserCredentials: input.required },
      });

      return { success: true };
    }),

  // ==========================================================
  // Facility-Level Access Control (FOR-1172)
  // ==========================================================

  /**
   * List all access grants for a facility. Requires ADMIN role.
   * Returns org members enriched with their facility role (or null if no grant).
   */
  listFacilityAccess: facilityAdminProcedure
    .input(z.object({ facilityId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get all access grants for this facility
      const grants = await ctx.prisma.facilityAccess.findMany({
        where: { facilityId: input.facilityId },
        orderBy: { createdAt: 'desc' },
      });

      // Get all org members from dashboard DB
      const memberships = await dashboardPrisma.membership.findMany({
        where: { organizationId: ctx.organizationId },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      });

      const grantMap = new Map(grants.map(g => [g.userId, g]));

      return {
        hasAnyGrants: grants.length > 0,
        members: memberships.map(m => {
          const grant = grantMap.get(m.user.id);
          return {
            userId: m.user.id,
            name: m.user.name,
            email: m.user.email,
            image: m.user.image,
            role: grant?.role ?? null,
            grantedBy: grant?.grantedBy ?? null,
            grantedAt: grant?.createdAt ?? null,
          };
        }),
      };
    }),

  /**
   * Grant or update a user's facility access role. Requires ADMIN role.
   */
  setFacilityAccess: facilityAdminProcedure
    .input(z.object({
      facilityId: z.string(),
      userId: z.string(),
      role: z.enum(['VIEWER', 'OPERATOR', 'ADMIN']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify target user is in the same org
      const membership = await dashboardPrisma.membership.findFirst({
        where: {
          userId: input.userId,
          organizationId: ctx.organizationId,
        },
      });
      if (!membership) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is not a member of this organization' });
      }

      await ctx.prisma.facilityAccess.upsert({
        where: {
          facilityId_userId: { facilityId: input.facilityId, userId: input.userId },
        },
        create: {
          facilityId: input.facilityId,
          userId: input.userId,
          role: input.role,
          grantedBy: ctx.session.user.id,
        },
        update: {
          role: input.role,
          grantedBy: ctx.session.user.id,
        },
      });

      // ADR-020 Phase 4: surface the new grant in the target user's JWT within
      // ≤60s (next freshness check) instead of waiting for sign-out + sign-in.
      await bumpJwtInvalidatedAt(dashboardPrisma, input.userId);

      return { success: true };
    }),

  /**
   * Revoke a user's facility access grant. Requires ADMIN role.
   */
  revokeFacilityAccess: facilityAdminProcedure
    .input(z.object({
      facilityId: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Prevent revoking own access
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot revoke your own facility access' });
      }

      await ctx.prisma.facilityAccess.deleteMany({
        where: { facilityId: input.facilityId, userId: input.userId },
      });

      // Surface the revocation in the target user's JWT within ≤60s.
      await bumpJwtInvalidatedAt(dashboardPrisma, input.userId);

      return { success: true };
    }),

  /**
   * Bootstrap facility access control: creates ADMIN grants for all current org members.
   * Idempotent — uses skipDuplicates so concurrent calls are safe.
   */
  bootstrapFacilityAccess: facilityAdminProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get all org members
      const memberships = await dashboardPrisma.membership.findMany({
        where: { organizationId: ctx.organizationId },
        select: { userId: true },
      });

      // Create ADMIN grants — skipDuplicates makes this idempotent and race-safe
      await ctx.prisma.facilityAccess.createMany({
        data: memberships.map(m => ({
          facilityId: input.facilityId,
          userId: m.userId,
          role: 'ADMIN' as const,
          grantedBy: ctx.session.user.id,
        })),
        skipDuplicates: true,
      });

      // ADR-020 Phase 4: bump every member's jwtInvalidatedAt so they pick up
      // the new grants on next freshness check (≤60s) instead of next sign-in.
      await bumpJwtInvalidatedAt(dashboardPrisma, memberships.map((m) => m.userId));

      // Return actual grant count (includes pre-existing)
      const totalGrants = await ctx.prisma.facilityAccess.count({
        where: { facilityId: input.facilityId },
      });

      return { success: true, grantCount: totalGrants };
    }),
});

