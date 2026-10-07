import { describe, it, expect } from 'vitest';
import { createAdmin, hasSuperAdmin, type AdminDb } from '@/services/setup/create-admin';
import { verifyPassword } from '@/lib/password';

type U = { id: string; email: string; password: string | null; isPlatformAdmin: boolean; name: string | null; sessionsRevokedAt?: Date };
type M = { organizationId: string; userId: string; roleId: string };

function fakeDb() {
  const users: U[] = [];
  const orgs: { id: string; name: string; slug: string; ownerId: string }[] = [];
  const memberships: M[] = [];
  const roles = [{ id: 'r-owner', name: 'OWNER' }];
  let n = 0;
  const db: AdminDb = {
    user: {
      findUnique: async ({ where }) => users.find((u) => u.email === where.email) ?? null,
      findFirst: async ({ where }) => users.find((u) => u.isPlatformAdmin === where.isPlatformAdmin) ?? null,
      create: async ({ data }) => { const u = { id: `u${++n}`, name: null, ...data } as U; users.push(u); return u; },
      update: async ({ where, data }) => { const u = users.find((x) => x.id === where.id)!; Object.assign(u, data); return u; },
    },
    role: { findUnique: async ({ where }) => roles.find((r) => r.name === where.name) ?? null },
    membership: {
      findFirst: async ({ where }) => memberships.find((m) => m.userId === where.userId) ?? null,
      update: async ({ where, data }) => {
        const m = memberships.find((x) => x.organizationId === where.organizationId_userId.organizationId && x.userId === where.organizationId_userId.userId)!;
        Object.assign(m, data); return m;
      },
    },
    organization: {
      create: async ({ data }) => {
        const o = { id: `o${++n}`, name: data.name, slug: data.slug, ownerId: data.ownerId };
        orgs.push(o);
        memberships.push({ organizationId: o.id, userId: data.memberships.create.userId, roleId: data.memberships.create.roleId });
        return o;
      },
    },
  };
  return { db, users, orgs, memberships };
}

describe('createAdmin', () => {
  it('creates a super admin who owns a new organization', async () => {
    const { db, users, orgs, memberships } = fakeDb();
    const r = await createAdmin(db, { email: 'Admin@Example.com', password: 'very-secret-pw', orgName: 'Acme' });
    expect(r.created).toBe(true);
    expect(users[0]).toMatchObject({ email: 'admin@example.com', isPlatformAdmin: true });
    expect(await verifyPassword('very-secret-pw', users[0].password)).toBe(true);
    expect(orgs[0].name).toBe('Acme');
    expect(memberships[0]).toMatchObject({ userId: users[0].id, roleId: 'r-owner' });
    expect(await hasSuperAdmin(db)).toBe(true);
  });

  it('promotes an existing member and resets the password without a second org', async () => {
    const { db, users, orgs, memberships } = fakeDb();
    users.push({ id: 'u-old', email: 'bob@example.com', password: null, isPlatformAdmin: false, name: 'Bob' });
    memberships.push({ organizationId: 'o-old', userId: 'u-old', roleId: 'r-member' });
    const r = await createAdmin(db, { email: 'bob@example.com', password: 'new-password-1' });
    expect(r).toMatchObject({ userId: 'u-old', organizationId: 'o-old', created: false });
    expect(users[0].isPlatformAdmin).toBe(true);
    expect(await verifyPassword('new-password-1', users[0].password)).toBe(true);
    expect(orgs).toHaveLength(0);
    expect(memberships[0].roleId).toBe('r-owner');
  });

  it('revokes existing sessions when resetting an existing user password', async () => {
    const { db, users } = fakeDb();
    users.push({ id: 'u-old', email: 'bob@example.com', password: null, isPlatformAdmin: false, name: 'Bob' });
    const before = Date.now();
    await createAdmin(db, { email: 'bob@example.com', password: 'new-password-1' });
    expect(users[0].sessionsRevokedAt).toBeInstanceOf(Date);
    expect(users[0].sessionsRevokedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects short passwords', async () => {
    const { db } = fakeDb();
    await expect(createAdmin(db, { email: 'a@example.com', password: 'short' })).rejects.toThrow(/at least 10/);
  });

  it('fails clearly when roles are not seeded', async () => {
    const { db } = fakeDb();
    db.role.findUnique = async () => null;
    await expect(createAdmin(db, { email: 'a@example.com', password: 'long-enough-1' })).rejects.toThrow(/run migrations/i);
  });

  it('gives an existing user without a membership an organization', async () => {
    const { db, users, orgs, memberships } = fakeDb();
    users.push({ id: 'u-solo', email: 'solo@example.com', password: null, isPlatformAdmin: false, name: null });
    const r = await createAdmin(db, { email: 'solo@example.com', password: 'solo-password-1', orgName: 'Solo Co' });
    expect(r).toMatchObject({ userId: 'u-solo', created: false });
    expect(orgs).toHaveLength(1);
    expect(orgs[0].slug).toBe('solo-co');
    expect(memberships[0]).toMatchObject({ userId: 'u-solo', roleId: 'r-owner' });
  });

  it('uses the same default slug on both paths', async () => {
    const a = fakeDb();
    await createAdmin(a.db, { email: 'a@example.com', password: 'long-enough-1' });
    const b = fakeDb();
    b.users.push({ id: 'u-x', email: 'x@example.com', password: null, isPlatformAdmin: false, name: null });
    await createAdmin(b.db, { email: 'x@example.com', password: 'long-enough-1' });
    expect(a.orgs[0].slug).toBe(b.orgs[0].slug);
  });

  it('retries with -2 when the slug is taken (P2002)', async () => {
    const { db, orgs } = fakeDb();
    const real = db.organization.create;
    const seen: string[] = [];
    db.organization.create = async (a) => {
      seen.push(a.data.slug);
      if (seen.length === 1) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['slug'] } });
      return real(a);
    };
    await createAdmin(db, { email: 'a@example.com', password: 'long-enough-1', orgName: 'Acme' });
    expect(seen).toEqual(['acme', 'acme-2']);
    expect(orgs[0].slug).toBe('acme-2');
  });

  it('does not retry on unrelated errors', async () => {
    const { db } = fakeDb();
    db.organization.create = async () => { throw new Error('boom'); };
    await expect(createAdmin(db, { email: 'a@example.com', password: 'long-enough-1' })).rejects.toThrow('boom');
  });
});
