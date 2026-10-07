'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

/**
 * Reads the `?domain_verify=<reason>` query param emitted by the public
 * `/api/auth/verify-domain` redirect, surfaces a dismissible banner with the
 * verification result, then strips the param from the URL via replaceState.
 *
 * See ADR-020 Phase 2 (FOR-1483 follow-up).
 */
const REASON_TO_MESSAGE: Record<string, { tone: 'success' | 'error'; title: string; subtitle: string }> = {
  success: {
    tone: 'success',
    title: 'Domain verified',
    subtitle: 'New users on this domain will join your organization automatically.',
  },
  expired: {
    tone: 'error',
    title: 'Verification link expired',
    subtitle: 'Open the org settings to resend the verification email.',
  },
  conflict: {
    tone: 'error',
    title: 'Domain already verified by another organization',
    subtitle: 'Contact support — only one organization can claim a domain at a time.',
  },
  'token-mismatch': {
    tone: 'error',
    title: 'Verification token invalid',
    subtitle: 'Request a new verification email from your organization settings.',
  },
  'wrong-status': {
    tone: 'error',
    title: 'Verification not pending',
    subtitle: 'This domain is not currently awaiting verification.',
  },
  'not-found': {
    tone: 'error',
    title: 'Verification record not found',
    subtitle: 'The link may have been revoked. Try claiming the domain again.',
  },
  'missing-params': {
    tone: 'error',
    title: 'Invalid verification link',
    subtitle: 'The link was malformed. Try the email link again or request a fresh one.',
  },
  'internal-error': {
    tone: 'error',
    title: 'Verification failed',
    subtitle: 'Something went wrong on our side. Try again or contact support.',
  },
}

export default function DomainVerifyBanner(): React.ReactElement | null {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)

  const reason = searchParams?.get('domain_verify') ?? null
  const domain = searchParams?.get('domain') ?? null

  useEffect(() => {
    if (!reason) return
    // Strip the param from the URL once the banner is rendered (replaceState
    // so navigation history isn't polluted, but state stays around so the
    // banner persists until the user dismisses or navigates away).
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('domain_verify')
    params.delete('domain')
    const newPath = params.toString() ? `${pathname}?${params.toString()}` : pathname
    window.history.replaceState({}, '', newPath)
    // We intentionally don't router.replace here — that triggers a re-render
    // and would unmount the banner before the user reads it.
  }, [reason, pathname, router, searchParams])

  if (!reason || dismissed) return null
  const meta = REASON_TO_MESSAGE[reason] ?? REASON_TO_MESSAGE['internal-error']

  const tone =
    meta.tone === 'success'
      ? 'border-emerald-700 bg-emerald-950 text-emerald-100'
      : 'border-red-800 bg-red-950 text-red-100'
  const Icon = meta.tone === 'success' ? CheckCircle2 : AlertTriangle

  return (
    <div role="status" aria-live="polite" className={`w-full border-b ${tone}`} data-testid="domain-verify-banner">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3 text-sm">
        <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-semibold">
            {meta.title}
            {domain ? <span className="ml-1 font-mono text-xs opacity-90">({domain})</span> : null}
          </div>
          <div className="text-xs opacity-80">{meta.subtitle}</div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 hover:bg-black/20 focus-visible:outline focus-visible:outline-2"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
