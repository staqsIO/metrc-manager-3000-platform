/**
 * Diagnostic endpoint: raw Metrc API test bypassing all wrappers.
 * GET /api/debug/metrc-test?facilityId=xxx
 *
 * Tests both v1 and v2 endpoints directly to compare responses.
 * Remove this file after debugging is complete.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: 'Unauthorized' });

  const { facilityId } = req.query;
  if (!facilityId || typeof facilityId !== 'string') {
    return res.status(400).json({ error: 'facilityId required' });
  }

  const facility = await prisma.metrcFacility.findUnique({ where: { id: facilityId } });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  const encVendor = facility.encryptedVendorApiKey;
  const encUser = facility.encryptedUserApiKey;
  if (!encVendor || !encUser) return res.status(400).json({ error: 'No production credentials' });

  const vendorKey = decrypt(encVendor);
  const userKey = decrypt(encUser);
  const basicAuth = Buffer.from(`${vendorKey}:${userKey}`).toString('base64');

  const stateCode = facility.stateCode.toLowerCase();
  const baseUrl = `https://api-${stateCode}.metrc.com`;
  const license = facility.licenseNumber;

  const results: Record<string, unknown> = {
    facility: { id: facility.id, name: facility.name, stateCode: facility.stateCode, license },
    baseUrl,
    vendorKeyPrefix: vendorKey.substring(0, 8) + '...',
    userKeyPrefix: userKey.substring(0, 8) + '...',
  };

  // Test v1 active packages
  try {
    const v1Resp = await fetch(`${baseUrl}/packages/v1/active?licenseNumber=${license}`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    const v1Body = await v1Resp.text();
    results.v1_active = {
      status: v1Resp.status,
      bodyLength: v1Body.length,
      preview: v1Body.substring(0, 500),
    };
  } catch (e) {
    results.v1_active = { error: String(e) };
  }

  // Test v2 active packages (no pagination)
  try {
    const v2Resp = await fetch(`${baseUrl}/packages/v2/active?licenseNumber=${license}`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    const v2Body = await v2Resp.text();
    results.v2_active_no_page = {
      status: v2Resp.status,
      bodyLength: v2Body.length,
      preview: v2Body.substring(0, 500),
    };
  } catch (e) {
    results.v2_active_no_page = { error: String(e) };
  }

  // Test v2 active packages (with pagination)
  try {
    const v2PResp = await fetch(`${baseUrl}/packages/v2/active?licenseNumber=${license}&pageSize=20&pageNumber=1`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    const v2PBody = await v2PResp.text();
    results.v2_active_page1 = {
      status: v2PResp.status,
      bodyLength: v2PBody.length,
      preview: v2PBody.substring(0, 500),
    };
  } catch (e) {
    results.v2_active_page1 = { error: String(e) };
  }

  // Test v2 facilities (to check auth works at all)
  try {
    const facResp = await fetch(`${baseUrl}/facilities/v2/`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    const facBody = await facResp.text();
    results.v2_facilities = {
      status: facResp.status,
      bodyLength: facBody.length,
      preview: facBody.substring(0, 500),
    };
  } catch (e) {
    results.v2_facilities = { error: String(e) };
  }

  // Paginate through ALL v2 active packages to count true total
  try {
    const pageCounts: { page: number; count: number; total: number }[] = [];
    let allCount = 0;
    for (let page = 1; page <= 50; page++) {
      const resp = await fetch(
        `${baseUrl}/packages/v2/active?licenseNumber=${license}&pageSize=20&pageNumber=${page}`,
        { headers: { Authorization: `Basic ${basicAuth}` } },
      );
      if (resp.status !== 200) {
        pageCounts.push({ page, count: -1, total: resp.status });
        break;
      }
      const body = await resp.json() as { Data?: unknown[]; Total?: number };
      const count = Array.isArray(body.Data) ? body.Data.length : 0;
      const total = typeof body.Total === 'number' ? body.Total : -1;
      pageCounts.push({ page, count, total });
      allCount += count;
      if (count < 20) break; // short page = last page
    }
    results.v2_full_pagination = {
      totalPages: pageCounts.length,
      totalPackages: allCount,
      pages: pageCounts,
    };
  } catch (e) {
    results.v2_full_pagination = { error: String(e) };
  }

  // Test various date formats for lastModifiedStart
  // Metrc confirms this param controls package count — we need the right format
  const dateTests = [
    { label: 'fmt_iso_z', param: 'lastModifiedStart=2020-01-01T00:00:00Z' },
    { label: 'fmt_iso_no_z', param: 'lastModifiedStart=2020-01-01T00:00:00' },
    { label: 'fmt_iso_ms', param: 'lastModifiedStart=2020-01-01T00:00:00.000' },
    { label: 'fmt_iso_offset', param: `lastModifiedStart=${encodeURIComponent('2020-01-01T00:00:00+00:00')}` },
    { label: 'fmt_date_only', param: 'lastModifiedStart=2020-01-01' },
    { label: 'fmt_slash', param: `lastModifiedStart=${encodeURIComponent('01/01/2020')}` },
    { label: 'fmt_slash_time', param: `lastModifiedStart=${encodeURIComponent('01/01/2020 00:00:00')}` },
    { label: 'fmt_space', param: `lastModifiedStart=${encodeURIComponent('2020-01-01 00:00:00')}` },
    { label: 'fmt_recent_iso', param: 'lastModifiedStart=2025-01-01T00:00:00' },
    { label: 'fmt_recent_date', param: 'lastModifiedStart=2025-01-01' },
    { label: 'no_filter', param: '' },
  ];

  for (const test of dateTests) {
    try {
      const separator = test.param ? '&' : '';
      const url = `${baseUrl}/packages/v2/active?licenseNumber=${license}${separator}${test.param}`;
      const resp = await fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
      if (resp.status !== 200) {
        results[test.label] = { status: resp.status };
        continue;
      }
      const body = await resp.json() as { Data?: unknown[]; Total?: number };
      const count = Array.isArray(body.Data) ? body.Data.length : 0;
      const total = typeof body.Total === 'number' ? body.Total : -1;
      results[test.label] = { count, total, bodyLength: JSON.stringify(body).length };
    } catch (e) {
      results[test.label] = { error: String(e) };
    }
  }

  // Also check: what does the unpaginated response ACTUALLY contain vs paginated?
  // Compare first package labels
  try {
    const unpagResp = await fetch(
      `${baseUrl}/packages/v2/active?licenseNumber=${license}`,
      { headers: { Authorization: `Basic ${basicAuth}` } },
    );
    const unpagBody = await unpagResp.json() as { Data?: Array<{ Label?: string; Id?: number }>; Total?: number };
    const unpagLabels = (unpagBody.Data ?? []).map(p => p.Label).slice(0, 5);
    const unpagCount = (unpagBody.Data ?? []).length;
    const unpagTotal = unpagBody.Total;

    results.unpaginated_detail = {
      count: unpagCount,
      total: unpagTotal,
      firstLabels: unpagLabels,
    };
  } catch (e) {
    results.unpaginated_detail = { error: String(e) };
  }

  return res.status(200).json(results);
}
