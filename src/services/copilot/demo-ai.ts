import { PROVIDER_DEFAULTS, PROVIDER_TRAITS, type ResolvedLlm } from '@/services/llm/types';
import { DEMO_BAD_KEY_MESSAGE, DEMO_QUOTA_MESSAGE } from './demo-quota';

/**
 * How a Copilot request on the public demo gets its AI: the visitor's own OpenRouter key
 * (sent per request in X-OpenRouter-Key, never stored), or one of the free questions on the
 * house key. Real installs (DEMO_MODE unset) ignore all of this.
 */

export const OWN_KEY_HEADER = 'x-openrouter-key';

// OpenRouter keys are `sk-or-v1-` plus hex; this also keeps CR/LF and spaces out of the
// Authorization header we build from it.
const KEY_SHAPE = /^sk-or-[A-Za-z0-9_-]{20,200}$/;

export function parseOwnKey(header: string | null | undefined): string | null {
  const key = header?.trim();
  return key && KEY_SHAPE.test(key) ? key : null;
}

export function byoKeyLlm(apiKey: string, model?: string | null): ResolvedLlm {
  const d = PROVIDER_DEFAULTS.OPENROUTER;
  return {
    provider: {
      id: 'demo-visitor-key',
      name: 'Your OpenRouter key',
      type: 'OPENROUTER',
      baseUrl: d.baseUrl,
      apiKey,
      keyServiceUrl: null,
      keyServiceToken: null,
      models: [],
      defaultModel: d.defaultModel,
      fallbackModel: d.fallbackModel,
      enabled: true,
      isDefault: false,
      createdAt: new Date(0),
    },
    model: model || d.defaultModel,
    ...PROVIDER_TRAITS.OPENROUTER,
  };
}

export type DemoAccess =
  | { kind: 'normal' }
  | { kind: 'own'; llm: ResolvedLlm }
  | { kind: 'house' }
  | { kind: 'refused'; status: 400 | 429; message: string };

export async function resolveDemoAccess(o: {
  demoMode: boolean;
  keyHeader: string | null | undefined;
  model?: string | null;
  /** False when no provider is configured: the Copilot answers "AI is disabled", which should not cost a question. */
  houseConfigured: boolean;
  quota: { consume: () => Promise<{ allowed: boolean }> };
}): Promise<DemoAccess> {
  if (!o.demoMode) return { kind: 'normal' };
  if (o.keyHeader) {
    const key = parseOwnKey(o.keyHeader);
    return key ? { kind: 'own', llm: byoKeyLlm(key, o.model) } : { kind: 'refused', status: 400, message: DEMO_BAD_KEY_MESSAGE };
  }
  if (!o.houseConfigured) return { kind: 'normal' };
  const { allowed } = await o.quota.consume();
  return allowed ? { kind: 'house' } : { kind: 'refused', status: 429, message: DEMO_QUOTA_MESSAGE };
}

/** A friendlier message for the two OpenRouter failures a demo visitor can cause. */
export function demoErrorMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : '';
  if (/OpenRouter error 402\b/.test(msg)) return DEMO_QUOTA_MESSAGE;
  if (/OpenRouter error 401\b/.test(msg)) return DEMO_BAD_KEY_MESSAGE;
  return null;
}
