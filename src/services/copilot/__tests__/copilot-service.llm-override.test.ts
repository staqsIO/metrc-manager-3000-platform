import { describe, it, expect, vi } from 'vitest';
import type { ResolvedLlm } from '@/services/llm/types';
import { llmForQuery } from '../copilot-service';
import { resolveLlm } from '@/services/llm/registry';

const house = vi.hoisted(() => ({ model: 'house-model' }) as ResolvedLlm);
vi.mock('@/services/llm/registry', async (orig) => ({
  ...(await orig<typeof import('@/services/llm/registry')>()),
  resolveLlm: vi.fn(async () => house),
}));


describe('llmForQuery', () => {
  it('uses the caller-supplied llm and never looks up the house provider', async () => {
    const own = { model: 'visitor-model' } as ResolvedLlm;
    expect(await llmForQuery({ llm: own, model: 'x' })).toBe(own);
    expect(resolveLlm).not.toHaveBeenCalled();
  });
  it('falls back to the configured provider', async () => {
    expect(await llmForQuery({ model: 'x' })).toBe(house);
    expect(resolveLlm).toHaveBeenCalledWith('x');
  });
});
