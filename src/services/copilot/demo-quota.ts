import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Free Copilot questions on the public demo (DEMO_MODE=1). Each visitor gets a few per UTC
 * day on the house OpenRouter key, and a `global` bucket caps the whole demo, so one person
 * cannot spend the key's $10 limit. Visitors who bring their own key are never charged.
 */

export interface DemoQuotaLimits { perVisitor: number; perDay: number }

export interface QuotaStore {
  /** Adds one to (bucket, day) unless it already holds `limit`. Returns the new count, or null when full. */
  incrementBelow(bucket: string, day: string, limit: number): Promise<number | null>;
  decrement(bucket: string, day: string): Promise<void>;
  count(bucket: string, day: string): Promise<number>;
}

export interface DemoQuotaOptions { ip: string; secret: string; limits: DemoQuotaLimits; now?: Date }

const GLOBAL = 'global';

const positiveInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function demoQuotaLimits(env: Record<string, string | undefined>): DemoQuotaLimits {
  return {
    perVisitor: positiveInt(env.DEMO_AI_QUESTIONS_PER_VISITOR, 5),
    perDay: positiveInt(env.DEMO_AI_QUESTIONS_PER_DAY, 60),
  };
}

/**
 * The visitor's address. X-Real-IP comes first: Railway's edge sets it and overwrites any copy
 * the client sends. Measured on the demo (2026-11-13): the last X-Forwarded-For entry was not
 * the visitor's address, and X-Real-IP was. X-Forwarded-For is only a fallback for other hosts. Never trust
 * the first X-Forwarded-For entry: the client writes it.
 */
export function clientIp(forwardedFor: string | string[] | null | undefined, realIp?: string | string[] | null): string {
  const real = (Array.isArray(realIp) ? realIp[0] : realIp)?.trim();
  if (real) return ipv6Network(real);
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor ?? '';
  const last = raw.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ? ipv6Network(last) : 'unknown';
}

/** One IPv6 client usually holds a whole /64, so it counts as one visitor. IPv4 is unchanged. */
function ipv6Network(ip: string): string {
  if (!ip.includes(':')) return ip;
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1];
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const tl = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill('0'), ...tl];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Salted hash, so the table never holds a raw IP. */
export function bucketFor(ip: string, secret: string): string {
  return 'v:' + createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 32);
}

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

export async function consumeDemoQuestion(
  store: QuotaStore, o: DemoQuotaOptions,
): Promise<{ allowed: boolean; remaining: number }> {
  const day = utcDay(o.now ?? new Date());
  const bucket = bucketFor(o.ip, o.secret);
  const mine = await store.incrementBelow(bucket, day, o.limits.perVisitor);
  if (mine === null) return { allowed: false, remaining: 0 };
  const all = await store.incrementBelow(GLOBAL, day, o.limits.perDay);
  if (all === null) {
    await store.decrement(bucket, day);
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: Math.min(o.limits.perVisitor - mine, o.limits.perDay - all) };
}

export async function peekDemoQuota(
  store: QuotaStore, o: DemoQuotaOptions,
): Promise<{ remaining: number; perVisitor: number }> {
  const day = utcDay(o.now ?? new Date());
  const [mine, all] = await Promise.all([store.count(bucketFor(o.ip, o.secret), day), store.count(GLOBAL, day)]);
  const remaining = Math.max(0, Math.min(o.limits.perVisitor - mine, o.limits.perDay - all));
  return { remaining, perVisitor: o.limits.perVisitor };
}

/** The increment is one statement, so two requests at once cannot both take the last question. */
export function prismaQuotaStore(db: PrismaClient): QuotaStore {
  return {
    async incrementBelow(bucket, day, limit) {
      const rows = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO "demo_ai_usage" ("bucket", "day", "count") VALUES (${bucket}, ${day}, 1)
        ON CONFLICT ("bucket", "day") DO UPDATE SET "count" = "demo_ai_usage"."count" + 1
        WHERE "demo_ai_usage"."count" < ${limit}
        RETURNING "count"`;
      return rows.length ? Number(rows[0].count) : null;
    },
    async decrement(bucket, day) {
      await db.$executeRaw`
        UPDATE "demo_ai_usage" SET "count" = "count" - 1
        WHERE "bucket" = ${bucket} AND "day" = ${day} AND "count" > 0`;
    },
    async count(bucket, day) {
      const row = await db.demoAiUsage.findUnique({ where: { bucket_day: { bucket, day } }, select: { count: true } });
      return row?.count ?? 0;
    },
  };
}

/** Wires the store, limits and secret from the environment for the request handlers. */
export function demoQuotaFor(db: PrismaClient, ip: string, env: Record<string, string | undefined> = process.env) {
  const o: DemoQuotaOptions = { ip, secret: env.NEXTAUTH_SECRET ?? '', limits: demoQuotaLimits(env) };
  const store = prismaQuotaStore(db);
  return {
    consume: () => consumeDemoQuestion(store, o),
    peek: () => peekDemoQuota(store, o),
  };
}

export const isDemoMode = (env: Record<string, string | undefined> = process.env): boolean => env.DEMO_MODE === '1';

export const DEMO_QUOTA_MESSAGE = "You've used today's free demo questions. Add your own OpenRouter key to keep going.";
export const DEMO_BAD_KEY_MESSAGE = 'OpenRouter rejected that key. Check it, or remove it to use the free questions.';
