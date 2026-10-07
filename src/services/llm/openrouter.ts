import type { ChatMessage, ToolDefinition } from '@/services/copilot/openrouter-client';
import { getBrand } from '@/lib/brand';
import { LlmProviderError, type ChatOptions, type ProviderConfig, type ResolvedLlm } from './types';

const KEY_TTL_MS = 5 * 60 * 1000;
const keyCache = new Map<string, { key: string; at: number }>();

const keyFailures = new Map<string, number>();
const FAILURE_TTL_MS = 60_000;

export function clearOpenRouterKeyCache(): void { keyCache.clear(); keyFailures.clear(); }

const isTimeout = (err: unknown) => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

const trimSlash = (u: string) => u.replace(/\/+$/, '');

async function fetchFromKeyService(p: ProviderConfig, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`${trimSlash(p.keyServiceUrl!)}/api/openrouter-key`, {
    headers: { Accept: 'application/json', ...(p.keyServiceToken ? { Authorization: `Bearer ${p.keyServiceToken}` } : {}) },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`key service returned ${res.status}`);
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error('key service returned no key');
  return data.key;
}

/** Key service (only when this provider has keyServiceUrl) → stored API key. */
export async function getOpenRouterApiKey(p: ProviderConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
  const failedAt = keyFailures.get(p.id);
  const skipService = failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL_MS;
  if (p.keyServiceUrl && !skipService) {
    const hit = keyCache.get(p.id);
    if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.key;
    try {
      const key = await fetchFromKeyService(p, fetchImpl);
      keyCache.set(p.id, { key, at: Date.now() });
      return key;
    } catch (err) {
      keyFailures.set(p.id, Date.now());
      console.warn(`[llm] key service for "${p.name}" failed (${err instanceof Error ? err.message : err}); using stored key`);
    }
  }
  if (p.apiKey) return p.apiKey;
  throw new LlmProviderError(`OpenRouter provider "${p.name}" has no API key`);
}

export async function openRouterChat(
  llm: ResolvedLlm, messages: ChatMessage[], tools: ToolDefinition[] | undefined, opts: ChatOptions, fetchImpl: typeof fetch = fetch,
): Promise<ChatMessage> {
  const p = llm.provider;
  const apiKey = await getOpenRouterApiKey(p, fetchImpl);
  const brand = getBrand();
  const body: Record<string, unknown> = {
    model: llm.model,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (p.fallbackModel && p.fallbackModel !== llm.model) {
    body.models = [llm.model, p.fallbackModel];
    body.route = 'fallback';
  }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (opts.jsonResponse) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetchImpl(`${trimSlash(p.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': brand.appUrl,
        'X-Title': `${brand.name} Metrc Copilot`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (err) {
    if (isTimeout(err)) throw new LlmProviderError(`OpenRouter at ${p.baseUrl} timed out after ${(opts.timeoutMs ?? 60_000) / 1000}s`);
    throw new LlmProviderError(`Cannot reach OpenRouter at ${p.baseUrl}: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LlmProviderError(`OpenRouter error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message: ChatMessage }[]; usage?: { total_tokens?: number } };
  if (!data.choices?.length) throw new LlmProviderError('OpenRouter returned no choices');
  if (typeof data.usage?.total_tokens === 'number') opts.onUsage?.({ totalTokens: data.usage.total_tokens });
  return data.choices[0].message;
}

export async function listOpenRouterModels(p: ProviderConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchImpl(`${trimSlash(p.baseUrl)}/models`, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    if (isTimeout(err)) throw new LlmProviderError(`OpenRouter at ${p.baseUrl} timed out after 10s`);
    throw new LlmProviderError(`Cannot reach OpenRouter at ${p.baseUrl}: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new LlmProviderError(`OpenRouter error ${res.status} listing models`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}
