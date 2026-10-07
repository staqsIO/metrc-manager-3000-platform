import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, superAdminProcedure } from '@/lib/trpc';
import { encrypt } from '@/lib/encryption';
import { invalidateProviderCache, toProviderConfig, type LlmProviderRow } from '@/services/llm/registry';
import { listModels, chatCompletion } from '@/services/llm/chat';
import { PROVIDER_DEFAULTS, PROVIDER_TRAITS, type ProviderConfig } from '@/services/llm/types';
import { clearOpenRouterKeyCache } from '@/services/llm/openrouter';

const Type = z.enum(['OPENROUTER', 'OLLAMA']);
const secret = z.string().max(500).nullable().optional();
const Base = z.object({
  name: z.string().trim().min(1).max(80),
  type: Type,
  baseUrl: z.string().url().optional(),
  apiKey: secret,
  keyServiceUrl: z.string().url().nullable().optional(),
  keyServiceToken: secret,
  models: z.array(z.string().trim().min(1)).max(100),
  defaultModel: z.string().trim().min(1).optional(),
  fallbackModel: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
// Defaults change only via setDefault.
const Update = Base.omit({ isDefault: true }).partial().extend({ id: z.string() });

/** Prisma P2002 on the name column (or without target info); other unique violations (e.g. the single-default index) are not name conflicts. */
function isNameConflict(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { target?: unknown } } | null;
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  return target === undefined || String(target).includes('name');
}
const conflict = (name: string) => new TRPCError({ code: 'CONFLICT', message: `A provider named "${name}" already exists` });

function toPublic(row: LlmProviderRow & { updatedAt?: Date }) {
  const common = {
    id: row.id, name: row.name, type: row.type, baseUrl: row.baseUrl, keyServiceUrl: row.keyServiceUrl,
    models: row.models, defaultModel: row.defaultModel, fallbackModel: row.fallbackModel,
    enabled: row.enabled, isDefault: row.isDefault,
    dataLeavesHost: PROVIDER_TRAITS[row.type as keyof typeof PROVIDER_TRAITS].dataLeavesHost,
  };
  try {
    const p = toProviderConfig(row);
    return {
      ...common,
      hasApiKey: p.apiKey !== null, apiKeyLast4: p.apiKey && p.apiKey.length >= 12 ? p.apiKey.slice(-4) : null,
      hasKeyServiceToken: p.keyServiceToken !== null,
      secretsUnreadable: false,
    };
  } catch {
    // One undecryptable row (e.g. rotated ENCRYPTION_KEY) must not make the whole admin page unusable.
    return {
      ...common,
      hasApiKey: !!row.apiKeyEncrypted, apiKeyLast4: null,
      hasKeyServiceToken: !!row.keyServiceTokenEncrypted,
      secretsUnreadable: true,
    };
  }
}

/** undefined or '' → keep; null → clear; string → encrypt. */
function secretPatch(value: string | null | undefined): { set: boolean; value: string | null } {
  if (value === undefined || value === '') return { set: false, value: null };
  return { set: true, value: value === null ? null : encrypt(value) };
}

function assertTypeRules(type: 'OPENROUTER' | 'OLLAMA', input: { apiKey?: string | null; keyServiceUrl?: string | null; keyServiceToken?: string | null }) {
  if (type === 'OLLAMA' && (input.apiKey || input.keyServiceUrl || input.keyServiceToken)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ollama providers do not use API keys or a key service' });
  }
}

export const llmProvidersRouter = createTRPCRouter({
  list: superAdminProcedure.query(async ({ ctx }) => {
    const rows = (await ctx.prisma.llmProvider.findMany({ orderBy: { createdAt: 'asc' } })) as LlmProviderRow[];
    return rows.map(toPublic);
  }),

  create: superAdminProcedure.input(Base).mutation(async ({ ctx, input }) => {
    assertTypeRules(input.type, input);
    const d = PROVIDER_DEFAULTS[input.type];
    const enabled = input.enabled ?? true;
    let row;
    try {
      row = await ctx.prisma.$transaction(async (tx) => {
        const enabledRows = (await tx.llmProvider.findMany({ where: { enabled: true } })) as LlmProviderRow[];
        // Never make a disabled provider the default; an enabled one becomes default if none exists.
        const makeDefault = enabled && (input.isDefault === true || !enabledRows.some((r) => r.isDefault));
        if (makeDefault) await tx.llmProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        return tx.llmProvider.create({
          data: {
            name: input.name, type: input.type, baseUrl: input.baseUrl ?? d.baseUrl,
            apiKeyEncrypted: input.apiKey ? encrypt(input.apiKey) : null,
            keyServiceUrl: input.keyServiceUrl ?? null,
            keyServiceTokenEncrypted: input.keyServiceToken ? encrypt(input.keyServiceToken) : null,
            models: input.models, defaultModel: input.defaultModel ?? input.models[0] ?? d.defaultModel,
            fallbackModel: input.fallbackModel === undefined ? d.fallbackModel : input.fallbackModel,
            enabled, isDefault: makeDefault,
          },
        });
      });
    } catch (e) {
      if (isNameConflict(e)) throw conflict(input.name);
      throw e;
    }
    invalidateAll();
    return toPublic(row as LlmProviderRow);
  }),

  update: superAdminProcedure.input(Update).mutation(async ({ ctx, input }) => {
    const current = (await ctx.prisma.llmProvider.findUnique({ where: { id: input.id } })) as LlmProviderRow | null;
    if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
    const type = (input.type ?? current.type) as 'OPENROUTER' | 'OLLAMA';
    assertTypeRules(type, input);
    const apiKey = secretPatch(input.apiKey);
    const token = secretPatch(input.keyServiceToken);
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'type', 'baseUrl', 'keyServiceUrl', 'models', 'defaultModel', 'fallbackModel', 'enabled'] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    const typeChanged = type !== current.type;
    if (typeChanged && input.baseUrl === undefined) data.baseUrl = PROVIDER_DEFAULTS[type].baseUrl;
    if (apiKey.set) data.apiKeyEncrypted = apiKey.value;
    if (token.set) data.keyServiceTokenEncrypted = token.value;
    // Repointing a provider must not send the stored secret to a new origin (scheme/host/port).
    if (!apiKey.set && originOf(data.baseUrl as string | undefined ?? current.baseUrl) !== originOf(current.baseUrl)) {
      data.apiKeyEncrypted = null;
    }
    if (!token.set && input.keyServiceUrl !== undefined && originOf(input.keyServiceUrl) !== originOf(current.keyServiceUrl)) {
      data.keyServiceTokenEncrypted = null;
    }
    if (type === 'OLLAMA' && typeChanged) {
      data.apiKeyEncrypted = null; data.keyServiceUrl = null; data.keyServiceTokenEncrypted = null;
    }
    if (input.enabled === false && current.isDefault) data.isDefault = false;
    let row;
    try {
      row = await ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.llmProvider.update({ where: { id: input.id }, data });
        if (input.enabled !== undefined) await ensureDefault(tx);
        return (await tx.llmProvider.findUnique({ where: { id: input.id } })) ?? updated;
      });
    } catch (e) {
      if (input.name !== undefined && isNameConflict(e)) throw conflict(input.name);
      throw e;
    }
    invalidateAll();
    return toPublic(row as LlmProviderRow);
  }),

  remove: superAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.prisma.$transaction(async (tx) => {
      const row = await tx.llmProvider.findUnique({ where: { id: input.id } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await tx.llmProvider.delete({ where: { id: input.id } });
      await ensureDefault(tx);
    });
    invalidateAll();
    return { ok: true };
  }),

  setDefault: superAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.prisma.$transaction(async (tx) => {
      const row = await tx.llmProvider.findUnique({ where: { id: input.id } });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await tx.llmProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.llmProvider.update({ where: { id: input.id }, data: { isDefault: true, enabled: true } });
    });
    invalidateAll();
    return { ok: true };
  }),

  discoverModels: superAdminProcedure
    .input(z.union([z.object({ id: z.string() }), z.object({ draft: Base })]))
    .mutation(async ({ ctx, input }) => {
      let config: ProviderConfig;
      if ('id' in input) {
        const row = (await ctx.prisma.llmProvider.findUnique({ where: { id: input.id } })) as LlmProviderRow | null;
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        try { config = toProviderConfig(row); } catch (err) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Stored credentials could not be decrypted: ${err instanceof Error ? err.message : String(err)}` });
        }
      } else {
        config = draftConfig(input.draft);
      }
      try {
        return await listModels(config);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : String(err) });
      }
    }),

  test: superAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const row = (await ctx.prisma.llmProvider.findUnique({ where: { id: input.id } })) as LlmProviderRow | null;
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    let provider: ProviderConfig;
    try { provider = toProviderConfig(row); } catch (err) {
      return { ok: false as const, error: `Stored credentials could not be decrypted: ${err instanceof Error ? err.message : String(err)}` };
    }
    const started = Date.now();
    try {
        await chatCompletion(
          { provider, model: provider.defaultModel, ...PROVIDER_TRAITS[provider.type] },
          [{ role: 'user', content: 'Reply with the single word: ok' }],
          undefined,
          { maxTokens: 5, timeoutMs: 30_000 },
        );
        return { ok: true as const, model: provider.defaultModel, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }),
});

function invalidateAll() {
  invalidateProviderCache();
  clearOpenRouterKeyCache();
}

function draftConfig(d: z.infer<typeof Base>): ProviderConfig {
  const def = PROVIDER_DEFAULTS[d.type];
  return {
    id: 'draft', name: d.name, type: d.type, baseUrl: d.baseUrl ?? def.baseUrl, apiKey: d.apiKey ?? null,
    keyServiceUrl: d.keyServiceUrl ?? null, keyServiceToken: d.keyServiceToken ?? null, models: d.models,
    defaultModel: d.defaultModel ?? def.defaultModel, fallbackModel: d.fallbackModel ?? null,
    enabled: true, isDefault: false, createdAt: new Date(),
  };
}

/** Origin (scheme + host + port): a secret is only kept when the provider stays on the same origin. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Non-http(s) URLs have an opaque origin ("null"); compare the whole URL so they never collide.
    return u.origin === 'null' ? u.href : u.origin;
  } catch { return url; }
}

/** Ensure an enabled default exists (if any enabled provider does). Call inside a transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureDefault(db: any) {
  const enabled = (await db.llmProvider.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })) as LlmProviderRow[];
  if (enabled.some((r) => r.isDefault)) return;
  await db.llmProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  if (enabled[0]) await db.llmProvider.update({ where: { id: enabled[0].id }, data: { isDefault: true } });
}
