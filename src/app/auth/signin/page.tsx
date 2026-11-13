'use client'

import { useState, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { getBrand } from '@/lib/brand'
import { BrandMark } from '@/shared/components/BrandMark'

// Full page load, not router.push: the root layout renders the sidebar and other
// signed-in chrome server-side from the session, and App Router keeps that layout
// (rendered while signed out) across client-side navigation.
function goToApp() {
  window.location.assign('/executive')
}

export default function SignInPage() {
  const brand = getBrand()
  const [error, setError] = useState('')
  const [isAutoLogging, setIsAutoLogging] = useState(false)
  const [providers, setProviders] = useState<{ google: boolean; signupEnabled: boolean; demo?: { email: string; password: string } | null } | null>(null)

  useEffect(() => {
    fetch('/api/auth/options')
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => setProviders({ google: false, signupEnabled: false }))
  }, [])

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    const params = new URLSearchParams(hash)
    const token = params.get('token')

    if (!token) return

    const runAutoLogin = async () => {
      setError('')
      setIsAutoLogging(true)

      try {
        // The token is verified server side by the portal credentials provider
        // (issuer whitelist is runtime AUTO_LOGIN_ISSUER_WHITELIST).
        const result = await signIn('credentials', {
          token,
          redirect: false,
        })

        if (result?.error) {
          setError('Invalid or expired token')
          setIsAutoLogging(false)
        } else {
          goToApp()
        }
      } catch {
        setError('An error occurred. Please try again.')
        setIsAutoLogging(false)
      } finally {
        // Clean token from URL
        const newUrl = `${window.location.pathname}${window.location.search}`
        window.history.replaceState(null, '', newUrl)
      }
    }

    runAutoLogin()
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
            <BrandMark />
          </div>
          <h2 className="text-2xl font-bold">{brand.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cannabis compliance and inventory intelligence
          </p>
        </div>

        {isAutoLogging ? (
          <div className="text-center py-4">
            <div className="flex justify-center gap-1 mb-3">
              <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
                {error}
              </div>
            )}

            {providers?.demo && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                <p className="font-medium">Public demo — fictional data, reset every night.</p>
                <p className="mt-1 text-muted-foreground">
                  Email <code>{providers.demo.email}</code> · Password <code>{providers.demo.password}</code>
                </p>
              </div>
            )}

            <form
              key={providers?.demo ? 'demo' : 'default'}
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault()
                setError('')
                const form = new FormData(e.currentTarget)
                const res = await signIn('password', {
                  email: String(form.get('email') ?? ''),
                  password: String(form.get('password') ?? ''),
                  redirect: false,
                })
                if (res?.error) setError('Invalid email or password')
                else goToApp()
              }}
            >
              <input name="email" type="email" required autoComplete="email" placeholder="Email" defaultValue={providers?.demo?.email}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
              <input name="password" type="password" required autoComplete="current-password" placeholder="Password" defaultValue={providers?.demo?.password}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
              <button type="submit"
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
                Sign in
              </button>
            </form>
            {providers?.google && (
              <button
                onClick={() => signIn('google', { callbackUrl: '/executive' })}
                className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>
            )}
            {providers?.signupEnabled && (
              <p className="text-center text-sm"><a className="underline" href="/auth/signup">Create an account</a></p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
