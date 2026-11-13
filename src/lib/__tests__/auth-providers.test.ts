import { describe, it, expect } from 'vitest';
import { demoLogin, isGoogleEnabled, isOpenSignupEnabled } from '@/lib/auth-providers';

describe('auth provider flags', () => {
  it('enables Google only with both id and secret', () => {
    expect(isGoogleEnabled({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toBe(true);
    expect(isGoogleEnabled({ GOOGLE_CLIENT_ID: 'id' })).toBe(false);
    expect(isGoogleEnabled({})).toBe(false);
  });
  it('open signup defaults to off', () => {
    expect(isOpenSignupEnabled({})).toBe(false);
    expect(isOpenSignupEnabled({ OPEN_SIGNUP: 'true' })).toBe(true);
    expect(isOpenSignupEnabled({ OPEN_SIGNUP: 'TRUE ' })).toBe(true);
  });
  it('exposes the demo login only in demo mode', () => {
    expect(demoLogin({})).toBeNull();
    expect(demoLogin({ DEMO_MODE: 'true', DEMO_PASSWORD: 'x' })).toBeNull();
    expect(demoLogin({ DEMO_MODE: '1' })).toEqual({ email: 'demo@example.com', password: 'metrc-manager-demo' });
    expect(demoLogin({ DEMO_MODE: '1', DEMO_EMAIL: ' Try@Example.com ', DEMO_PASSWORD: 'pw' }))
      .toEqual({ email: 'try@example.com', password: 'pw' });
  });
});
