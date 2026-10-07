import { describe, it, expect } from 'vitest';
import { resolveDatabaseUrls } from '@/lib/prisma';

describe('resolveDatabaseUrls', () => {
  it('uses DATABASE_URL for both when DASHBOARD_DATABASE_URL is unset', () => {
    const r = resolveDatabaseUrls({ DATABASE_URL: 'postgresql://u:p@db:5432/app' });
    expect(r).toEqual({ metrcUrl: 'postgresql://u:p@db:5432/app', dashboardUrl: 'postgresql://u:p@db:5432/app' });
  });
  it('honors an explicit DASHBOARD_DATABASE_URL', () => {
    const r = resolveDatabaseUrls({ DATABASE_URL: 'postgresql://a', DASHBOARD_DATABASE_URL: 'postgresql://b' });
    expect(r.dashboardUrl).toBe('postgresql://b');
  });
  it('trims whitespace', () => {
    expect(resolveDatabaseUrls({ DATABASE_URL: ' postgresql://a\n' }).metrcUrl).toBe('postgresql://a');
  });
  it('throws without DATABASE_URL', () => {
    expect(() => resolveDatabaseUrls({})).toThrow('DATABASE_URL is not set');
  });
});
