'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

// Mirrors MIN_PASSWORD_LENGTH in src/lib/password.ts (not imported here so
// bcryptjs stays out of the client bundle). The server enforces the real limit.
const MIN_PASSWORD_LENGTH = 10

export default function SignUpPage() {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Create an account</h2>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}

          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              setSubmitting(true)
              const form = new FormData(e.currentTarget)
              const name = String(form.get('name') ?? '').trim()
              const email = String(form.get('email') ?? '')
              const password = String(form.get('password') ?? '')
              try {
                const res = await fetch('/api/auth/signup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
                })
                if (res.status !== 201) {
                  const body = (await res.json().catch(() => null)) as { error?: string } | null
                  setError(body?.error ?? 'Sign-up is not available')
                  setSubmitting(false)
                  return
                }
                await signIn('password', { email, password, callbackUrl: '/executive' })
              } catch {
                setError('An error occurred. Please try again.')
                setSubmitting(false)
              }
            }}
          >
            <input name="name" type="text" autoComplete="name" placeholder="Name (optional)" maxLength={120}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
            <input name="email" type="email" required autoComplete="email" placeholder="Email"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
            <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
              placeholder={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" />
            <button type="submit" disabled={submitting}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Create account
            </button>
          </form>

          <p className="text-center text-sm"><a className="underline" href="/auth/signin">Already have an account? Sign in</a></p>
        </div>
      </div>
    </div>
  )
}
