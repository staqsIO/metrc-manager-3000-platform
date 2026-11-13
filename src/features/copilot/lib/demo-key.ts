/**
 * A demo visitor's own OpenRouter key. It lives in sessionStorage, so it is gone when the
 * tab closes, and is sent with each Copilot question in X-OpenRouter-Key. The server uses it
 * for that one request and never stores it (src/services/copilot/demo-ai.ts).
 */

const STORAGE_KEY = 'demo-openrouter-key';
export const DEMO_KEY_EVENT = 'demo-openrouter-key-change';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function getDemoKey(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_KEY_EVENT));
}

export function setDemoKey(key: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, key.trim());
  } catch { /* private mode: the key just won't stick */ }
  notify();
}

export function clearDemoKey(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch { /* nothing to remove */ }
  notify();
}

export function ownKeyHeaders(): Record<string, string> {
  const key = getDemoKey();
  return key ? { 'X-OpenRouter-Key': key } : {};
}
