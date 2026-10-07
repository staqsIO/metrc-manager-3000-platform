import { describe, it, expect } from 'vitest';
import { buildPayload, EMPTY, parseModels } from '../ProviderForm';

describe('buildPayload', () => {
  const base = { ...EMPTY.OPENROUTER, keyServiceUrl: 'http://ks:3001' };
  it('keeps stored secrets when blank', () => {
    const p = buildPayload(base);
    expect(p).toMatchObject({ apiKey: '', keyServiceToken: '' });
  });
  it('clears secrets when removal is requested', () => {
    const p = buildPayload(base, { apiKey: true, token: true });
    expect(p).toMatchObject({ apiKey: null, keyServiceToken: null });
  });
  it('replaces with new values', () => {
    const p = buildPayload({ ...base, apiKey: 'k', keyServiceToken: 't' });
    expect(p).toMatchObject({ apiKey: 'k', keyServiceToken: 't' });
  });
  it('omits secrets for Ollama', () => {
    expect(buildPayload(EMPTY.OLLAMA, { apiKey: true })).not.toHaveProperty('apiKey');
  });
});

describe('parseModels', () => {
  it('ignores blank lines and whitespace, removes duplicates', () => {
    expect(parseModels('  a/b \n\n\t\nc:1\r\na/b\n   ')).toEqual(['a/b', 'c:1']);
  });
  it('keeps a trailing newline typeable (parse is lossy, raw text is not)', () => {
    expect(parseModels('a\n')).toEqual(['a']);
    expect(parseModels('')).toEqual([]);
  });
});
