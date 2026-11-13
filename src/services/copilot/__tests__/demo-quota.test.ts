import { describe, it, expect } from 'vitest';
import {
  bucketFor, clientIp, consumeDemoQuestion, demoQuotaLimits, peekDemoQuota, refundDemoQuestion, utcDay, type QuotaStore,
} from '@/services/copilot/demo-quota';

function memoryStore(): QuotaStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  const k = (b: string, d: string) => `${b}|${d}`;
  return {
    rows,
    async incrementBelow(bucket, day, limit) {
      const n = rows.get(k(bucket, day)) ?? 0;
      if (n >= limit) return null;
      rows.set(k(bucket, day), n + 1);
      return n + 1;
    },
    async decrement(bucket, day) {
      const n = rows.get(k(bucket, day)) ?? 0;
      if (n > 0) rows.set(k(bucket, day), n - 1);
    },
    async count(bucket, day) { return rows.get(k(bucket, day)) ?? 0; },
  };
}

const NOW = new Date('2026-11-13T15:00:00Z');
const opts = (ip: string, perVisitor = 5, perDay = 60, now = NOW) => ({ ip, secret: 's3cret', limits: { perVisitor, perDay }, now });

describe('demoQuotaLimits', () => {
  it('defaults to 5 per visitor and 60 per day', () => {
    expect(demoQuotaLimits({})).toEqual({ perVisitor: 5, perDay: 60 });
  });
  it('reads the env and ignores junk', () => {
    expect(demoQuotaLimits({ DEMO_AI_QUESTIONS_PER_VISITOR: '3', DEMO_AI_QUESTIONS_PER_DAY: '10' })).toEqual({ perVisitor: 3, perDay: 10 });
    expect(demoQuotaLimits({ DEMO_AI_QUESTIONS_PER_VISITOR: 'lots', DEMO_AI_QUESTIONS_PER_DAY: '-4' })).toEqual({ perVisitor: 5, perDay: 60 });
  });
});

describe('clientIp', () => {
  it('takes the entry the nearest proxy added, so a client cannot pick its own bucket', () => {
    // A visitor can send any X-Forwarded-For; the proxy appends the address it saw.
    expect(clientIp('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
    expect(clientIp(' 203.0.113.9 ')).toBe('203.0.113.9');
    expect(clientIp(['9.9.9.9', '203.0.113.9'])).toBe('203.0.113.9');
  });
  it('falls back to one shared bucket when the header is missing', () => {
    expect(clientIp(undefined)).toBe('unknown');
    expect(clientIp('')).toBe('unknown');
  });
});

describe('bucketFor', () => {
  it('hashes the ip with the secret and never contains it', () => {
    const b = bucketFor('203.0.113.9', 's3cret');
    expect(b).not.toContain('203.0.113.9');
    expect(b).toBe(bucketFor('203.0.113.9', 's3cret'));
    expect(b).not.toBe(bucketFor('203.0.113.9', 'other'));
    expect(b).not.toBe(bucketFor('203.0.113.10', 's3cret'));
    expect(b).not.toBe('global');
  });
});

describe('consumeDemoQuestion', () => {
  it('allows the visitor limit, then refuses', async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await consumeDemoQuestion(store, opts('1.1.1.1')));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0, 0]);
  });

  it('keeps separate counts per visitor', async () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i++) await consumeDemoQuestion(store, opts('1.1.1.1'));
    expect((await consumeDemoQuestion(store, opts('1.1.1.1'))).allowed).toBe(false);
    expect((await consumeDemoQuestion(store, opts('2.2.2.2'))).allowed).toBe(true);
  });

  it('stops everyone at the daily total and does not charge the refused visitor', async () => {
    const store = memoryStore();
    expect((await consumeDemoQuestion(store, opts('1.1.1.1', 5, 2))).allowed).toBe(true);
    expect((await consumeDemoQuestion(store, opts('2.2.2.2', 5, 2))).allowed).toBe(true);
    const refused = await consumeDemoQuestion(store, opts('3.3.3.3', 5, 2));
    expect(refused).toEqual({ allowed: false, remaining: 0 });
    expect(await store.count(bucketFor('3.3.3.3', 's3cret'), utcDay(NOW))).toBe(0);
  });

  it('starts fresh on a new UTC day', async () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i++) await consumeDemoQuestion(store, opts('1.1.1.1'));
    const tomorrow = new Date('2026-11-14T00:00:01Z');
    expect((await consumeDemoQuestion(store, opts('1.1.1.1', 5, 60, tomorrow))).allowed).toBe(true);
  });

  it('remaining is the smaller of the visitor and daily allowance', async () => {
    const store = memoryStore();
    expect((await consumeDemoQuestion(store, opts('1.1.1.1', 5, 3))).remaining).toBe(2);
  });
});

describe('peekDemoQuota and refundDemoQuestion', () => {
  it('peek does not charge, refund gives the question back', async () => {
    const store = memoryStore();
    expect(await peekDemoQuota(store, opts('1.1.1.1'))).toEqual({ remaining: 5, perVisitor: 5 });
    await consumeDemoQuestion(store, opts('1.1.1.1'));
    expect(await peekDemoQuota(store, opts('1.1.1.1'))).toEqual({ remaining: 4, perVisitor: 5 });
    expect(await peekDemoQuota(store, opts('1.1.1.1'))).toEqual({ remaining: 4, perVisitor: 5 });
    await refundDemoQuestion(store, opts('1.1.1.1'));
    expect(await peekDemoQuota(store, opts('1.1.1.1'))).toEqual({ remaining: 5, perVisitor: 5 });
    expect(await store.count('global', utcDay(NOW))).toBe(0);
  });
});
