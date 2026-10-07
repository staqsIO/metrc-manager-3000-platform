import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, platformProcedure } from '@/lib/trpc'
import { dashboardPrisma } from '@/lib/prisma'
import { claimDomain, revokeDomain } from '@/services/domain-verification'

const ADMIN_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN'])

async function requireOrgAdmin(userId: string, organizationId: string): Promise<void> {
  const membership = await dashboardPrisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { roleRef: { select: { name: true } } },
  })
  if (!membership || !ADMIN_ROLES.has(membership.roleRef.name)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin role required on this organization to manage domains.',
    })
  }
}

function appUrlFromEnv(): string {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

export const organizationDomainRouter = createTRPCRouter({
  list: platformProcedure
    .input(z.object({ organizationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      // Members can read domain claims for orgs they belong to.
      const membership = await dashboardPrisma.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: input.organizationId, userId: ctx.session.user.id },
        },
        select: { id: true },
      })
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization.' })
      }

      return dashboardPrisma.organizationDomain.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          domain: true,
          status: true,
          method: true,
          defaultRoleName: true,
          includeSubdomains: true,
          challengeExpiresAt: true,
          verifiedAt: true,
          createdAt: true,
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      })
    }),

  claim: platformProcedure
    .input(
      z.object({
        organizationId: z.string().cuid(),
        domain: z
          .string()
          .min(3)
          .max(253)
          .regex(/^[A-Za-z0-9.-]+$/, 'Domain may only contain letters, digits, dots, and hyphens.'),
        defaultRoleName: z.enum(['MEMBER', 'EDITOR']).default('MEMBER'),
        includeSubdomains: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.session.user.id, input.organizationId)

      const claimer = await dashboardPrisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { email: true },
      })
      if (!claimer?.email) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Claimer has no email on file.' })
      }

      const result = await claimDomain({
        prisma: dashboardPrisma,
        organizationId: input.organizationId,
        domain: input.domain,
        claimerUserId: ctx.session.user.id,
        claimerEmail: claimer.email,
        defaultRoleName: input.defaultRoleName,
        includeSubdomains: input.includeSubdomains,
        appUrl: appUrlFromEnv(),
      })

      if (result.status === 'REJECTED') {
        const messages: Record<string, string> = {
          'invalid-domain': 'That domain is not a valid email domain.',
          'invalid-claimer-email': 'Your account email is not valid.',
          'claimer-not-on-domain':
            'You can only claim a domain that matches your own email address. Sign in with an email at this domain.',
          'generic-provider': 'Generic mailbox providers (gmail, yahoo, etc.) cannot be claimed.',
          'already-verified-by-other-org':
            'This domain is already verified by another organization. Contact support.',
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: messages[result.reason ?? ''] ?? 'Domain claim rejected.',
        })
      }

      return {
        domainId: result.domainId,
        status: result.status,
        emailSent: result.emailSent,
      }
    }),

  resendChallenge: platformProcedure
    .input(z.object({ domainId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await dashboardPrisma.organizationDomain.findUnique({
        where: { id: input.domainId },
        select: { id: true, organizationId: true, domain: true, defaultRoleName: true, includeSubdomains: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireOrgAdmin(ctx.session.user.id, row.organizationId)

      const claimer = await dashboardPrisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { email: true },
      })
      if (!claimer?.email) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Claimer has no email on file.' })
      }

      const result = await claimDomain({
        prisma: dashboardPrisma,
        organizationId: row.organizationId,
        domain: row.domain,
        claimerUserId: ctx.session.user.id,
        claimerEmail: claimer.email,
        defaultRoleName: row.defaultRoleName,
        includeSubdomains: row.includeSubdomains,
        appUrl: appUrlFromEnv(),
      })
      return { status: result.status, emailSent: result.emailSent }
    }),

  revoke: platformProcedure
    .input(z.object({ domainId: z.string().cuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await dashboardPrisma.organizationDomain.findUnique({
        where: { id: input.domainId },
        select: { id: true, organizationId: true },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      await requireOrgAdmin(ctx.session.user.id, row.organizationId)

      const result = await revokeDomain({
        prisma: dashboardPrisma,
        domainId: input.domainId,
        organizationId: row.organizationId,
        actorUserId: ctx.session.user.id,
        reason: input.reason,
      })
      if (!result.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.reason === 'not-found' ? 'Domain not found.' : 'Domain not in a revocable state.',
        })
      }
      return { ok: true }
    }),
})
