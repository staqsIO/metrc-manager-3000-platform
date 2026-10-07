import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const db = {
    membership: { findMany: vi.fn(async () => []) },
    notification: { count: vi.fn(async () => 0) },
  };
  return { prisma: db, dashboardPrisma: db };
});
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { createCallerFactory } from '@/lib/trpc';
import { prisma } from '@/lib/prisma';
import { organizationRouter } from '@/server/api/routers/organization';
import { notificationsRouter } from '@/server/api/routers/notifications';

const ctx = { prisma, session: { user: { id: 'u1', email: 'a@example.com' } }, activeOrgId: null } as never;

describe('METRC_PLATFORM_ENABLED kill switch on non-facility procedures', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('rejects formerly subscription-gated procedures with FORBIDDEN when disabled', async () => {
    vi.stubEnv('METRC_PLATFORM_ENABLED', 'false');
    await expect(createCallerFactory(organizationRouter)(ctx).list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createCallerFactory(notificationsRouter)(ctx).unreadCount()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows them when enabled', async () => {
    vi.stubEnv('METRC_PLATFORM_ENABLED', 'true');
    await expect(createCallerFactory(organizationRouter)(ctx).list()).resolves.toBeDefined();
  });
});
