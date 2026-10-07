import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, authorizePassword } from '@/lib/password';

describe('password', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password!!', h)).toBe(false);
  });
  it('rejects when no hash is stored', async () => {
    expect(await verifyPassword('anything-long', null)).toBe(false);
  });
  it('resolves false without throwing for a null hash (dummy hash is well-formed)', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
  });
});

describe('authorizePassword', () => {
  const user = async (pw: string) => ({ id: 'u1', email: 'a@example.com', name: 'A', image: null, password: await hashPassword(pw) });

  it('returns the user for valid credentials, normalizing email case', async () => {
    const u = await user('long-enough-pw');
    const db = { user: { findUnique: async ({ where }: { where: { email: string } }) => (where.email === 'a@example.com' ? u : null) } };
    await expect(authorizePassword(db, 'A@Example.com ', 'long-enough-pw')).resolves.toMatchObject({ id: 'u1' });
  });
  it('returns null for unknown email and for wrong password', async () => {
    const u = await user('long-enough-pw');
    const db = { user: { findUnique: async ({ where }: { where: { email: string } }) => (where.email === 'a@example.com' ? u : null) } };
    await expect(authorizePassword(db, 'nobody@example.com', 'long-enough-pw')).resolves.toBeNull();
    await expect(authorizePassword(db, 'a@example.com', 'nope-nope-nope')).resolves.toBeNull();
  });
});
