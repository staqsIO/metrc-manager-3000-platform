import { describe, it, expect, vi } from 'vitest';

const queryRaw = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));
import handler from '@/pages/api/health';

function res() {
  const r = { statusCode: 0, body: undefined as unknown, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
  return r;
}

describe('/api/health', () => {
  it('is 200 when the database answers', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const r = res();
    await handler({} as never, r as never);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, db: 'up' });
  });
  it('is 503 when the database is down', async () => {
    queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = res();
    await handler({} as never, r as never);
    expect(r.statusCode).toBe(503);
    expect(r.body).toEqual({ ok: false, db: 'down' });
  });
});
