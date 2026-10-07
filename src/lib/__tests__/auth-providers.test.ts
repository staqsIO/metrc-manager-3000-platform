import { describe, it, expect } from 'vitest';
import { isGoogleEnabled, isOpenSignupEnabled } from '@/lib/auth-providers';

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
});
