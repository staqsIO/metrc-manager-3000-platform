export const GENERIC_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
] as const;

const ROLES = [
  { name: 'OWNER', displayName: 'Owner', hierarchy: 100, description: 'Full control of the organization' },
  { name: 'ADMIN', displayName: 'Admin', hierarchy: 50, description: 'Manage members and facilities' },
  { name: 'EDITOR', displayName: 'Editor', hierarchy: 30, description: 'Use the platform and edit organization content' },
  { name: 'MEMBER', displayName: 'Member', hierarchy: 10, description: 'Use the platform' },
] as const;

export interface SeedPrisma {
  role: {
    upsert(args: {
      where: { name: string };
      create: { name: string; displayName: string; hierarchy: number; description: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  genericEmailDomain: {
    upsert(args: {
      where: { domain: string };
      create: { domain: string; source: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
}

/** Idempotently creates the rows every installation needs. */
export async function seedCore(prisma: SeedPrisma): Promise<{ roles: number; genericDomains: number }> {
  for (const r of ROLES) {
    await prisma.role.upsert({ where: { name: r.name }, create: { ...r }, update: {} });
  }
  for (const domain of GENERIC_EMAIL_DOMAINS) {
    await prisma.genericEmailDomain.upsert({ where: { domain }, create: { domain, source: 'seed' }, update: {} });
  }
  return { roles: ROLES.length, genericDomains: GENERIC_EMAIL_DOMAINS.length };
}
