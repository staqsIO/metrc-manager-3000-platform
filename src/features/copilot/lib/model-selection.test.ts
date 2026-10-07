import { describe, it, expect } from 'vitest';
import { reconcileSelectedModel } from '@/features/copilot/lib/format';

describe('reconcileSelectedModel', () => {
  const available = [{ model_id: 'a/x' }, { model_id: 'b/y' }];
  it('keeps a selection that is still offered', () => {
    expect(reconcileSelectedModel('a/x', available)).toBe('a/x');
  });
  it('clears a persisted selection that is no longer offered', () => {
    expect(reconcileSelectedModel('gone/z', available)).toBe('');
    expect(reconcileSelectedModel('gone/z', [])).toBe('');
  });
  it('keeps the selection while the model list is still loading', () => {
    expect(reconcileSelectedModel('a/x', undefined)).toBe('a/x');
  });
});
