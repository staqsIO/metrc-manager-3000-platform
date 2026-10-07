import { describe, it, expect } from 'vitest';
import { assertPrefetchSafe } from '../copilot-service';
import { LlmProviderError, type ResolvedLlm } from '@/services/llm/types';

describe('assertPrefetchSafe', () => {
  it('refuses the prefetch path when data would leave the host (raw tool output is not anonymized)', () => {
    const llm = { model: 'm', dataLeavesHost: true, toolStrategy: 'prefetch' } as ResolvedLlm;
    expect(() => assertPrefetchSafe(llm)).toThrow(LlmProviderError);
  });
  it('allows a local provider', () => {
    const llm = { model: 'm', dataLeavesHost: false, toolStrategy: 'prefetch' } as ResolvedLlm;
    expect(() => assertPrefetchSafe(llm)).not.toThrow();
  });
});
