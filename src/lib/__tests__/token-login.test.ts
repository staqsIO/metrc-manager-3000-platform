import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { verifyAutoLoginToken } from '@/lib/token-login';

const ISSUER = 'https://portal.example.com/.well-known/jwks.json';
let token: string;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));
  token = await new SignJWT({ email: 'user@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setExpirationTime('5m')
    .sign(privateKey);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('verifyAutoLoginToken', () => {
  it('trusts issuers from the runtime AUTO_LOGIN_ISSUER_WHITELIST', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTO_LOGIN_ISSUER_WHITELIST', '');
    vi.stubEnv('AUTO_LOGIN_ISSUER_WHITELIST', `https://other.example.com, ${ISSUER}`);
    await expect(verifyAutoLoginToken(token)).resolves.toEqual({ email: 'user@example.com' });
  });

  it('rejects issuers that are not whitelisted (empty list trusts nobody)', async () => {
    vi.stubEnv('AUTO_LOGIN_ISSUER_WHITELIST', '');
    vi.stubEnv('NEXT_PUBLIC_AUTO_LOGIN_ISSUER_WHITELIST', ISSUER);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(verifyAutoLoginToken(token)).resolves.toBeNull();
  });
});
