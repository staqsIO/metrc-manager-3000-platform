import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { dashboardPrisma } from '@/lib/prisma'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/password'
import { isOpenSignupEnabled } from '@/lib/auth-providers'
import { isEmailDomainAllowed, parseDomainList } from '@/lib/email-domains'
import { createUserOrganization } from '@/lib/user-organization'

const Body = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  name: z.string().trim().max(120).optional(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isOpenSignupEnabled(process.env)) return res.status(404).end()
  if (req.method !== 'POST') return res.status(405).end()
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and email valid` })
  const { email, password, name } = parsed.data
  if (!isEmailDomainAllowed(email, parseDomainList(process.env.ALLOWED_EMAIL_DOMAINS))) {
    return res.status(403).json({ error: 'Sign-up is not allowed for this email domain' })
  }
  const existing = await dashboardPrisma.user.findUnique({ where: { email } })
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' })
  const user = await dashboardPrisma.user.create({
    data: { email, name: name ?? null, password: await hashPassword(password) },
  })
  // Password sign-up does not prove email ownership: never attach via a
  // verified-domain claim, only bootstrap a personal org.
  await createUserOrganization({ userId: user.id, userName: user.name, userEmail: email, allowDomainClaim: false })
  return res.status(201).json({ ok: true })
}
