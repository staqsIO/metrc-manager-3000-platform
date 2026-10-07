import { describe, it, expect } from 'vitest';
import { isOAuthEmailVerified, existingUserLinkUpdate, isTokenRevoked } from '@/lib/oauth-link';

describe('isOAuthEmailVerified', () => {
  it('rejects a Google profile whose email is not verified', () => {
    expect(isOAuthEmailVerified('google', { email_verified: false })).toBe(false);
    expect(isOAuthEmailVerified('google', {})).toBe(false);
    expect(isOAuthEmailVerified('google', undefined)).toBe(false);
    expect(isOAuthEmailVerified('google', { email_verified: 'true' })).toBe(false);
  });
  it('accepts a Google profile with email_verified === true', () => {
    expect(isOAuthEmailVerified('google', { email_verified: true })).toBe(true);
  });
  it('rejects providers that are not explicitly handled', () => {
    expect(isOAuthEmailVerified('github', { email_verified: true })).toBe(false);
  });
});

describe('existingUserLinkUpdate', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  it('converts an unverified password account: clears password and sets emailVerified', () => {
    expect(existingUserLinkUpdate({ password: '$2b$12$hash', emailVerified: null }, now)).toEqual({
      password: null,
      emailVerified: now,
      sessionsRevokedAt: now,
      jwtInvalidatedAt: now,
    });
  });
  it('sets emailVerified for a passwordless unverified account without touching password', () => {
    expect(existingUserLinkUpdate({ password: null, emailVerified: null }, now)).toEqual({ emailVerified: now });
  });
  it('leaves an already-verified account alone (password kept)', () => {
    expect(existingUserLinkUpdate({ password: '$2b$12$hash', emailVerified: new Date(0) }, now)).toBeNull();
  });
});

describe('isTokenRevoked', () => {
  const authSec = 1_791_331_200; // 2026-10-07T00:00:00Z
  it('is false when the user has no revocation', () => {
    expect(isTokenRevoked(authSec, null)).toBe(false);
    expect(isTokenRevoked(authSec, undefined)).toBe(false);
  });
  it('is true when sessions were revoked after the token was issued', () => {
    expect(isTokenRevoked(authSec, new Date((authSec + 10) * 1000))).toBe(true);
  });
  it('is false when revoked in the same second the token was issued (the converting sign-in)', () => {
    expect(isTokenRevoked(authSec, new Date(authSec * 1000))).toBe(false);
    expect(isTokenRevoked(authSec, new Date(authSec * 1000 + 999))).toBe(false);
  });
  it('is false for a token issued after the revocation', () => {
    expect(isTokenRevoked(authSec + 5, new Date(authSec * 1000))).toBe(false);
  });
  it('treats a token with no auth time (pre-upgrade) as revoked once a revocation exists', () => {
    expect(isTokenRevoked(undefined, new Date(authSec * 1000))).toBe(true);
  });
});
