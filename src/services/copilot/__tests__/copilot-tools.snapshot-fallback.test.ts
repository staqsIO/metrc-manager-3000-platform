import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { IMetrcClient, MetrcPackage } from '@/services/metrc/types';
import { getActivePackagesWithFallback } from '../copilot-tools';

function makePackage(label: string): MetrcPackage {
  return {
    Id: Math.floor(Math.random() * 1e9),
    Label: label,
    PackageType: 'Product',
    SourceHarvestNames: '',
    LocationName: 'Vault',
    LocationTypeName: 'Default',
    Quantity: 1,
    UnitOfMeasureName: 'Each',
    UnitOfMeasureAbbreviation: 'ea',
    ItemName: 'Test Item',
    ItemId: 1,
    ProductCategoryName: 'Flower',
    PackagedDate: '2026-04-01',
  } as unknown as MetrcPackage;
}

function makePrismaWithSnapshot(snapshots: Array<{ Label: string }>): PrismaClient {
  return {
    packageSnapshot: {
      findMany: vi.fn().mockResolvedValue(snapshots),
    },
  } as unknown as PrismaClient;
}

function makeLiveClient(): IMetrcClient {
  return {
    getActivePackages: vi.fn().mockResolvedValue([makePackage('LIVE-A'), makePackage('LIVE-B')]),
  } as unknown as IMetrcClient;
}

describe('getActivePackagesWithFallback', () => {
  it('returns snapshot rows and never calls the live client when the snapshot has rows', async () => {
    // PackageSnapshot rows are mapped by snapshotToMetrcPackage; we only check counts here.
    const prisma = makePrismaWithSnapshot([
      { Label: 'SNAP-A' },
      { Label: 'SNAP-B' },
      { Label: 'SNAP-C' },
    ]);
    const live = makeLiveClient();

    const result = await getActivePackagesWithFallback(prisma, 'fac-1', live);

    expect(result).toHaveLength(3);
    expect(live.getActivePackages).not.toHaveBeenCalled();
  });

  it('falls back to the live client exactly once when the snapshot returns zero rows', async () => {
    const prisma = makePrismaWithSnapshot([]);
    const live = makeLiveClient();

    const result = await getActivePackagesWithFallback(prisma, 'fac-1', live);

    expect(result).toHaveLength(2);
    expect(live.getActivePackages).toHaveBeenCalledTimes(1);
  });

  it('falls back to the live client when prisma or facilityId is unavailable', async () => {
    const live = makeLiveClient();
    const result = await getActivePackagesWithFallback(undefined, undefined, live);
    expect(result).toHaveLength(2);
    expect(live.getActivePackages).toHaveBeenCalledTimes(1);
  });

  it('falls back to the live client when the snapshot read throws', async () => {
    const prisma = {
      packageSnapshot: {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
      },
    } as unknown as PrismaClient;
    const live = makeLiveClient();

    const result = await getActivePackagesWithFallback(prisma, 'fac-1', live);

    expect(result).toHaveLength(2);
    expect(live.getActivePackages).toHaveBeenCalledTimes(1);
  });
});
