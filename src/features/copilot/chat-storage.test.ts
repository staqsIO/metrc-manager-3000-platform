import { describe, it, expect, beforeEach } from 'vitest';

/**
 * In-memory shim — chat-storage guards on `typeof window === 'undefined'`
 * and falls back to an empty store. We need to make `window` defined so the
 * real localStorage path runs.
 */
function installLocalStorageShim(): Map<string, string> {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  // @ts-expect-error — minimal window shim for the `typeof window` guard
  globalThis.window = { localStorage };
  globalThis.localStorage = localStorage as unknown as Storage;
  return store;
}

beforeEach(() => {
  installLocalStorageShim();
});

describe('chat-storage facilityId namespace parity', () => {
  it('isolates conversations per facilityId', async () => {
    const { createConversation, listConversations } = await import('./chat-storage');
    createConversation('facility-A');
    createConversation('facility-A');
    createConversation('facility-B');
    expect(listConversations('facility-A')).toHaveLength(2);
    expect(listConversations('facility-B')).toHaveLength(1);
  });

  it('shares the same store across two callers using the same facilityId (widget + full-page parity)', async () => {
    const { createConversation, listConversations, appendMessage } = await import('./chat-storage');
    // Surface 1 (e.g. floating widget) creates a conversation
    const c1 = createConversation('facility-A');
    appendMessage('facility-A', c1.id, { role: 'user', content: 'from widget' });

    // Surface 2 (e.g. full-page route) loads the same namespace and sees it
    const visibleFromSurface2 = listConversations('facility-A');
    expect(visibleFromSurface2).toHaveLength(1);
    expect(visibleFromSurface2[0].id).toBe(c1.id);
  });

  it('uses the org-level namespace (constant string) when facilityId is the conventional org placeholder', async () => {
    const { createConversation, listConversations } = await import('./chat-storage');
    // CopilotPanel uses `facilityId || '__org__'` as the namespace; test that
    // both call sites passing the same placeholder share state.
    const orgNs = '__org__';
    createConversation(orgNs);
    createConversation(orgNs);
    expect(listConversations(orgNs)).toHaveLength(2);
    // And does NOT leak into a real facility's namespace
    expect(listConversations('facility-A')).toHaveLength(0);
  });

  it('survives a delete on one namespace without affecting another', async () => {
    const { createConversation, deleteConversation, listConversations } = await import('./chat-storage');
    const a1 = createConversation('facility-A');
    createConversation('facility-B');
    deleteConversation('facility-A', a1.id);
    expect(listConversations('facility-A')).toHaveLength(0);
    expect(listConversations('facility-B')).toHaveLength(1);
  });
});
