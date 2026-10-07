import { describe, it, expect, vi, beforeEach } from 'vitest';

const membershipUpsert = vi.fn();
const orgCreate = vi.fn(async () => ({ id: 'org-personal', name: "A's Org", slug: 'a-org' }));
const findClaimingOrg = vi.fn();
const fakePrisma = {
  membership: { findFirst: vi.fn(async () => null), upsert: membershipUpsert },
  organization: {
    findUnique: vi.fn(async () => ({ id: 'org-customer', name: 'Customer', slug: 'customer' })),
    create: orgCreate,
  },
};

vi.mock('@/lib/prisma', () => ({ createPrismaClient: () => fakePrisma }));
vi.mock('@/lib/role-lookup', () => ({ getRoleIdByName: async (name: string) => `role-${name}` }));
vi.mock('@/services/domain-verification', () => ({
  createDomainMatchService: () => ({ findClaimingOrg }),
}));

import { createUserOrganization } from '@/lib/user-organization';

describe('createUserOrganization domain-claim gating', () => {
  beforeEach(() => {
    membershipUpsert.mockReset();
    orgCreate.mockClear();
    findClaimingOrg.mockReset();
    findClaimingOrg.mockResolvedValue({ organizationId: 'org-customer', defaultRoleName: 'MEMBER', domainId: 'd1' });
  });

  it('attaches via a verified domain claim by default', async () => {
    const r = await createUserOrganization({ userId: 'u1', userName: 'A', userEmail: 'a@customer.com' });
    expect(r?.reason).toBe('domain-claim');
    expect(membershipUpsert).toHaveBeenCalledTimes(1);
  });

  it('never attaches via a claim when allowDomainClaim is false; creates a personal org instead', async () => {
    const r = await createUserOrganization({ userId: 'u1', userName: 'A', userEmail: 'a@customer.com', allowDomainClaim: false });
    expect(membershipUpsert).not.toHaveBeenCalled();
    expect(findClaimingOrg).not.toHaveBeenCalled();
    expect(r?.reason).toBe('personal-org-created');
    expect(orgCreate).toHaveBeenCalledTimes(1);
  });
});
