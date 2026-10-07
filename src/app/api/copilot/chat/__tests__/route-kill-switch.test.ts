import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {}, dashboardPrisma: {} }));
vi.mock('@/services/copilot/copilot-service', () => ({ executeCopilotQuery: vi.fn(), checkCopilotRateLimit: vi.fn(() => true) }));
vi.mock('@/lib/auth-helpers', () => ({ getUserOrgIds: vi.fn(async () => []) }));

import { POST } from '../route';

describe('copilot chat route kill switch', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns 403 when METRC_PLATFORM_ENABLED=false', async () => {
    vi.stubEnv('METRC_PLATFORM_ENABLED', 'false');
    const res = await POST(new NextRequest('http://localhost:3000/api/copilot/chat', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/unavailable/i);
  });
});
