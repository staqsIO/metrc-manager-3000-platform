import { describe, it, expect } from 'vitest';
import { seedCore, GENERIC_EMAIL_DOMAINS, type SeedPrisma } from '@/services/setup/seed-core';

function fakePrisma() {
  const roles = new Map<string, { name: string; hierarchy: number }>();
  const domains = new Set<string>();
  const db: SeedPrisma = {
    role: {
      upsert: async ({ where, create }) => {
        if (!roles.has(where.name)) roles.set(where.name, { name: create.name, hierarchy: create.hierarchy });
        return roles.get(where.name)!;
      },
    },
    genericEmailDomain: {
      upsert: async ({ where }) => { domains.add(where.domain); return { domain: where.domain }; },
    },
  };
  return { db, roles, domains };
}

describe('seedCore', () => {
  it('creates OWNER, ADMIN, EDITOR, MEMBER with descending hierarchy', async () => {
    const { db, roles } = fakePrisma();
    await seedCore(db);
    expect(Array.from(roles.keys()).sort()).toEqual(['ADMIN', 'EDITOR', 'MEMBER', 'OWNER']);
    expect(roles.get('OWNER')!.hierarchy).toBeGreaterThan(roles.get('ADMIN')!.hierarchy);
    expect(roles.get('ADMIN')!.hierarchy).toBeGreaterThan(roles.get('EDITOR')!.hierarchy);
    expect(roles.get('EDITOR')!.hierarchy).toBeGreaterThan(roles.get('MEMBER')!.hierarchy);
  });

  it('is idempotent', async () => {
    const { db, roles, domains } = fakePrisma();
    await seedCore(db);
    await seedCore(db);
    expect(roles.size).toBe(4);
    expect(domains.size).toBe(GENERIC_EMAIL_DOMAINS.length);
  });

  it('includes gmail.com as a generic domain', () => {
    expect(GENERIC_EMAIL_DOMAINS).toContain('gmail.com');
  });
});
