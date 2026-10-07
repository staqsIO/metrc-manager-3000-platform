import type { ChatMessage, ToolDefinition } from '@/services/copilot/openrouter-client';
import { LlmProviderError, type ChatOptions, type ProviderConfig, type ResolvedLlm } from './types';

const trimSlash = (u: string) => u.replace(/\/+$/, '');

export async function ollamaChat(
  llm: ResolvedLlm, messages: ChatMessage[], tools: ToolDefinition[] | undefined, opts: ChatOptions, fetchImpl: typeof fetch = fetch,
): Promise<ChatMessage> {
  const base = trimSlash(llm.provider.baseUrl);
  const body: Record<string, unknown> = {
    model: llm.model,
    messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (opts.jsonResponse) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new LlmProviderError(`Ollama at ${base} timed out after ${(opts.timeoutMs ?? 120_000) / 1000}s`);
    }
    throw new LlmProviderError(`Cannot reach Ollama at ${base}. Is it running?`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404 && /model.*not found|try pulling/i.test(text)) {
      throw new LlmProviderError(`Model "${llm.model}" is not available in Ollama. Run: ollama pull ${llm.model}`);
    }
    throw new LlmProviderError(`Ollama error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message: ChatMessage }[]; usage?: { total_tokens?: number } };
  if (!data.choices?.length) throw new LlmProviderError('Ollama returned no choices');
  if (typeof data.usage?.total_tokens === 'number') opts.onUsage?.({ totalTokens: data.usage.total_tokens });
  return data.choices[0].message;
}

export async function listOllamaModels(p: ProviderConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const base = trimSlash(p.baseUrl);
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new LlmProviderError(`Cannot reach Ollama at ${base}. Is it running?`);
  }
  if (!res.ok) throw new LlmProviderError(`Ollama error ${res.status} listing models`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}
