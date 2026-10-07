import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { parseDomainList, isEmailDomainAllowed } from '@/lib/email-domains'

/**
 * Edge Middleware — gates platform access.
 *
 * Order of checks:
 *   1. Signed-in users who are members of any organization → allow. Membership
 *      is the gate: once an admin (or a domain claim) has attached a user to an
 *      org, that user has platform access regardless of email domain.
 *   2. Signed-in users with no memberships → allowed through only when their
 *      email domain is in the ALLOWED_EMAIL_DOMAINS env list (comma-separated),
 *      so they can finish onboarding. An empty/unset list lets nobody without
 *      a membership through.
 *   3. Anyone else → redirect to /unavailable.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow passthrough routes (auth flow, static assets, info pages)
  const passthroughPrefixes = [
    '/unavailable',
    '/auth',
    '/api/auth',
    '/api/cron',
    '/api/health',
    '/_next',
    '/favicon',
    '/brand/',
  ]

  if (passthroughPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // Decode the NextAuth JWT to get the user's email
  const token = await getToken({ req: request })

  // Not signed in — send to sign-in page so they can authenticate first
  if (!token) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/signin'
    return NextResponse.redirect(url)
  }

  // Signed in + at least one org membership → allow.
  const orgIds = (token.orgIds as string[] | undefined) ?? []
  if (orgIds.length > 0) {
    return NextResponse.next()
  }

  // No memberships yet — let users from ALLOWED_EMAIL_DOMAINS through so they
  // can finish onboarding.
  const email = token.email as string | undefined
  const allowed = parseDomainList(process.env.ALLOWED_EMAIL_DOMAINS)
  if (email && allowed.length > 0 && isEmailDomainAllowed(email, allowed)) {
    return NextResponse.next()
  }

  // No memberships, non-allowed domain → block.
  const url = request.nextUrl.clone()
  url.pathname = '/unavailable'
  return NextResponse.redirect(url)
}

export const config = {
  // Skip Next internals and static public files (logos, favicons, fonts) so
  // they load signed out (sign-in page, /unavailable, emails). The extension
  // skip never applies under /api/ (e.g. tRPC batch `/api/trpc/a.list,b.png`),
  // so API requests always pass the membership gate.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff|woff2)$).*)',
  ],
}
