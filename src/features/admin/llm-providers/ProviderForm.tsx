'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

export type ProviderType = 'OPENROUTER' | 'OLLAMA';

export interface ProviderFormValues {
  id?: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string; // '' = keep stored key
  keyServiceUrl: string;
  keyServiceToken: string; // '' = keep stored token
  models: string[];
  defaultModel: string;
  fallbackModel: string;
  hasApiKey?: boolean;
  hasKeyServiceToken?: boolean;
  apiKeyLast4?: string | null;
}

export const EMPTY: Record<ProviderType, ProviderFormValues> = {
  OPENROUTER: { name: 'OpenRouter', type: 'OPENROUTER', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', keyServiceUrl: '', keyServiceToken: '', models: ['anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5'], defaultModel: 'anthropic/claude-sonnet-4.6', fallbackModel: 'anthropic/claude-haiku-4.5' },
  OLLAMA: { name: 'Ollama (local)', type: 'OLLAMA', baseUrl: 'http://ollama:11434', apiKey: '', keyServiceUrl: '', keyServiceToken: '', models: ['qwen2.5:14b'], defaultModel: 'qwen2.5:14b', fallbackModel: '' },
};

/** Parses the raw models textarea: trims lines, drops blanks and duplicates. */
export function parseModels(text: string): string[] {
  return Array.from(new Set(text.split('\n').map((s) => s.trim()).filter(Boolean)));
}

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? u.href : u.origin;
  } catch {
    return url.trim();
  }
}

export function buildPayload(v: ProviderFormValues, remove: { apiKey?: boolean; token?: boolean } = {}) {
  const isOpenRouter = v.type === 'OPENROUTER';
  return {
    name: v.name,
    type: v.type,
    baseUrl: v.baseUrl,
    models: v.models,
    defaultModel: v.defaultModel || v.models[0],
    fallbackModel: v.fallbackModel || null,
    ...(isOpenRouter
      ? {
          // '' = keep stored, null = clear, string = replace
          apiKey: remove.apiKey ? null : v.apiKey,
          keyServiceUrl: v.keyServiceUrl || null,
          keyServiceToken: remove.token ? null : v.keyServiceToken,
        }
      : {}),
  };
}

export function ProviderForm({ initial, onDone }: { initial: ProviderFormValues; onDone: () => void }) {
  const [v, setV] = useState(initial);
  // Raw text is the source of truth while typing; parsing on every keystroke would undo a trailing newline.
  const [modelsText, setModelsText] = useState(initial.models.join('\n'));
  const [error, setError] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [removeToken, setRemoveToken] = useState(false);
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const utils = trpc.useUtils();
  const create = trpc.llmProviders.create.useMutation();
  const update = trpc.llmProviders.update.useMutation();
  const discover = trpc.llmProviders.discoverModels.useMutation();
  const set = <K extends keyof ProviderFormValues>(k: K, val: ProviderFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const isOpenRouter = v.type === 'OPENROUTER';
  const isEdit = Boolean(v.id);

  // Server clears stored secrets when the origin changes and no new secret is entered.
  const baseUrlChanged = isEdit && originOf(v.baseUrl) !== originOf(initial.baseUrl);
  const keyServiceChanged = isEdit && originOf(v.keyServiceUrl) !== originOf(initial.keyServiceUrl);

  const payload = () => buildPayload({ ...v, models: parseModels(modelsText) }, { apiKey: removeKey, token: removeToken });

  async function save() {
    setError('');
    try {
      if (v.id) await update.mutateAsync({ id: v.id, ...payload() });
      else await create.mutateAsync(payload());
      await utils.llmProviders.list.invalidate();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runDiscover() {
    setError('');
    try {
      const models = v.id && !baseUrlChanged && !keyServiceChanged && !v.apiKey
        ? await discover.mutateAsync({ id: v.id })
        : await discover.mutateAsync({ draft: { ...payload(), enabled: true } });
      setDiscovered(models);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={v.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input id="baseUrl" value={v.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
        {!isOpenRouter && (
          <p className="text-xs text-muted-foreground">
            Use http://ollama:11434 with the compose <code>ollama</code> profile, or http://host.docker.internal:11434 for Ollama on the host.
          </p>
        )}
        {baseUrlChanged && isOpenRouter && initial.hasApiKey && (
          <p className="text-xs text-amber-600">
            The base URL changed: the stored key will be cleared unless you enter it again.
          </p>
        )}
      </div>
      {isOpenRouter && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="apiKey">API key</Label>
            <Input id="apiKey" type="password" autoComplete="off" value={v.apiKey}
              placeholder={v.hasApiKey ? `•••• ${v.apiKeyLast4 ?? ''} (leave blank to keep)` : 'sk-or-v1-…'}
              disabled={removeKey} onChange={(e) => set('apiKey', e.target.value)} />
            {isEdit && initial.hasApiKey && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={removeKey} onChange={(e) => { setRemoveKey(e.target.checked); if (e.target.checked) set('apiKey', ''); }} />
                Remove stored key
              </label>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="keyServiceUrl">Key service URL (optional)</Label>
            <Input id="keyServiceUrl" value={v.keyServiceUrl} placeholder="http://keyservice:3001"
              onChange={(e) => set('keyServiceUrl', e.target.value)} />
            <p className="text-xs text-muted-foreground">When set, the key is fetched from the key service and the stored key is only a fallback.</p>
            {keyServiceChanged && (
              <p className="text-xs text-amber-600">
                The key service URL changed: the stored key service token will be cleared unless you enter it again.
              </p>
            )}
          </div>
          {v.keyServiceUrl && (
            <div className="grid gap-2">
              <Label htmlFor="keyServiceToken">Key service token</Label>
              <Input id="keyServiceToken" type="password" autoComplete="off" value={v.keyServiceToken}
                placeholder={isEdit ? 'leave blank to keep' : 'token'} disabled={removeToken}
                onChange={(e) => set('keyServiceToken', e.target.value)} />
              {isEdit && initial.hasKeyServiceToken && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={removeToken} onChange={(e) => { setRemoveToken(e.target.checked); if (e.target.checked) set('keyServiceToken', ''); }} />
                  Remove stored token
                </label>
              )}
            </div>
          )}
        </>
      )}
      <div className="grid gap-2">
        <Label htmlFor="models">Models (one per line)</Label>
        <textarea id="models" rows={4} className="w-full rounded-md border border-border bg-background p-2 text-sm font-mono"
          value={modelsText} onChange={(e) => setModelsText(e.target.value)} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={runDiscover} disabled={discover.isPending}>
            {discover.isPending ? 'Discovering…' : 'Discover models'}
          </Button>
          {discovered && <span className="text-xs text-muted-foreground">{discovered.length} found — click to add</span>}
        </div>
        {discovered && (
          <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
            {discovered.map((m) => (
              <button key={m} type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
                onClick={() => !parseModels(modelsText).includes(m) && setModelsText((t) => `${t.replace(/\s+$/, '')}${t.trim() ? '\n' : ''}${m}`)}>{m}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="defaultModel">Default model</Label>
          <Input id="defaultModel" value={v.defaultModel} onChange={(e) => set('defaultModel', e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fallbackModel">Fallback model</Label>
          <Input id="fallbackModel" value={v.fallbackModel} onChange={(e) => set('fallbackModel', e.target.value)} />
        </div>
      </div>
      {error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="button" onClick={save} disabled={create.isPending || update.isPending}>Save</Button>
      </div>
    </div>
  );
}
