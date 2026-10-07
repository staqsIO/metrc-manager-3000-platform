import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { selectLlm } from './select';
import type { LlmProviderType, ProviderConfig, ResolvedLlm } from './types';

export interface LlmProviderRow {
  id: string; name: string; type: string; baseUrl: string;
  apiKeyEncrypted: string | null; keyServiceUrl: string | null; keyServiceTokenEncrypted: string | null;
  models: string[]; defaultModel: string; fallbackModel: string | null;
  enabled: boolean; isDefault: boolean; createdAt: Date;
}

const TTL_MS = 60_000;
let cache: { at: number; providers: ProviderConfig[] } | null = null;

export function toProviderConfig(row: LlmProviderRow): ProviderConfig {
  return {
    id: row.id, name: row.name, type: row.type as LlmProviderType, baseUrl: row.baseUrl,
    apiKey: row.apiKeyEncrypted ? decrypt(row.apiKeyEncrypted) : null,
    keyServiceUrl: row.keyServiceUrl,
    keyServiceToken: row.keyServiceTokenEncrypted ? decrypt(row.keyServiceTokenEncrypted) : null,
    models: row.models, defaultModel: row.defaultModel, fallbackModel: row.fallbackModel,
    enabled: row.enabled, isDefault: row.isDefault, createdAt: row.createdAt,
  };
}

function safeToProviderConfig(row: LlmProviderRow): ProviderConfig {
  try {
    return toProviderConfig(row);
  } catch {
    console.error(`[llm] cannot decrypt secrets for provider "${row.name}" (${row.id})`);
    return toProviderConfig({ ...row, apiKeyEncrypted: null, keyServiceTokenEncrypted: null });
  }
}

export async function getProviders(): Promise<ProviderConfig[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.providers;
  const rows = (await prisma.llmProvider.findMany({ orderBy: { createdAt: 'asc' } })) as LlmProviderRow[];
  const providers = rows.map(safeToProviderConfig);
  cache = { at: Date.now(), providers };
  return providers;
}

export function invalidateProviderCache(): void { cache = null; }

export async function resolveLlm(model?: string | null): Promise<ResolvedLlm | null> {
  return selectLlm(await getProviders(), model);
}

export async function isLLMConfigured(): Promise<boolean> {
  return (await resolveLlm()) !== null;
}
