import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, update, create, membershipFindMany, facilityFindMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  membershipFindMany: vi.fn(async () => [{ organizationId: 'org-1', organization: { environment: 'PRODUCTION' } }]),
  facilityFindMany: vi.fn(async () => []),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { facilityAccess: { findMany: facilityFindMany } },
  dashboardPrisma: {},
  createPrismaClient: () => ({ user: { findUnique, update, create }, membership: { findMany: membershipFindMany } }),
}));
vi.mock('@/lib/user-organization', () => ({ createUserOrganization: vi.fn(async () => null) }));
vi.mock('@/lib/identity-map', () => ({ upsertIdentityMapping: vi.fn(async () => undefined) }));

import { authOptions } from '@/lib/auth';

const signIn = (profile: Record<string, unknown> = { email_verified: true }) =>
  authOptions.callbacks!.signIn!({
    user: { id: 'g-123', email: 'victim@example.com', name: 'V', image: null },
    account: { provider: 'google', type: 'oauth', providerAccountId: 'g-123' },
    profile,
  } as never);

describe('OAuth signIn callback', () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    create.mockReset();
  });

  it('fails closed when the user lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(signIn()).resolves.toBe('/unavailable');
  });

  it('fails closed when user creation loses a unique-constraint race', async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await expect(signIn()).resolves.toBe('/unavailable');
  });

  it('converts an unverified password account and revokes its sessions', async () => {
    findUnique.mockResolvedValue({ id: 'u1', email: 'victim@example.com', name: null, password: '$2b$12$x', emailVerified: null });
    update.mockResolvedValue({});
    await expect(signIn()).resolves.toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(data.password).toBeNull();
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
  });
});

describe('jwt callback session revocation', () => {
  beforeEach(() => findUnique.mockReset());

  it('ends the session when sessions were revoked after the token was issued', async () => {
    const authTime = Math.floor(Date.now() / 1000) - 120;
    findUnique.mockResolvedValue({ jwtInvalidatedAt: null, sessionsRevokedAt: new Date() });
    await expect(
      authOptions.callbacks!.jwt!({ token: { uid: 'u1', authTime, iat: authTime, lastFreshnessCheckAt: 0 } } as never),
    ).rejects.toThrow(/revoked/i);
  });

  it('keeps a token issued after the revocation', async () => {
    const revokedAt = new Date(Date.now() - 120_000);
    const authTime = Math.floor(revokedAt.getTime() / 1000);
    findUnique.mockResolvedValue({ jwtInvalidatedAt: null, sessionsRevokedAt: revokedAt });
    await expect(
      authOptions.callbacks!.jwt!({ token: { uid: 'u1', authTime, iat: authTime + 100, lastFreshnessCheckAt: 0 } } as never),
    ).resolves.toMatchObject({ uid: 'u1' });
  });
});

describe('jwt callback freshness (lastEnrichedAt, not iat)', () => {
  beforeEach(() => {
    findUnique.mockReset();
    membershipFindMany.mockClear();
  });
  const jwt = (token: Record<string, unknown>) =>
    authOptions.callbacks!.jwt!({ token } as never) as Promise<Record<string, unknown>>;

  it('re-enriches when invalidated after lastEnrichedAt even though iat (re-encoded) is newer', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const lastEnrichedAt = nowSec - 600;
    findUnique.mockResolvedValue({ jwtInvalidatedAt: new Date((nowSec - 300) * 1000), sessionsRevokedAt: null, isPlatformAdmin: true });
    const token = await jwt({ uid: 'u1', authTime: lastEnrichedAt, lastEnrichedAt, iat: nowSec - 5, lastFreshnessCheckAt: 0 });
    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(token.orgIds).toEqual(['org-1']);
    expect(token.isPlatformAdmin).toBe(true);
    // lastEnrichedAt advances past the invalidation so the next check does not loop.
    expect(token.lastEnrichedAt as number).toBeGreaterThanOrEqual(nowSec);

    membershipFindMany.mockClear();
    await jwt({ ...token, lastFreshnessCheckAt: 0 });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('does not re-enrich when nothing changed since lastEnrichedAt', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    findUnique.mockResolvedValue({ jwtInvalidatedAt: new Date((nowSec - 900) * 1000), sessionsRevokedAt: null });
    await jwt({ uid: 'u1', authTime: nowSec - 600, lastEnrichedAt: nowSec - 600, iat: 0, lastFreshnessCheckAt: 0 });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('stamps lastEnrichedAt on initial sign-in', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    findUnique.mockResolvedValue({ id: 'u1', isPlatformAdmin: false });
    const token = await authOptions.callbacks!.jwt!({
      token: {},
      user: { id: 'u1', email: 'a@example.com' },
      account: { provider: 'password', type: 'credentials' },
    } as never) as Record<string, unknown>;
    expect(token.lastEnrichedAt as number).toBeGreaterThanOrEqual(nowSec);
  });
});
