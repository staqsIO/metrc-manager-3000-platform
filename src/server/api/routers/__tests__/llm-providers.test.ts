import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> & { id: string; isDefault: boolean; enabled: boolean; createdAt: Date };
const rows: Row[] = [];
let admin = true;

vi.mock('@/lib/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => { if (s.startsWith('bad:')) throw new Error('decrypt failed'); return s.replace(/^enc:/, ''); },
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => {
  const matches = (r: Row, where?: Record<string, unknown>) => !where || Object.entries(where).every(([k, v]) => r[k] === v);
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  const p2025 = () => Object.assign(new Error('Record not found'), { code: 'P2025' });
  const assertSingleDefault = (id: string | null, next: boolean) => {
    if (next && rows.some((r) => r.isDefault && r.id !== id)) throw p2002();
  };
  const llmProvider = {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: { data: Row }) => { assertSingleDefault(null, data.isDefault); if (rows.some((r) => r.name === data.name)) throw p2002(); const r = { ...data, id: `p${rows.length + 1}`, createdAt: new Date(rows.length), updatedAt: new Date() } as Row; rows.push(r); return r; },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const r = rows.find((x) => x.id === where.id); if (!r) throw p2025(); if (data.isDefault) assertSingleDefault(r.id, true); if (data.name && rows.some((x) => x.id !== r.id && x.name === data.name)) throw p2002(); Object.assign(r, data); return r; },
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Partial<Row> }) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    delete: async ({ where }: { where: { id: string } }) => { const i = rows.findIndex((x) => x.id === where.id); if (i < 0) throw p2025(); return rows.splice(i, 1)[0]; },
  };
  const db = { llmProvider, user: { findUnique: async () => ({ isPlatformAdmin: admin }) }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
  return { prisma: db, dashboardPrisma: db };
});

import { llmProvidersRouter } from '@/server/api/routers/llm-providers';
import { createCallerFactory } from '@/lib/trpc';
import { prisma } from '@/lib/prisma';

const caller = () => createCallerFactory(llmProvidersRouter)({ prisma, session: { user: { id: 'u1' } }, activeOrgId: null } as never);
const openrouter = { name: 'OpenRouter', type: 'OPENROUTER' as const, apiKey: 'sk-or-v1-abcd1234', models: ['anthropic/claude-sonnet-4.6'] }; // gitleaks:allow (dummy test key)

describe('llmProviders router', () => {
  beforeEach(() => { rows.length = 0; admin = true; });

  it('rejects non super admins', async () => {
    admin = false;
    await expect(caller().list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().create(openrouter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maps a duplicate name on create and rename to CONFLICT', async () => {
    await caller().create(openrouter);
    await expect(caller().create(openrouter)).rejects.toMatchObject({ code: 'CONFLICT', message: 'A provider named "OpenRouter" already exists' });
    const other = await caller().create({ ...openrouter, name: 'Other' });
    await expect(caller().update({ id: other.id, name: 'OpenRouter' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'A provider named "OpenRouter" already exists' });
  });

  it('exposes apiKeyLast4 only for keys of at least 12 characters', async () => {
    const short = await caller().create({ ...openrouter, name: 'Short', apiKey: 'abcd1234567' }); // gitleaks:allow
    const long = await caller().create({ ...openrouter, name: 'Long', apiKey: 'abcd12345678' }); // gitleaks:allow
    const list = await caller().list();
    expect(list.find((p) => p.id === short.id)).toMatchObject({ hasApiKey: true, apiKeyLast4: null });
    expect(list.find((p) => p.id === long.id)).toMatchObject({ hasApiKey: true, apiKeyLast4: '5678' });
  });

  it('never returns secrets, only the last 4 characters', async () => {
    await caller().create(openrouter);
    const [p] = await caller().list();
    expect(JSON.stringify(p)).not.toContain('sk-or-v1-abcd1234');
    expect(p).not.toHaveProperty('apiKeyEncrypted');
    expect(p).toMatchObject({ hasApiKey: true, apiKeyLast4: '1234', dataLeavesHost: true, baseUrl: 'https://openrouter.ai/api/v1' });
  });

  it('first provider becomes default; update without apiKey keeps stored key', async () => {
    const created = await caller().create(openrouter);
    expect(created.isDefault).toBe(true);
    await caller().update({ id: created.id, name: 'OR main' });
    expect(rows[0].apiKeyEncrypted).toBe('enc:sk-or-v1-abcd1234');
    await caller().update({ id: created.id, apiKey: '' });
    expect(rows[0].apiKeyEncrypted).toBe('enc:sk-or-v1-abcd1234');
    await caller().update({ id: created.id, apiKey: null });
    expect(rows[0].apiKeyEncrypted).toBeNull();
  });

  it('rejects an API key on an Ollama provider', async () => {
    await expect(caller().create({ name: 'Local', type: 'OLLAMA', apiKey: 'x', models: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('removing the default promotes the oldest remaining enabled provider', async () => {
    const a = await caller().create(openrouter);
    const b = await caller().create({ name: 'Local', type: 'OLLAMA', models: ['qwen2.5:14b'] });
    await caller().remove({ id: a.id });
    expect(rows.find((r) => r.id === b.id)!.isDefault).toBe(true);
  });

  it('setDefault moves the flag', async () => {
    const a = await caller().create(openrouter);
    const b = await caller().create({ name: 'Local', type: 'OLLAMA', models: ['qwen2.5:14b'] });
    await caller().setDefault({ id: b.id });
    expect(rows.find((r) => r.id === a.id)!.isDefault).toBe(false);
    expect(rows.find((r) => r.id === b.id)!.isDefault).toBe(true);
  });

  const local = { name: 'Local', type: 'OLLAMA' as const, models: ['qwen2.5:14b'] };

  it('disabling the default moves the default to the next enabled provider', async () => {
    const a = await caller().create(openrouter);
    const b = await caller().create(local);
    await caller().update({ id: a.id, enabled: false });
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ enabled: false, isDefault: false });
    expect(rows.find((r) => r.id === b.id)!.isDefault).toBe(true);
  });

  it('disabling the only provider leaves no default and does not throw', async () => {
    const a = await caller().create(openrouter);
    await caller().update({ id: a.id, enabled: false });
    expect(rows.some((r) => r.isDefault)).toBe(false);
  });

  it('list tolerates rows whose secrets cannot be decrypted', async () => {
    await caller().create(openrouter);
    rows[0].apiKeyEncrypted = 'bad:xyz';
    rows[0].keyServiceTokenEncrypted = 'bad:tok';
    const [p] = await caller().list();
    expect(p).toMatchObject({ hasApiKey: true, apiKeyLast4: null, hasKeyServiceToken: true, secretsUnreadable: true });
    expect(JSON.stringify(p)).not.toContain('bad:');
  });

  it('create never makes a disabled provider default; isDefault true moves the default', async () => {
    const a = await caller().create(openrouter);
    const d = await caller().create({ ...local, name: 'Off', enabled: false, isDefault: true });
    expect(d.isDefault).toBe(false);
    const c = await caller().create({ ...local, name: 'New', isDefault: true });
    expect(c.isDefault).toBe(true);
    expect(rows.find((r) => r.id === a.id)!.isDefault).toBe(false);
  });

  it('an enabled provider created while no default exists becomes default', async () => {
    const off = await caller().create({ ...openrouter, enabled: false });
    expect(off.isDefault).toBe(false);
    const on = await caller().create(local);
    expect(on.isDefault).toBe(true);
  });

  it('enabling a provider while no default exists makes it default', async () => {
    const off = await caller().create({ ...openrouter, enabled: false });
    const res = await caller().update({ id: off.id, enabled: true });
    expect(res.isDefault).toBe(true);
  });

  it('update ignores isDefault (defaults change only via setDefault)', async () => {
    const a = await caller().create(openrouter);
    const b = await caller().create(local);
    await caller().update({ id: b.id, isDefault: true } as never);
    expect(rows.find((r) => r.id === a.id)!.isDefault).toBe(true);
    expect(rows.find((r) => r.id === b.id)!.isDefault).toBe(false);
  });

  it('changing type to OLLAMA clears secrets/key service and resets baseUrl', async () => {
    const a = await caller().create({ ...openrouter, keyServiceUrl: 'https://keys.example.com/k', keyServiceToken: 'tok' });
    await caller().update({ id: a.id, type: 'OLLAMA' });
    expect(rows[0]).toMatchObject({ apiKeyEncrypted: null, keyServiceUrl: null, keyServiceTokenEncrypted: null, baseUrl: 'http://ollama:11434' });
  });

  it('changing the baseUrl host clears the stored api key unless a new one is supplied', async () => {
    const a = await caller().create(openrouter);
    await caller().update({ id: a.id, baseUrl: 'https://openrouter.ai/api/v2' });
    expect(rows[0].apiKeyEncrypted).toBe('enc:sk-or-v1-abcd1234');
    await caller().update({ id: a.id, baseUrl: 'https://evil.example.com/v1' });
    expect(rows[0].apiKeyEncrypted).toBeNull();
    await caller().update({ id: a.id, baseUrl: 'https://other.example.com/v1', apiKey: 'new-key-9999' });
    expect(rows[0].apiKeyEncrypted).toBe('enc:new-key-9999');
  });

  it('changing the baseUrl scheme or port (same host) also clears the stored secrets', async () => {
    const a = await caller().create({ ...openrouter, keyServiceUrl: 'https://keys.example.com/k', keyServiceToken: 'tok' });
    await caller().update({ id: a.id, baseUrl: 'http://openrouter.ai/api/v1' });
    expect(rows[0].apiKeyEncrypted).toBeNull();
    await caller().update({ id: a.id, keyServiceUrl: 'https://keys.example.com:8443/k' });
    expect(rows[0].keyServiceTokenEncrypted).toBeNull();
  });

  it('changing the keyServiceUrl host clears the stored token unless a new one is supplied', async () => {
    const a = await caller().create({ ...openrouter, keyServiceUrl: 'https://keys.example.com/k', keyServiceToken: 'tok' });
    await caller().update({ id: a.id, keyServiceUrl: 'https://keys.example.com/other' });
    expect(rows[0].keyServiceTokenEncrypted).toBe('enc:tok');
    await caller().update({ id: a.id, keyServiceUrl: 'https://evil.example.com/k' });
    expect(rows[0].keyServiceTokenEncrypted).toBeNull();
    await caller().update({ id: a.id, keyServiceUrl: 'https://third.example.com/k', keyServiceToken: 'tok2' });
    expect(rows[0].keyServiceTokenEncrypted).toBe('enc:tok2');
  });

  it('remove and setDefault on a missing id return NOT_FOUND', async () => {
    await expect(caller().remove({ id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller().setDefault({ id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
