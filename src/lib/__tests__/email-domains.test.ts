import { describe, it, expect } from 'vitest';
import { parseDomainList, isEmailDomainAllowed } from '@/lib/email-domains';

describe('email domain allowlist', () => {
  it('parses, trims and lowercases', () => {
    expect(parseDomainList(' Example.com, foo.org ,,')).toEqual(['example.com', 'foo.org']);
  });
  it('allows everyone when the list is empty', () => {
    expect(isEmailDomainAllowed('x@anything.io', [])).toBe(true);
  });
  it('matches case-insensitively and rejects others', () => {
    const allowed = parseDomainList('example.com');
    expect(isEmailDomainAllowed('Bob@EXAMPLE.com', allowed)).toBe(true);
    expect(isEmailDomainAllowed('bob@evil.com', allowed)).toBe(false);
    expect(isEmailDomainAllowed('not-an-email', allowed)).toBe(false);
  });
});
