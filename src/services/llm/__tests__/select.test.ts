import { describe, it, expect } from 'vitest';
import { selectLlm } from '@/services/llm/select';
import type { ProviderConfig } from '@/services/llm/types';

const p = (o: Partial<ProviderConfig>): ProviderConfig => ({
  id: 'x', name: 'x', type: 'OPENROUTER', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k',
  keyServiceUrl: null, keyServiceToken: null, models: [], defaultModel: 'm', fallbackModel: null,
  enabled: true, isDefault: false, createdAt: new Date(0), ...o,
});

describe('selectLlm', () => {
  const or = p({ id: 'or', name: 'OpenRouter', models: ['anthropic/claude-sonnet-4.6'], defaultModel: 'anthropic/claude-sonnet-4.6', isDefault: true });
  const ol = p({ id: 'ol', name: 'Local', type: 'OLLAMA', baseUrl: 'http://ollama:11434', apiKey: null, models: ['qwen2.5:14b'], defaultModel: 'qwen2.5:14b' });

  it('returns null when no provider is enabled', () => {
    expect(selectLlm([{ ...or, enabled: false }], null)).toBeNull();
  });
  it('uses the default provider when no model is requested', () => {
    expect(selectLlm([or, ol], null)).toMatchObject({ provider: { id: 'or' }, model: 'anthropic/claude-sonnet-4.6', dataLeavesHost: true, toolStrategy: 'native' });
  });
  it('routes a requested model to the provider that lists it', () => {
    expect(selectLlm([or, ol], 'qwen2.5:14b')).toMatchObject({ provider: { id: 'ol' }, model: 'qwen2.5:14b', dataLeavesHost: false, toolStrategy: 'prefetch' });
  });
  it('unknown model falls back to default', () => {
    expect(selectLlm([or, ol], 'gone/model')).toMatchObject({ provider: { id: 'or' }, model: 'anthropic/claude-sonnet-4.6' });
  });
  it('uses the oldest enabled provider when none is marked default', () => {
    const a = p({ id: 'a', createdAt: new Date(2) }); const b = p({ id: 'b', createdAt: new Date(1) });
    expect(selectLlm([a, b], null)!.provider.id).toBe('b');
  });
  it('ignores disabled providers even if they list the model', () => {
    expect(selectLlm([or, { ...ol, enabled: false }], 'qwen2.5:14b')!.provider.id).toBe('or');
  });
});
