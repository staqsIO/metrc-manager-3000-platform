'use client'

import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { DEMO_KEY_EVENT, clearDemoKey, getDemoKey, setDemoKey } from '../lib/demo-key'

/**
 * Shown only on the public demo (the demoQuota query returns null elsewhere): free questions
 * left today, and a place to use your own OpenRouter key for this tab.
 */
export default function DemoAiPanel({ busy }: { busy: boolean }) {
  const { data: quota, refetch } = trpc.copilot.demoQuota.useQuery(undefined, { staleTime: 30_000 })
  const [hasKey, setHasKey] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const sync = () => setHasKey(!!getDemoKey())
    sync()
    window.addEventListener(DEMO_KEY_EVENT, sync)
    return () => window.removeEventListener(DEMO_KEY_EVENT, sync)
  }, [])

  // A finished question changes the count.
  useEffect(() => { if (!busy) void refetch() }, [busy, refetch])

  if (!quota) return null

  const save = () => {
    if (!draft.trim()) return
    setDemoKey(draft)
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">
          {hasKey
            ? 'Using your OpenRouter key'
            : quota.houseConfigured
              ? `${quota.remaining} of ${quota.perVisitor} free questions left today`
              : 'Free questions are off. Add your own OpenRouter key to try the Copilot.'}
        </span>
        {hasKey ? (
          <button type="button" className="underline hover:text-foreground" onClick={() => clearDemoKey()}>
            Remove key
          </button>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 underline hover:text-foreground" onClick={() => setOpen((o) => !o)}>
            <KeyRound className="h-3 w-3" /> Use your own OpenRouter key
          </button>
        )}
      </div>
      {open && !hasKey && (
        <div className="mt-2 space-y-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); save() }}
          >
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              aria-label="Your OpenRouter API key"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" size="sm" className="h-7 px-3 text-xs" disabled={!draft.trim()}>Save</Button>
          </form>
          <p>
            Your key stays in this browser tab. It passes through our server for each question and is never saved.
            The demo account is shared, so other visitors can see conversations until tonight&apos;s reset.{' '}
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              Create a key with a spending limit
            </a>.
          </p>
        </div>
      )}
    </div>
  )
}
