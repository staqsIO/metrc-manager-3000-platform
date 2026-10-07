import { encrypt } from '@/lib/encryption';
import { PROVIDER_DEFAULTS } from './types';

type Env = Record<string, string | undefined>;
type Db = {
  llmProvider: { count(): Promise<number>; create(a: { data: Record<string, unknown> }): Promise<unknown> };
  appSetting: {
    findUnique(a: { where: { key: string } }): Promise<unknown | null>;
    upsert(a: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): Promise<unknown>;
  };
};

const DONE_KEY = 'llm_bootstrap_done';
const markDone = (db: Db) => db.appSetting.upsert({ where: { key: DONE_KEY }, create: { key: DONE_KEY, value: new Date().toISOString() }, update: { value: new Date().toISOString() } });

const v = (env: Env, k: string) => env[k]?.trim() || undefined;

/**
 * Seeds providers from env at most once per install; afterwards the database is the source of truth
 * (deleting every provider disables AI and is not undone). The marker is set only once providers
 * were created or already existed, so env vars added later still trigger a bootstrap.
 */
export async function bootstrapProvidersFromEnv(db: Db, env: Env): Promise<string[]> {
  if (await db.appSetting.findUnique({ where: { key: DONE_KEY } })) return [];
  if ((await db.llmProvider.count()) > 0) {
    await markDone(db);
    return [];
  }

  const orKey = v(env, 'OPENROUTER_API_KEY');
  const ksUrl = v(env, 'KEY_SERVICE_URL');
  const ksToken = v(env, 'KEY_SERVICE_API_KEY');
  const wantOpenRouter = Boolean(orKey || (ksUrl && ksToken));
  const ollamaUrl = v(env, 'OLLAMA_BASE_URL');
  const preferOllama = v(env, 'LLM_DEFAULT_PROVIDER')?.toLowerCase() === 'ollama' || !wantOpenRouter;
  const created: string[] = [];

  if (wantOpenRouter) {
    const d = PROVIDER_DEFAULTS.OPENROUTER;
    const model = v(env, 'OPENROUTER_MODEL') ?? d.defaultModel;
    await db.llmProvider.create({
      data: {
        name: 'OpenRouter', type: 'OPENROUTER', baseUrl: d.baseUrl,
        apiKeyEncrypted: orKey ? encrypt(orKey) : null,
        keyServiceUrl: ksUrl ?? null,
        keyServiceTokenEncrypted: ksUrl && ksToken ? encrypt(ksToken) : null,
        models: Array.from(new Set([model, d.fallbackModel!])), defaultModel: model, fallbackModel: d.fallbackModel,
        enabled: true, isDefault: !(ollamaUrl && preferOllama),
      },
    });
    created.push('OpenRouter');
  }

  if (ollamaUrl) {
    const model = v(env, 'OLLAMA_MODEL') ?? PROVIDER_DEFAULTS.OLLAMA.defaultModel;
    await db.llmProvider.create({
      data: {
        name: 'Ollama', type: 'OLLAMA', baseUrl: ollamaUrl, apiKeyEncrypted: null, keyServiceUrl: null,
        keyServiceTokenEncrypted: null, models: [model], defaultModel: model, fallbackModel: null,
        enabled: true, isDefault: preferOllama,
      },
    });
    created.push('Ollama');
  }
  if (created.length > 0) await markDone(db);
  return created;
}
