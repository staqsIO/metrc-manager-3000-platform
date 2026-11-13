import { describe, it, expect } from 'vitest';
import { getBrand, mergeBrandEnv } from '@/lib/brand';

describe('getBrand', () => {
  it('defaults to METRC Manager 3000', () => {
    expect(getBrand({})).toEqual({
      name: 'METRC Manager 3000',
      logoUrl: '/brand/logo.svg',
      supportEmail: 'support@staqs.io',
      emailFrom: 'METRC Manager 3000 <noreply@staqs.io>',
      appUrl: 'http://localhost:3000',
    });
  });
  it('honors overrides and derives emailFrom from the name', () => {
    const b = getBrand({ NEXT_PUBLIC_BRAND_NAME: 'Acme', SUPPORT_EMAIL: 'help@acme.test', APP_URL: 'https://acme.test/' });
    expect(b.name).toBe('Acme');
    expect(b.emailFrom).toBe('Acme <noreply@staqs.io>');
    expect(b.appUrl).toBe('https://acme.test');
  });
  it('falls back to NEXTAUTH_URL for appUrl', () => {
    expect(getBrand({ NEXTAUTH_URL: 'https://x.test' }).appUrl).toBe('https://x.test');
  });
  it('reads name/logo only from NEXT_PUBLIC_* (runtime BRAND_NAME / BRAND_LOGO_URL are ignored)', () => {
    const b = getBrand({ NEXT_PUBLIC_BRAND_NAME: 'Pub', BRAND_NAME: 'Srv', NEXT_PUBLIC_BRAND_LOGO_URL: '/p.svg', BRAND_LOGO_URL: '/s.svg' });
    expect(b.name).toBe('Pub');
    expect(b.logoUrl).toBe('/p.svg');
    expect(b.emailFrom).toBe('Pub <noreply@staqs.io>');
    const d = getBrand({ BRAND_NAME: 'Srv', BRAND_LOGO_URL: '/s.svg' });
    expect(d.name).toBe('METRC Manager 3000');
    expect(d.logoUrl).toBe('/brand/logo.svg');
  });
});

describe('mergeBrandEnv', () => {
  it('lets the build-time NEXT_PUBLIC_* values win over runtime env so server and client agree', () => {
    const env = mergeBrandEnv(
      { NEXT_PUBLIC_BRAND_NAME: 'Build', NEXT_PUBLIC_BRAND_LOGO_URL: '/build.svg' },
      { NEXT_PUBLIC_BRAND_NAME: 'Runtime', NEXT_PUBLIC_BRAND_LOGO_URL: '/runtime.svg', SUPPORT_EMAIL: 'help@x.test' },
    );
    expect(getBrand(env)).toMatchObject({ name: 'Build', logoUrl: '/build.svg', supportEmail: 'help@x.test' });
  });
  it('ignores a runtime NEXT_PUBLIC_* value when none was set at build time', () => {
    const env = mergeBrandEnv({ NEXT_PUBLIC_BRAND_NAME: undefined, NEXT_PUBLIC_BRAND_LOGO_URL: undefined }, { NEXT_PUBLIC_BRAND_NAME: 'Runtime' });
    expect(getBrand(env).name).toBe('METRC Manager 3000');
  });
  it('uses only the inlined values in the browser (no runtime env)', () => {
    expect(getBrand(mergeBrandEnv({ NEXT_PUBLIC_BRAND_NAME: 'Build' }, null)).name).toBe('Build');
  });
});
