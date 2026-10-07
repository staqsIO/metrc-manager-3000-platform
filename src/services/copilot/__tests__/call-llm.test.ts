import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveLlm = vi.fn();
const chatCompletion = vi.fn();
vi.mock('@/services/llm/registry', () => ({ resolveLlm: (...a: unknown[]) => resolveLlm(...a) }));
vi.mock('@/services/llm/chat', () => ({ chatCompletion: (...a: unknown[]) => chatCompletion(...a) }));

import { callLLM, runToolLoop } from '@/services/copilot/openrouter-client';
import type { ResolvedLlm } from '@/services/llm/types';

const local = { provider: { type: 'OLLAMA', name: 'Local' }, model: 'qwen2.5:14b', dataLeavesHost: false, toolStrategy: 'prefetch' } as unknown as ResolvedLlm;
const remote = { provider: { type: 'OPENROUTER', name: 'OpenRouter' }, model: 'anthropic/claude-sonnet-4.6', dataLeavesHost: true, toolStrategy: 'native' } as unknown as ResolvedLlm;

describe('callLLM', () => {
  beforeEach(() => { resolveLlm.mockReset(); chatCompletion.mockReset(); });

  it('throws a readable not-configured error when no provider exists', async () => {
    resolveLlm.mockResolvedValueOnce(null);
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/ask a super admin to configure an LLM provider/);
  });
  it('delegates to the resolved provider with the requested model', async () => {
    resolveLlm.mockResolvedValueOnce(local);
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    await expect(callLLM([{ role: 'user', content: 'hi' }], undefined, { model: 'qwen2.5:14b', maxTokens: 10 })).resolves.toMatchObject({ content: 'ok' });
    expect(resolveLlm).toHaveBeenLastCalledWith('qwen2.5:14b');
    // Only ChatOptions are forwarded; the model is already carried by the resolved llm.
    expect(chatCompletion).toHaveBeenLastCalledWith(local, [{ role: 'user', content: 'hi' }], undefined, { maxTokens: 10 });
  });
  it('uses a pre-resolved llm without re-resolving', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    await callLLM([{ role: 'user', content: 'hi' }], undefined, { llm: local, temperature: 0.2 });
    expect(resolveLlm).not.toHaveBeenCalled();
    expect(chatCompletion).toHaveBeenLastCalledWith(local, [{ role: 'user', content: 'hi' }], undefined, { temperature: 0.2 });
  });
  it('forwards timeoutMs and onUsage', async () => {
    chatCompletion.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    const onUsage = vi.fn();
    await callLLM([{ role: 'user', content: 'hi' }], undefined, { llm: local, timeoutMs: 5000, onUsage });
    expect(chatCompletion).toHaveBeenLastCalledWith(local, expect.any(Array), undefined, { timeoutMs: 5000, onUsage });
  });
});

describe('runToolLoop', () => {
  beforeEach(() => { resolveLlm.mockReset(); chatCompletion.mockReset(); });

  it('uses the passed llm on every iteration, even if the registry would now resolve differently', async () => {
    resolveLlm.mockResolvedValue(remote);
    chatCompletion
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_x', arguments: '{}' } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: 'done' });
    const r = await runToolLoop([{ role: 'user', content: 'q' }], [], async () => '{"x":1}', 5, undefined, local);
    expect(r.content).toBe('done');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    for (const call of chatCompletion.mock.calls) expect(call[0]).toBe(local);
    expect(resolveLlm).not.toHaveBeenCalled();
  });
  it('uses the passed llm for the final summary after max iterations', async () => {
    resolveLlm.mockResolvedValue(remote);
    chatCompletion
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_x', arguments: '{}' } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: 'summary' });
    const r = await runToolLoop([{ role: 'user', content: 'q' }], [], async () => '{}', 1, undefined, local);
    expect(r.content).toBe('summary');
    for (const call of chatCompletion.mock.calls) expect(call[0]).toBe(local);
  });
});
