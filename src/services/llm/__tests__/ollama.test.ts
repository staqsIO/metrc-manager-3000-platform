/* eslint-disable @typescript-eslint/no-unused-vars -- rest params type the fetch mock call args for tsc */
import { describe, it, expect, vi } from 'vitest';
import { ollamaChat, listOllamaModels } from '@/services/llm/ollama';
import { LlmProviderError, type ProviderConfig, type ResolvedLlm } from '@/services/llm/types';

const provider: ProviderConfig = {
  id: 'ol', name: 'Local', type: 'OLLAMA', baseUrl: 'http://ollama:11434/', apiKey: null, keyServiceUrl: null,
  keyServiceToken: null, models: ['qwen2.5:14b'], defaultModel: 'qwen2.5:14b', fallbackModel: null,
  enabled: true, isDefault: true, createdAt: new Date(0),
};
const llm: ResolvedLlm = { provider, model: 'qwen2.5:14b', dataLeavesHost: false, toolStrategy: 'prefetch' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });

describe('ollama', () => {
  it('calls /v1/chat/completions without an Authorization header', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
    await expect(ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, {}, f as never)).resolves.toMatchObject({ content: 'ok' });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it('reports usage.total_tokens through onUsage', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { total_tokens: 7 } }));
    const onUsage = vi.fn();
    await ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, { onUsage }, f as never);
    expect(onUsage).toHaveBeenCalledWith({ totalTokens: 7 });
  });
  it('ollama connection refused → readable error', async () => {
    const f = vi.fn(async (..._a: unknown[]) => { throw new TypeError('fetch failed'); });
    const p = ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, {}, f as never);
    await expect(p).rejects.toBeInstanceOf(LlmProviderError);
    await expect(p).rejects.toThrow('Cannot reach Ollama at http://ollama:11434. Is it running?');
  });
  it('model not pulled → tells the admin how to pull it', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ error: { message: 'model "qwen2.5:14b" not found, try pulling it first' } }, 404));
    await expect(ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, {}, f as never))
      .rejects.toThrow('Model "qwen2.5:14b" is not available in Ollama. Run: ollama pull qwen2.5:14b');
  });
  it('lists models from /api/tags', async () => {
    const f = vi.fn(async (..._a: unknown[]) => json({ models: [{ name: 'qwen2.5:14b' }, { name: 'llama3.1:8b' }] }));
    await expect(listOllamaModels(provider, f as never)).resolves.toEqual(['qwen2.5:14b', 'llama3.1:8b']);
    expect(f.mock.calls[0][0]).toBe('http://ollama:11434/api/tags');
  });
  it('404 page not found is not reported as a missing model', async () => {
    const f = vi.fn(async (..._a: unknown[]) => new Response('404 page not found', { status: 404 }));
    await expect(ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, {}, f as never)).rejects.toThrow(/Ollama error 404/);
  });
  it('timeout is reported as a timeout', async () => {
    const f = vi.fn(async (..._a: unknown[]) => { throw new DOMException('t', 'TimeoutError'); });
    await expect(ollamaChat(llm, [{ role: 'user', content: 'q' }], undefined, { timeoutMs: 3000 }, f as never))
      .rejects.toThrow('Ollama at http://ollama:11434 timed out after 3s');
  });
});
