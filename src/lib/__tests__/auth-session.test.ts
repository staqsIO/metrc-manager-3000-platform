import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ prisma: {}, dashboardPrisma: {}, createPrismaClient: () => ({}) }));
import { authOptions } from '@/lib/auth';

describe('session callback', () => {
  it('defaults isPlatformAdmin to false for tokens issued before the upgrade', async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: { email: 'a@example.com' }, expires: '' },
      token: { uid: 'u1' },
    } as never) as { user: { isPlatformAdmin: boolean } };
    expect(session.user.isPlatformAdmin).toBe(false);
  });
});
