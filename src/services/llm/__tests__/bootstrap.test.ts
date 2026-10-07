import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/encryption', () => ({ encrypt: (s: string) => `enc:${s}` }));
import { bootstrapProvidersFromEnv } from '@/services/llm/bootstrap';

function db(existing = 0, marker = false) {
  const created: Record<string, unknown>[] = [];
  const settings = new Map<string, string>(marker ? [['llm_bootstrap_done', '1']] : []);
  return {
    created, settings,
    llmProvider: { count: async () => existing, create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; } },
    appSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key)! } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { key: string; value: string } }) => { settings.set(where.key, create.value); return create; },
    },
  };
}

describe('bootstrapProvidersFromEnv', () => {
  it('is a no-op when the marker is present, even with zero providers', async () => {
    const d = db(0, true);
    expect(await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk' })).toEqual([]);
    expect(d.created).toHaveLength(0);
  });
  it('sets the marker without creating when providers already exist', async () => {
    const d = db(1);
    expect(await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk' })).toEqual([]);
    expect(d.created).toHaveLength(0);
    expect(d.settings.has('llm_bootstrap_done')).toBe(true);
  });
  it('sets the marker after creating providers', async () => {
    const d = db();
    await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk' });
    expect(d.settings.has('llm_bootstrap_done')).toBe(true);
  });
  it('does nothing, and leaves no marker, without LLM env vars', async () => {
    const d = db();
    expect(await bootstrapProvidersFromEnv(d, {})).toEqual([]);
    expect(d.settings.has('llm_bootstrap_done')).toBe(false);
  });
  it('creates OpenRouter with encrypted key and key service, as default', async () => {
    const d = db();
    await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk-1', KEY_SERVICE_URL: 'http://keyservice:3001', KEY_SERVICE_API_KEY: 'tok' });
    expect(d.created[0]).toMatchObject({ name: 'OpenRouter', type: 'OPENROUTER', apiKeyEncrypted: 'enc:sk-1', keyServiceUrl: 'http://keyservice:3001', keyServiceTokenEncrypted: 'enc:tok', isDefault: true, defaultModel: 'anthropic/claude-sonnet-4.6' });
  });
  it('creates both; Ollama is default when LLM_DEFAULT_PROVIDER=ollama', async () => {
    const d = db();
    const names = await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk-1', OLLAMA_BASE_URL: 'http://ollama:11434', OLLAMA_MODEL: 'llama3.1:8b', LLM_DEFAULT_PROVIDER: 'ollama' });
    expect(names).toEqual(['OpenRouter', 'Ollama']);
    expect(d.created.find((c) => c.type === 'OLLAMA')).toMatchObject({ isDefault: true, defaultModel: 'llama3.1:8b', models: ['llama3.1:8b'], apiKeyEncrypted: null });
    expect(d.created.find((c) => c.type === 'OPENROUTER')).toMatchObject({ isDefault: false });
    expect(d.created.filter((c) => c.isDefault)).toHaveLength(1);
  });
  it('creates both with OpenRouter as the only default by default', async () => {
    const d = db();
    await bootstrapProvidersFromEnv(d, { OPENROUTER_API_KEY: 'sk-1', OLLAMA_BASE_URL: 'http://ollama:11434' });
    expect(d.created.filter((c) => c.isDefault)).toHaveLength(1);
    expect(d.created[0]).toMatchObject({ type: 'OPENROUTER', isDefault: true });
  });
  it('ignores KEY_SERVICE_URL when there is no OpenRouter config', async () => {
    const d = db();
    await bootstrapProvidersFromEnv(d, { KEY_SERVICE_URL: 'http://keyservice:3001', OLLAMA_BASE_URL: 'http://ollama:11434' });
    expect(d.created).toHaveLength(1);
    expect(d.created[0]).toMatchObject({ type: 'OLLAMA', keyServiceUrl: null });
  });
  it('creates OpenRouter from the key service alone when its token is set', async () => {
    const d = db();
    await bootstrapProvidersFromEnv(d, { KEY_SERVICE_URL: 'http://keyservice:3001', KEY_SERVICE_API_KEY: 'tok' });
    expect(d.created[0]).toMatchObject({ type: 'OPENROUTER', apiKeyEncrypted: null, keyServiceUrl: 'http://keyservice:3001' });
  });
});
