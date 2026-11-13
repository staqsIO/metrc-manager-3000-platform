import { describe, it, expect, vi } from 'vitest';
import { DEMO_OWN_KEY_CREDIT_MESSAGE, byoKeyLlm, demoErrorMessage, parseOwnKey, resolveDemoAccess } from '@/services/copilot/demo-ai';
import { DEMO_BAD_KEY_MESSAGE, DEMO_QUOTA_MESSAGE } from '@/services/copilot/demo-quota';
import { LlmProviderError } from '@/services/llm/types';

const KEY = 'sk-or-v1-' + 'a'.repeat(64);

const quota = (allowed: boolean) => ({
  consume: vi.fn(async () => ({ allowed, remaining: allowed ? 2 : 0 })),
  refund: vi.fn(async () => {}),
});

describe('parseOwnKey', () => {
  it('accepts an OpenRouter-shaped key and trims it', () => {
    expect(parseOwnKey(`  ${KEY} `)).toBe(KEY);
  });
  it('rejects junk, so the header cannot smuggle text into a request', () => {
    expect(parseOwnKey(null)).toBeNull();
    expect(parseOwnKey('')).toBeNull();
    expect(parseOwnKey('short')).toBeNull();
    expect(parseOwnKey(`${KEY}\r\nX-Evil: 1`)).toBeNull();
  });
});

describe('byoKeyLlm', () => {
  it('builds an OpenRouter provider with the visitor key and the default model', () => {
    const llm = byoKeyLlm(KEY);
    expect(llm.provider.type).toBe('OPENROUTER');
    expect(llm.provider.apiKey).toBe(KEY);
    expect(llm.provider.keyServiceUrl).toBeNull();
    expect(llm.model).toBe('anthropic/claude-sonnet-4.6');
    expect(llm.dataLeavesHost).toBe(true);
    expect(llm.toolStrategy).toBe('native');
  });
  it('keeps a model the visitor picked', () => {
    expect(byoKeyLlm(KEY, 'openai/gpt-5').model).toBe('openai/gpt-5');
  });
});

describe('resolveDemoAccess', () => {
  it('does nothing outside demo mode, even with a key header', async () => {
    const q = quota(true);
    const r = await resolveDemoAccess({ demoMode: false, keyHeader: KEY, houseConfigured: true, quota: q });
    expect(r).toEqual({ kind: 'normal' });
    expect(q.consume).not.toHaveBeenCalled();
  });

  it('uses the visitor key and skips the quota', async () => {
    const q = quota(false);
    const r = await resolveDemoAccess({ demoMode: true, keyHeader: KEY, houseConfigured: true, quota: q });
    expect(r.kind).toBe('own');
    if (r.kind === 'own') expect(r.llm.provider.apiKey).toBe(KEY);
    expect(q.consume).not.toHaveBeenCalled();
  });

  it('refuses a malformed key instead of silently charging the house key', async () => {
    const q = quota(true);
    const r = await resolveDemoAccess({ demoMode: true, keyHeader: 'nope', houseConfigured: true, quota: q });
    expect(r).toEqual({ kind: 'refused', status: 400, message: DEMO_BAD_KEY_MESSAGE });
    expect(q.consume).not.toHaveBeenCalled();
  });

  it('charges a free question when there is no key', async () => {
    const q = quota(true);
    const r = await resolveDemoAccess({ demoMode: true, keyHeader: null, houseConfigured: true, quota: q });
    expect(r.kind).toBe('house');
    expect(q.consume).toHaveBeenCalledTimes(1);
  });

  it('refuses with 429 when the free questions are used up', async () => {
    const r = await resolveDemoAccess({ demoMode: true, keyHeader: null, houseConfigured: true, quota: quota(false) });
    expect(r).toEqual({ kind: 'refused', status: 429, message: DEMO_QUOTA_MESSAGE });
  });

  it('charges nothing when no house key is set, so "AI disabled" does not cost a question', async () => {
    const q = quota(true);
    const r = await resolveDemoAccess({ demoMode: true, keyHeader: null, houseConfigured: false, quota: q });
    expect(r).toEqual({ kind: 'normal' });
    expect(q.consume).not.toHaveBeenCalled();
  });
});

describe('demoErrorMessage', () => {
  it('maps a spent house key to the quota message and a bad key to its own message', () => {
    expect(demoErrorMessage(new LlmProviderError('OpenRouter error 402: {"error":"insufficient credits"}'))).toBe(DEMO_QUOTA_MESSAGE);
    expect(demoErrorMessage(new LlmProviderError('OpenRouter error 401: {"error":"no auth"}'))).toBe(DEMO_BAD_KEY_MESSAGE);
  });
  it('tells a visitor when their own key is out of credit', () => {
    expect(demoErrorMessage(new LlmProviderError('OpenRouter error 402: {}'), true)).toBe(DEMO_OWN_KEY_CREDIT_MESSAGE);
  });
  it('leaves other errors alone', () => {
    expect(demoErrorMessage(new LlmProviderError('OpenRouter error 500: boom'))).toBeNull();
    expect(demoErrorMessage(new Error('anything'))).toBeNull();
  });
});
