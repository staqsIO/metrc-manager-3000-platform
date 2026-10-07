import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/password';

type UserRow = { id: string; email: string; isPlatformAdmin: boolean };

export interface AdminDb {
  user: {
    findUnique(a: { where: { email: string } }): Promise<UserRow | null>;
    findFirst(a: { where: { isPlatformAdmin: true } }): Promise<UserRow | null>;
    create(a: { data: { email: string; password: string; isPlatformAdmin: true; emailVerified: Date; name?: string } }): Promise<UserRow>;
    update(a: { where: { id: string }; data: { password: string; isPlatformAdmin: true; emailVerified: Date; jwtInvalidatedAt?: Date; sessionsRevokedAt?: Date } }): Promise<UserRow>;
  };
  role: { findUnique(a: { where: { name: string } }): Promise<{ id: string } | null> };
  membership: {
    findFirst(a: { where: { userId: string } }): Promise<{ organizationId: string } | null>;
    update(a: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
      data: { roleId: string };
    }): Promise<unknown>;
  };
  organization: {
    create(a: {
      data: { name: string; slug: string; ownerId: string; memberships: { create: { userId: string; roleId: string } } };
    }): Promise<{ id: string }>;
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
}

export async function hasSuperAdmin(db: AdminDb): Promise<boolean> {
  return (await db.user.findFirst({ where: { isPlatformAdmin: true } })) !== null;
}

export async function createAdmin(
  db: AdminDb,
  input: { email: string; password: string; orgName?: string },
): Promise<{ userId: string; organizationId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Invalid email: ${input.email}`);
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const owner = await db.role.findUnique({ where: { name: 'OWNER' } });
  if (!owner) throw new Error('OWNER role missing — run migrations and seed first (docker compose run --rm web migrate)');

  const password = await hashPassword(input.password);
  const existing = await db.user.findUnique({ where: { email } });

  const orgName = input.orgName ?? 'Default Organization';
  const createOrg = (userId: string) => createOrgWithUniqueSlug(db, orgName, userId, owner.id);

  if (existing) {
    // A password reset must also revoke every existing session (sessionsRevokedAt), not just
    // force a JWT refresh, so anyone holding the old credentials is signed out.
    const now = new Date();
    await db.user.update({
      where: { id: existing.id },
      data: { password, isPlatformAdmin: true, emailVerified: now, jwtInvalidatedAt: now, sessionsRevokedAt: now },
    });
    const membership = await db.membership.findFirst({ where: { userId: existing.id } });
    if (membership) {
      await db.membership.update({
        where: { organizationId_userId: { organizationId: membership.organizationId, userId: existing.id } },
        data: { roleId: owner.id },
      });
      return { userId: existing.id, organizationId: membership.organizationId, created: false };
    }
    const org = await createOrg(existing.id);
    return { userId: existing.id, organizationId: org.id, created: false };
  }

  const user = await db.user.create({ data: { email, password, isPlatformAdmin: true, emailVerified: new Date() } });
  const org = await createOrg(user.id);
  return { userId: user.id, organizationId: org.id, created: true };
}

const MAX_SLUG_ATTEMPTS = 8;

function isSlugConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  return !Array.isArray(target) || target.includes('slug');
}

async function createOrgWithUniqueSlug(db: AdminDb, name: string, userId: string, ownerRoleId: string): Promise<{ id: string }> {
  const base = slugify(name);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      return await db.organization.create({
        data: { name, slug, ownerId: userId, memberships: { create: { userId, roleId: ownerRoleId } } },
      });
    } catch (e) {
      if (!isSlugConflict(e)) throw e;
    }
  }
  throw new Error(`Could not allocate a unique organization slug for "${name}"`);
}
