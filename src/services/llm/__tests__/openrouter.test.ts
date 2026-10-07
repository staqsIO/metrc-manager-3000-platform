/* eslint-disable @typescript-eslint/no-unused-vars -- rest params type the fetch mock call args for tsc */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOpenRouterApiKey, clearOpenRouterKeyCache, openRouterChat, listOpenRouterModels } from '@/services/llm/openrouter';
import type { ProviderConfig, ResolvedLlm } from '@/services/llm/types';

const base: ProviderConfig = {
  id: 'or', name: 'OpenRouter', type: 'OPENROUTER', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-stored',
  keyServiceUrl: null, keyServiceToken: null, models: [], defaultModel: 'anthropic/claude-sonnet-4.6',
  fallbackModel: 'anthropic/claude-haiku-4.5', enabled: true, isDefault: true, createdAt: new Date(0),
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('getOpenRouterApiKey', () => {
  beforeEach(() => clearOpenRouterKeyCache());

  it('uses the stored key and never calls a key service when none is configured', async () => {
    const f = vi.fn();
    await expect(getOpenRouterApiKey(base, f as never)).resolves.toBe('sk-stored');
    expect(f).not.toHaveBeenCalled();
  });
  it('prefers the key service and sends its bearer token', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ key: 'sk-from-service' }));
    const p = { ...base, keyServiceUrl: 'http://keyservice:3001', keyServiceToken: 'tok' };
    await expect(getOpenRouterApiKey(p, f as never)).resolves.toBe('sk-from-service');
    expect(f).toHaveBeenCalledWith('http://keyservice:3001/api/openrouter-key', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    }));
  });
  it('caches the key-service key for 5 minutes', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ key: 'sk-from-service' }));
    const p = { ...base, keyServiceUrl: 'http://keyservice:3001', keyServiceToken: 'tok' };
    await getOpenRouterApiKey(p, f as never); await getOpenRouterApiKey(p, f as never);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('falls back to the stored key when the key service fails', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ error: 'down' }, 503));
    const p = { ...base, keyServiceUrl: 'http://keyservice:3001', keyServiceToken: 'tok' };
    await expect(getOpenRouterApiKey(p, f as never)).resolves.toBe('sk-stored');
  });
  it('throws a readable error when there is no key at all', async () => {
    await expect(getOpenRouterApiKey({ ...base, apiKey: null }, vi.fn() as never)).rejects.toThrow('OpenRouter provider "OpenRouter" has no API key');
  });
});

describe('openRouterChat', () => {
  beforeEach(() => clearOpenRouterKeyCache());
  const llm: ResolvedLlm = { provider: base, model: 'anthropic/claude-sonnet-4.6', dataLeavesHost: true, toolStrategy: 'native' };

  it('posts an OpenAI-compatible body with fallback routing and returns the message', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }));
    const msg = await openRouterChat(llm, [{ role: 'user', content: 'hello' }], undefined, {}, f as never);
    expect(msg.content).toBe('hi');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'anthropic/claude-sonnet-4.6', models: ['anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5'], route: 'fallback' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-stored');
  });
  it('reports usage.total_tokens through onUsage', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { total_tokens: 42 } }));
    const onUsage = vi.fn();
    await openRouterChat(llm, [{ role: 'user', content: 'hello' }], undefined, { onUsage }, f as never);
    expect(onUsage).toHaveBeenCalledWith({ totalTokens: 42 });
  });
  it('turns HTTP errors into LlmProviderError with the status', async () => {
    const f = vi.fn(async (..._a: unknown[]) => new Response('bad key', { status: 401 }));
    await expect(openRouterChat(llm, [{ role: 'user', content: 'x' }], undefined, {}, f as never)).rejects.toThrow(/OpenRouter error 401/);
  });
  it('timeout is reported as a timeout', async () => {
    const f = vi.fn(async (..._a: unknown[]) => { throw new DOMException('t', 'TimeoutError'); });
    await expect(openRouterChat(llm, [{ role: 'user', content: 'x' }], undefined, { timeoutMs: 5000 }, f as never))
      .rejects.toThrow('OpenRouter at https://openrouter.ai/api/v1 timed out after 5s');
  });
});

describe('key service failure cache', () => {
  beforeEach(() => clearOpenRouterKeyCache());
  it('skips a failing key service for 60s', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ error: 'down' }, 503));
    const p = { ...base, keyServiceUrl: 'http://keyservice:3001', keyServiceToken: 'tok' };
    await getOpenRouterApiKey(p, f as never);
    await expect(getOpenRouterApiKey(p, f as never)).resolves.toBe('sk-stored');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('listOpenRouterModels', () => {
  it('wraps network failures in LlmProviderError', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(listOpenRouterModels(base, f as never)).rejects.toMatchObject({ name: 'LlmProviderError', message: 'Cannot reach OpenRouter at https://openrouter.ai/api/v1: ECONNREFUSED' });
  });
  it('wraps timeouts in LlmProviderError', async () => {
    const err = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const f = vi.fn().mockRejectedValue(err);
    await expect(listOpenRouterModels(base, f as never)).rejects.toMatchObject({ name: 'LlmProviderError', message: 'OpenRouter at https://openrouter.ai/api/v1 timed out after 10s' });
  });
});
