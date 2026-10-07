import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: { llmProvider: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock('@/lib/encryption', () => ({ decrypt: (s: string) => { if (s === 'enc:BAD') throw new Error('bad key'); return s.replace(/^enc:/, ''); }, encrypt: (s: string) => `enc:${s}` }));

import { getProviders, invalidateProviderCache, resolveLlm, isLLMConfigured } from '@/services/llm/registry';

const row = {
  id: 'or', name: 'OpenRouter', type: 'OPENROUTER', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEncrypted: 'enc:sk-1',
  keyServiceUrl: null, keyServiceTokenEncrypted: null, models: ['m1'], defaultModel: 'm1', fallbackModel: null,
  enabled: true, isDefault: true, createdAt: new Date(0), updatedAt: new Date(0),
};

describe('registry', () => {
  beforeEach(() => { findMany.mockReset(); invalidateProviderCache(); });

  it('decrypts secrets and caches rows', async () => {
    findMany.mockResolvedValue([row]);
    const ps = await getProviders();
    expect(ps[0].apiKey).toBe('sk-1');
    await getProviders();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('re-reads after invalidation', async () => {
    findMany.mockResolvedValue([row]);
    await getProviders(); invalidateProviderCache(); await getProviders();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
  it('reports not configured with zero providers', async () => {
    findMany.mockResolvedValue([]);
    expect(await isLLMConfigured()).toBe(false);
    expect(await resolveLlm()).toBeNull();
  });
  it('tolerates a row that cannot be decrypted', async () => {
    const bad = { ...row, id: 'bad', name: 'Broken', apiKeyEncrypted: 'enc:BAD', isDefault: false, createdAt: new Date(1) };
    findMany.mockResolvedValue([row, bad]);
    const ps = await getProviders();
    expect(ps).toHaveLength(2);
    expect(ps.find((p) => p.id === 'bad')!.apiKey).toBeNull();
    expect(ps.find((p) => p.id === 'or')!.apiKey).toBe('sk-1');
    expect(await resolveLlm()).not.toBeNull();
  });
});
