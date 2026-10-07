/**
 * Unit tests for the per-facility adjust-reasons cache module.
 *
 * The user-visible behavior of this module is "fetcher invoked once per facility
 * within the TTL window, even if the helper is called many times." The tests
 * mirror that observable contract using a fake fetcher (a vi.fn()) — no need
 * to mock the full Metrc client to test cache logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedAdjustReasons,
  __resetAdjustReasonsCacheForTest,
} from '../adjust-reasons-cache';
import type { MetrcPackageAdjustReason } from '@metrc-formul8-os/client';

const FACILITY_A = 'fac-a';
const FACILITY_B = 'fac-b';

const REASONS_A: MetrcPackageAdjustReason[] = [
  { Name: 'Spoilage', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false } as MetrcPackageAdjustReason,
  { Name: 'Theft', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false } as MetrcPackageAdjustReason,
];

const REASONS_B: MetrcPackageAdjustReason[] = [
  { Name: 'Other', RequiresNote: true, RequiresWasteWeight: false, RequiresImmatureWasteWeight: false, RequiresMatureWasteWeight: false } as MetrcPackageAdjustReason,
];

describe('getCachedAdjustReasons', () => {
  beforeEach(() => {
    __resetAdjustReasonsCacheForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the fetcher exactly once when called twice for the same facility within 24h', async () => {
    const fetcher = vi.fn().mockResolvedValue(REASONS_A);

    const first = await getCachedAdjustReasons(FACILITY_A, fetcher);
    const second = await getCachedAdjustReasons(FACILITY_A, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(REASONS_A);
    expect(second).toEqual(REASONS_A);
  });

  it('keeps separate cache entries per facility id', async () => {
    const fetcherA = vi.fn().mockResolvedValue(REASONS_A);
    const fetcherB = vi.fn().mockResolvedValue(REASONS_B);

    const a1 = await getCachedAdjustReasons(FACILITY_A, fetcherA);
    const b1 = await getCachedAdjustReasons(FACILITY_B, fetcherB);
    const a2 = await getCachedAdjustReasons(FACILITY_A, fetcherA);
    const b2 = await getCachedAdjustReasons(FACILITY_B, fetcherB);

    // Each facility hits its own fetcher exactly once.
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
    expect(a1).toEqual(REASONS_A);
    expect(a2).toEqual(REASONS_A);
    expect(b1).toEqual(REASONS_B);
    expect(b2).toEqual(REASONS_B);
  });

  it('refetches after the 24h TTL has expired', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(REASONS_A)
      .mockResolvedValueOnce(REASONS_B);

    const first = await getCachedAdjustReasons(FACILITY_A, fetcher);
    expect(first).toEqual(REASONS_A);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance 24h + 1ms past the TTL.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    const second = await getCachedAdjustReasons(FACILITY_A, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second).toEqual(REASONS_B);
  });

  it('serves cached value just before TTL expiry (exactly at 24h - 1ms)', async () => {
    const fetcher = vi.fn().mockResolvedValue(REASONS_A);

    await getCachedAdjustReasons(FACILITY_A, fetcher);

    // Advance to 1ms before expiry.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);

    const second = await getCachedAdjustReasons(FACILITY_A, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toEqual(REASONS_A);
  });
});
