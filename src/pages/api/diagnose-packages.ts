import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { MetrcClient } from '@metrc-formul8-os/client';
import { patchClientForV2 } from '@/services/metrc/metrc-v2-client';
import { decrypt } from '@/lib/encryption';

/**
 * Diagnostic endpoint to search across active, inactive, and on-hold packages.
 *
 * Usage:
 *   GET /api/diagnose-packages?facilityId=xxx&search=distillate
 *   Authorization: Bearer $CRON_SECRET
 *
 * This bypasses tRPC auth for quick debugging. Protected by CRON_SECRET.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const facilityId = req.query.facilityId as string;
  const search = (req.query.search as string)?.toLowerCase() ?? '';

  if (!facilityId) {
    return res.status(400).json({ error: 'facilityId required' });
  }

  if (!prisma) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const facility = await prisma.metrcFacility.findUnique({ where: { id: facilityId } });
  if (!facility) {
    return res.status(404).json({ error: 'Facility not found' });
  }

  const environment = facility.metrcEnvironment as 'sandbox' | 'production';
  const encVendor = environment === 'sandbox'
    ? facility.encryptedSandboxVendorApiKey
    : facility.encryptedVendorApiKey;
  const encUser = environment === 'sandbox'
    ? facility.encryptedSandboxUserApiKey
    : facility.encryptedUserApiKey;

  if (!encVendor || !encUser) {
    return res.status(400).json({ error: 'Missing API credentials for this facility' });
  }

  const rawClient = patchClientForV2(new MetrcClient({
    stateCode: facility.stateCode,
    licenseNumber: facility.licenseNumber,
    vendorApiKey: decrypt(encVendor),
    userApiKey: decrypt(encUser),
    environment,
    authMethod: 'basic',
    debug: true,
  }));

  const c = rawClient as unknown as {
    get: (endpoint: string, params?: Record<string, string>) => Promise<unknown>;
  };

  type PkgSummary = {
    Id: number;
    Label: string;
    ItemName: string;
    ItemCategory: string;
    Quantity: number;
    Unit: string;
    LastModified: string;
  };

  const summarize = (raw: unknown): PkgSummary[] => {
    if (!Array.isArray(raw)) return [];
    return raw.map((p: Record<string, unknown>) => ({
      Id: p.Id as number,
      Label: (p.Label as string) ?? '',
      ItemName: (p.ItemName ?? (p.Item as Record<string, unknown>)?.Name ?? '') as string,
      ItemCategory: (p.ItemCategory ?? (p.Item as Record<string, unknown>)?.ProductCategoryName ?? '') as string,
      Quantity: (p.Quantity as number) ?? 0,
      Unit: (p.UnitOfMeasureName ?? (p.Item as Record<string, unknown>)?.UnitOfMeasureName ?? '') as string,
      LastModified: (p.LastModified as string) ?? '',
    }));
  };

  const filter = (pkgs: PkgSummary[]): PkgSummary[] => {
    if (!search) return pkgs;
    return pkgs.filter(p =>
      p.ItemName.toLowerCase().includes(search) ||
      p.Label.toLowerCase().includes(search) ||
      p.ItemCategory.toLowerCase().includes(search)
    );
  };

  const results: Record<string, unknown> = {
    facilityId: facility.id,
    facilityName: facility.name,
    stateCode: facility.stateCode,
    environment,
    search: search || '(all)',
    timestamp: new Date().toISOString(),
  };

  for (const [label, endpoint] of [
    ['active', '/packages/v1/active'],
    ['inactive', '/packages/v1/inactive'],
    ['onhold', '/packages/v1/onhold'],
  ] as const) {
    try {
      const raw = await c.get(endpoint);
      const all = summarize(raw);
      const matched = filter(all);
      results[label] = {
        totalCount: all.length,
        matchedCount: matched.length,
        matched: matched.slice(0, 100),
      };
    } catch (err: unknown) {
      results[label] = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Also check transfers
  for (const [label, endpoint] of [
    ['transfers_incoming', '/transfers/v1/incoming'],
    ['transfers_outgoing', '/transfers/v1/outgoing'],
  ] as const) {
    try {
      const raw = await c.get(endpoint);
      const arr = Array.isArray(raw) ? raw : [];
      results[label] = {
        count: arr.length,
        sample: arr.slice(0, 3).map((t: Record<string, unknown>) => ({
          Id: t.Id,
          ManifestNumber: t.ManifestNumber,
          ShipperFacilityName: t.ShipperFacilityName,
          ReceiverFacilityName: t.ReceiverFacilityName,
        })),
      };
    } catch (err: unknown) {
      results[label] = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  console.log('[diagnose-packages]', JSON.stringify(results, null, 2));
  return res.status(200).json(results);
}
