import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveLlm = vi.fn();
const callLLM = vi.fn();
vi.mock('@/services/llm/registry', () => ({ resolveLlm: (...a: unknown[]) => resolveLlm(...a) }));
vi.mock('@/services/copilot/openrouter-client', () => ({ callLLM: (...a: unknown[]) => callLLM(...a) }));

import { parseCOAWithLLM } from '@/services/copilot/coa-llm-parser';

const llm = { provider: { type: 'OLLAMA' }, model: 'qwen2.5:14b', dataLeavesHost: false, toolStrategy: 'prefetch' };
const reply = (content: string) => ({ role: 'assistant', content });

describe('parseCOAWithLLM', () => {
  beforeEach(() => { resolveLlm.mockReset(); callLLM.mockReset(); });

  it('skips AI parsing when no provider is configured', async () => {
    resolveLlm.mockResolvedValueOnce(null);
    const r = await parseCOAWithLLM('THC 20%');
    expect(r.warnings).toEqual(['AI parsing skipped: no LLM provider configured']);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('parses JSON from the provider resolved once, and reports its model and token usage', async () => {
    resolveLlm.mockResolvedValueOnce(llm);
    callLLM.mockImplementationOnce(async (_m: unknown, _t: unknown, opts: { onUsage?: (u: { totalTokens: number }) => void }) => {
      opts.onUsage?.({ totalTokens: 321 });
      return reply(JSON.stringify({ cannabinoids: [{ name: 'THC', value: 20, unit: '%' }], terpenes: [] }));
    });
    const r = await parseCOAWithLLM('THC 20%');
    expect(resolveLlm).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledWith(expect.any(Array), undefined, expect.objectContaining({ llm, jsonResponse: true }));
    expect(r.model).toBe('qwen2.5:14b');
    expect(r.tokensUsed).toBe(321);
    expect(r.cannabinoids).toEqual([expect.objectContaining({ name: 'THC', value: 20 })]);
  });

  it('strips the lab name, license number and batch id before sending the text', async () => {
    resolveLlm.mockResolvedValueOnce(llm);
    callLLM.mockResolvedValueOnce(reply('{"terpenes":[],"cannabinoids":[]}'));
    // Fictional fixture values (the lab name must be one the stripper knows).
    const pdf = 'Tested by SC Labs\nLicense: AU-R-009876\nBatch: ZZTEST-4242\nTHC 21.5%';
    await parseCOAWithLLM(pdf);
    const sent = JSON.stringify(callLLM.mock.calls[0][0]);
    expect(sent).not.toContain('SC Labs');
    expect(sent).not.toContain('AU-R-009876');
    expect(sent).not.toContain('ZZTEST-4242');
    expect(sent).toContain('THC 21.5%');
  });

  it('returns an empty result with the provider error as a warning', async () => {
    resolveLlm.mockResolvedValueOnce({ ...llm, provider: { type: 'OPENROUTER' } });
    callLLM.mockRejectedValueOnce(new Error('OpenRouter returned 401'));
    const r = await parseCOAWithLLM('THC 20%');
    expect(r.cannabinoids).toEqual([]);
    expect(r.warnings).toEqual(['LLM error: OpenRouter returned 401']);
  });
});
