import type { PrismaClient, MetrcFacility, Prisma } from '@prisma/client';
import { getMetrcClient } from '@/services/metrc/metrc-factory';
import { calculateAgeDays } from '@/services/metrc/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  syncLogId: string;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  packagesCount: number;
  plantsCount: number;
  transfersCount: number;
  durationMs: number;
  apiCallCount: number;
  errorMessage?: string;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  syncErrorMessage: string | null;
  metrcEnvironment: string;
  hasCredentials: boolean;
}

// ---------------------------------------------------------------------------
// Sync Orchestrator
// ---------------------------------------------------------------------------

export async function runFullSync(
  prisma: PrismaClient,
  facility: MetrcFacility,
): Promise<SyncResult> {
  const startTime = Date.now();
  let apiCallCount = 0;

  // Create sync log entry
  const syncLog = await prisma.metrcSyncLog.create({
    data: {
      facilityId: facility.id,
      syncType: 'FULL',
      status: 'STARTED',
    },
  });

  try {
    const client = getMetrcClient(facility);

    // Fetch all data types in parallel
    const [packages, plants, outTransfers, inTransfers] = await Promise.all([
      client.getActivePackages().then(r => { apiCallCount++; return r; }),
      client.getActivePlants().then(r => { apiCallCount++; return r; }),
      client.getOutgoingTransfers().then(r => { apiCallCount++; return r; }),
      client.getIncomingTransfers().then(r => { apiCallCount++; return r; }),
    ]);

    const transfersCount = outTransfers.length + inTransfers.length;

    // Build aging distribution
    const ageBuckets: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    let totalQuantity = 0;
    const categorySet = new Set<string>();

    for (let i = 0; i < packages.length; i++) {
      const age = calculateAgeDays(packages[i].PackagedDate);
      if (age <= 30) ageBuckets['0-30']++;
      else if (age <= 60) ageBuckets['31-60']++;
      else if (age <= 90) ageBuckets['61-90']++;
      else ageBuckets['90+']++;
      totalQuantity += packages[i].Quantity || 0;
      if (packages[i].ItemCategory) categorySet.add(packages[i].ItemCategory);
    }

    // Create inventory snapshot
    const packageSummaries = packages.map(p => ({
      label: p.Label,
      itemName: p.ItemName || '',
      category: p.ItemCategory || '',
      quantity: p.Quantity,
      unit: p.UnitOfMeasureName,
      age: calculateAgeDays(p.PackagedDate),
      labState: p.LabTestingState,
      isOnHold: p.IsOnHold,
    }));

    await prisma.inventorySnapshot.create({
      data: {
        facilityId: facility.id,
        snapshotType: 'DAILY',
        packagesData: packageSummaries as unknown as Prisma.InputJsonValue,
        totalPackages: packages.length,
        totalQuantity,
        totalCategories: categorySet.size,
        agingDistribution: ageBuckets as unknown as Prisma.InputJsonValue,
      },
    });

    const durationMs = Date.now() - startTime;

    // Update sync log
    await prisma.metrcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'SUCCESS',
        completedAt: new Date(),
        packagesCount: packages.length,
        plantsCount: plants.length,
        transfersCount,
        durationMs,
        apiCallCount,
      },
    });

    // Update facility sync status
    await prisma.metrcFacility.update({
      where: { id: facility.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'SUCCESS',
        syncErrorMessage: null,
      },
    });

    return {
      syncLogId: syncLog.id,
      status: 'SUCCESS',
      packagesCount: packages.length,
      plantsCount: plants.length,
      transfersCount,
      durationMs,
      apiCallCount,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';

    // Update sync log with failure
    await prisma.metrcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage,
        durationMs,
        apiCallCount,
      },
    });

    // Update facility sync status
    await prisma.metrcFacility.update({
      where: { id: facility.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'FAILED',
        syncErrorMessage: errorMessage,
      },
    });

    return {
      syncLogId: syncLog.id,
      status: 'FAILED',
      packagesCount: 0,
      plantsCount: 0,
      transfersCount: 0,
      durationMs,
      apiCallCount,
      errorMessage,
    };
  }
}

export function getSyncStatus(facility: MetrcFacility): SyncStatus {
  return {
    lastSyncAt: facility.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: facility.lastSyncStatus,
    syncErrorMessage: facility.syncErrorMessage,
    metrcEnvironment: facility.metrcEnvironment,
    hasCredentials: facility.metrcEnvironment === 'sandbox'
      ? !!(facility.encryptedSandboxVendorApiKey && facility.encryptedSandboxUserApiKey)
      : !!(facility.encryptedVendorApiKey && facility.encryptedUserApiKey),
  };
}
