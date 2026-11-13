import { describe, it, expect, beforeEach } from 'vitest';
import { clearDemoKey, getDemoKey, ownKeyHeaders, setDemoKey } from './demo-key';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('demo key storage', () => {
  beforeEach(() => {
    Object.assign(globalThis, { sessionStorage: fakeStorage(), localStorage: fakeStorage() });
  });

  it('sends no header until a key is saved, and none after it is removed', () => {
    expect(ownKeyHeaders()).toEqual({});
    setDemoKey('  sk-or-v1-abc  ');
    expect(getDemoKey()).toBe('sk-or-v1-abc');
    expect(ownKeyHeaders()).toEqual({ 'X-OpenRouter-Key': 'sk-or-v1-abc' });
    clearDemoKey();
    expect(getDemoKey()).toBeNull();
    expect(ownKeyHeaders()).toEqual({});
  });

  it('keeps the key in this tab only, never localStorage', () => {
    setDemoKey('sk-or-v1-abc');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });

  it('works when storage is unavailable', () => {
    Object.assign(globalThis, { sessionStorage: undefined });
    expect(() => setDemoKey('sk-or-v1-abc')).not.toThrow();
    expect(getDemoKey()).toBeNull();
    expect(ownKeyHeaders()).toEqual({});
  });
});
