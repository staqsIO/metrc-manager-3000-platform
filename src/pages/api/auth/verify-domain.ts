import type { NextApiRequest, NextApiResponse } from 'next'
import { dashboardPrisma } from '@/lib/prisma'
import { confirmChallenge } from '@/services/domain-verification'

/**
 * Public endpoint hit when a recipient clicks the verification link in a
 * domain-claim email. Looks up the domain, validates the token (compared
 * against its sha256 hash), and transitions the row VERIFYING → VERIFIED
 * inside an advisory-locked block to prevent concurrent claim races.
 *
 * Always redirects (success or failure) so the user lands on a UI page.
 * Error states surface via query params on the redirect target.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const id = typeof req.query.id === 'string' ? req.query.id : ''
  const token = typeof req.query.token === 'string' ? req.query.token : ''

  const target = (path: string): string => {
    const base = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    return base.replace(/\/$/, '') + path
  }

  if (!id || !token) {
    res.redirect(302, target('/?domain_verify=missing-params'))
    return
  }

  try {
    const result = await confirmChallenge({ prisma: dashboardPrisma, domainId: id, token })
    if (result.ok) {
      console.log(
        `[domain-verification] verified domain=${result.domain} org=${result.organizationId} via id=${id}`,
      )
      res.redirect(302, target(`/?domain_verify=success&domain=${encodeURIComponent(result.domain)}`))
      return
    }
    console.warn(`[domain-verification] verify failed reason=${result.reason} id=${id}`)
    res.redirect(302, target(`/?domain_verify=${result.reason}`))
  } catch (error) {
    console.error('[domain-verification] verify endpoint internal error:', error)
    res.redirect(302, target('/?domain_verify=internal-error'))
  }
}
