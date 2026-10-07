'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { ProviderForm, EMPTY, type ProviderFormValues, type ProviderType } from '@/features/admin/llm-providers/ProviderForm';

export default function LlmProvidersPage() {
  const { data: session, status } = useSession();
  const isAdmin = Boolean(session?.user?.isPlatformAdmin);
  // The client check is UX only; the router enforces super-admin server-side.
  const list = trpc.llmProviders.list.useQuery(undefined, { enabled: isAdmin });
  const utils = trpc.useUtils();
  const refresh = () => utils.llmProviders.list.invalidate();
  const remove = trpc.llmProviders.remove.useMutation({ onSuccess: refresh });
  const setDefault = trpc.llmProviders.setDefault.useMutation({ onSuccess: refresh });
  const update = trpc.llmProviders.update.useMutation({ onSuccess: refresh });
  const test = trpc.llmProviders.test.useMutation();
  const [editing, setEditing] = useState<ProviderFormValues | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');

  if (status === 'loading') return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return <div className="p-8 text-sm text-muted-foreground">Super admin access required.</div>;
  }

  const guard = async (fn: () => Promise<unknown>) => {
    setActionError('');
    try { await fn(); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LLM Providers</h1>
          <p className="text-sm text-muted-foreground">Models available to the Copilot for every organization.</p>
        </div>
        {!editing && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing({ ...EMPTY.OPENROUTER })}>Add OpenRouter</Button>
            <Button variant="outline" onClick={() => setEditing({ ...EMPTY.OLLAMA })}>Add Ollama</Button>
          </div>
        )}
      </div>

      {actionError && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-500">{actionError}</p>}
      {list.error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-500">{list.error.message}</p>}

      {editing && (
        <div className="rounded-xl border border-border p-6">
          <ProviderForm key={editing.id ?? editing.type} initial={editing} onDone={() => setEditing(null)} />
        </div>
      )}

      {list.data?.length === 0 && !editing && (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No providers yet — the Copilot is disabled until you add one.
        </p>
      )}

      <ul className="space-y-3">
        {list.data?.map((p) => (
          <li key={p.id} className="rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="secondary">{p.type === 'OPENROUTER' ? 'OpenRouter' : 'Ollama'}</Badge>
                  {p.isDefault && <Badge>Default</Badge>}
                  {!p.enabled && <Badge variant="outline">Disabled</Badge>}
                  {p.dataLeavesHost && <Badge variant="outline" title="Prompts are anonymized before leaving this server">External</Badge>}
                  {p.secretsUnreadable && <Badge variant="destructive">Key unreadable — re-enter</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{p.baseUrl} · default model <code>{p.defaultModel}</code> · {p.models.length} models</p>
                {p.type === 'OPENROUTER' && (
                  <p className="text-xs text-muted-foreground">
                    Key: {p.hasApiKey ? (p.apiKeyLast4 ? `•••• ${p.apiKeyLast4}` : 'stored') : 'none'}{p.keyServiceUrl ? ` · key service ${p.keyServiceUrl}` : ''}
                  </p>
                )}
                {testResult[p.id] && <p className="text-xs">{testResult[p.id]}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" disabled={test.isPending}
                  onClick={() => guard(async () => {
                    const r = await test.mutateAsync({ id: p.id });
                    setTestResult((s) => ({ ...s, [p.id]: r.ok ? `✓ ${r.model} answered in ${r.latencyMs} ms` : `✗ ${r.error}` }));
                  })}>Test</Button>
                {!p.isDefault && p.enabled && <Button size="sm" variant="outline" onClick={() => guard(() => setDefault.mutateAsync({ id: p.id }))}>Make default</Button>}
                <Button size="sm" variant="outline" onClick={() => guard(() => update.mutateAsync({ id: p.id, enabled: !p.enabled }))}>{p.enabled ? 'Disable' : 'Enable'}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing({
                  id: p.id, name: p.name, type: p.type as ProviderType, baseUrl: p.baseUrl, apiKey: '', keyServiceUrl: p.keyServiceUrl ?? '',
                  keyServiceToken: '', models: p.models, defaultModel: p.defaultModel, fallbackModel: p.fallbackModel ?? '',
                  hasApiKey: p.hasApiKey, hasKeyServiceToken: p.hasKeyServiceToken, apiKeyLast4: p.apiKeyLast4,
                })}>Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete provider "${p.name}"?`)) void guard(() => remove.mutateAsync({ id: p.id })); }}>Delete</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
