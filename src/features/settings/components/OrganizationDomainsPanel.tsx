'use client'

import { useEffect, useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { ACTIVE_ORG_COOKIE } from '@/lib/active-org'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Badge } from '@/shared/components/ui/badge'
import { Label } from '@/shared/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { CheckCircle2, Mail, Trash2, RotateCcw, ShieldAlert, Clock } from 'lucide-react'

type DomainStatus = 'PENDING' | 'VERIFYING' | 'VERIFIED' | 'REVOKED' | 'REJECTED'

const STATUS_LABEL: Record<DomainStatus, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  PENDING: { label: 'Pending', tone: 'bg-yellow-950 text-yellow-200 border-yellow-800', Icon: Clock },
  VERIFYING: { label: 'Awaiting click', tone: 'bg-yellow-950 text-yellow-200 border-yellow-800', Icon: Mail },
  VERIFIED: { label: 'Verified', tone: 'bg-emerald-950 text-emerald-200 border-emerald-800', Icon: CheckCircle2 },
  REVOKED: { label: 'Revoked', tone: 'bg-zinc-900 text-zinc-400 border-zinc-700', Icon: Trash2 },
  REJECTED: { label: 'Rejected', tone: 'bg-red-950 text-red-200 border-red-800', Icon: ShieldAlert },
}

function readActiveOrgFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${ACTIVE_ORG_COOKIE}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export default function OrganizationDomainsPanel(): React.ReactElement | null {
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  useEffect(() => {
    setActiveOrgId(readActiveOrgFromCookie())
  }, [])

  const utils = trpc.useUtils()
  const listQuery = trpc.organizationDomain.list.useQuery(
    { organizationId: activeOrgId ?? '' },
    { enabled: !!activeOrgId },
  )

  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [defaultRole, setDefaultRole] = useState<'MEMBER' | 'EDITOR'>('MEMBER')
  const [includeSubdomains, setIncludeSubdomains] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const claimMutation = trpc.organizationDomain.claim.useMutation({
    onSuccess: () => {
      setOpen(false)
      setDomain('')
      setError(null)
      void utils.organizationDomain.list.invalidate()
    },
    onError: (err) => setError(err.message),
  })
  const resendMutation = trpc.organizationDomain.resendChallenge.useMutation({
    onSuccess: () => void utils.organizationDomain.list.invalidate(),
  })
  const revokeMutation = trpc.organizationDomain.revoke.useMutation({
    onSuccess: () => void utils.organizationDomain.list.invalidate(),
  })

  type DomainRow = NonNullable<typeof listQuery.data>[number]
  const rows: DomainRow[] = useMemo(() => listQuery.data ?? [], [listQuery.data])

  if (!activeOrgId) {
    return (
      <div className="card-modern p-6">
        <p className="text-sm text-muted-foreground">No active organization selected.</p>
      </div>
    )
  }

  return (
    <div className="card-modern p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Email Domains</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Verified domains let new users from your company auto-join this organization on first
            sign-in instead of getting a personal account.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Add domain</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Claim a domain</DialogTitle>
              <DialogDescription>
                We&apos;ll email a verification link to your address. Clicking it confirms ownership.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="domain-input">Domain</Label>
                <Input
                  id="domain-input"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="example.com"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Must match your own email address. Generic providers (gmail, yahoo, etc.) cannot be claimed.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-select">Default role for new members</Label>
                <Select value={defaultRole} onValueChange={(v) => setDefaultRole(v as 'MEMBER' | 'EDITOR')}>
                  <SelectTrigger id="role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="EDITOR">Editor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeSubdomains}
                  onChange={(e) => setIncludeSubdomains(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Include subdomains
                  <span className="block text-xs text-muted-foreground">
                    Match emails on any subdomain (e.g. eng.example.com).
                  </span>
                </span>
              </label>
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={claimMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  claimMutation.mutate({
                    organizationId: activeOrgId,
                    domain: domain.trim(),
                    defaultRoleName: defaultRole,
                    includeSubdomains,
                  })
                }
                disabled={!domain.trim() || claimMutation.isPending}
              >
                {claimMutation.isPending ? 'Sending…' : 'Send verification email'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No domains claimed yet. Add one to enable auto-join for users on your company&apos;s email
          domain.
        </p>
      ) : (
        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {rows.map((row: DomainRow) => {
            const status = STATUS_LABEL[row.status as DomainStatus]
            const Icon = status.Icon
            const canResend = row.status === 'VERIFYING' || row.status === 'PENDING'
            const canRevoke = row.status !== 'REVOKED' && row.status !== 'REJECTED'
            return (
              <div key={row.id} className="flex items-center gap-4 p-4">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm">{row.domain}</span>
                    <Badge className={`${status.tone} border text-[10px] uppercase tracking-wider`} variant="outline">
                      {status.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">→ {row.defaultRoleName}</span>
                    {row.includeSubdomains ? (
                      <span className="text-xs text-muted-foreground">+ subdomains</span>
                    ) : null}
                  </div>
                  {row.challengeExpiresAt && row.status === 'VERIFYING' ? (
                    <div className="text-xs text-muted-foreground mt-1">
                      Challenge expires {new Date(row.challengeExpiresAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {canResend ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resendMutation.mutate({ domainId: row.id })}
                      disabled={resendMutation.isPending}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" /> Resend
                    </Button>
                  ) : null}
                  {canRevoke ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(`Revoke ${row.domain}? Existing memberships are preserved; only future auto-attach stops.`)) {
                          revokeMutation.mutate({ domainId: row.id })
                        }
                      }}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
