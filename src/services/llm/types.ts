export type LlmProviderType = 'OPENROUTER' | 'OLLAMA';

export interface ProviderConfig {
  id: string;
  name: string;
  type: LlmProviderType;
  baseUrl: string;
  apiKey: string | null;
  keyServiceUrl: string | null;
  keyServiceToken: string | null;
  models: string[];
  defaultModel: string;
  fallbackModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  createdAt: Date;
}

export interface ResolvedLlm {
  provider: ProviderConfig;
  model: string;
  /** True when prompts are sent to a third party; the Copilot anonymizer runs only then. */
  dataLeavesHost: boolean;
  /** `prefetch`: run tools first, then one synthesis call (reliable for small local models). */
  toolStrategy: 'native' | 'prefetch';
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
  timeoutMs?: number;
  /** Called with the provider-reported token usage, when the response includes it. */
  onUsage?: (usage: { totalTokens: number }) => void;
}

export class LlmProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'LlmProviderError'; }
}

export class LlmNotConfiguredError extends LlmProviderError {
  constructor() { super('AI is disabled — ask a super admin to configure an LLM provider in Super Admin → LLM Providers.'); this.name = 'LlmNotConfiguredError'; }
}

export const PROVIDER_TRAITS: Record<LlmProviderType, Pick<ResolvedLlm, 'dataLeavesHost' | 'toolStrategy'>> = {
  OPENROUTER: { dataLeavesHost: true, toolStrategy: 'native' },
  OLLAMA: { dataLeavesHost: false, toolStrategy: 'prefetch' },
};

export const PROVIDER_DEFAULTS: Record<LlmProviderType, { baseUrl: string; defaultModel: string; fallbackModel: string | null }> = {
  OPENROUTER: { baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.6', fallbackModel: 'anthropic/claude-haiku-4.5' },
  OLLAMA: { baseUrl: 'http://ollama:11434', defaultModel: 'qwen2.5:14b', fallbackModel: null },
};
