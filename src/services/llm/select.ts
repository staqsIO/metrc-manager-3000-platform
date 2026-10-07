import { PROVIDER_TRAITS, type ProviderConfig, type ResolvedLlm } from './types';

function resolved(provider: ProviderConfig, model: string): ResolvedLlm {
  return { provider, model, ...PROVIDER_TRAITS[provider.type] };
}

/** Picks the provider for a requested model; falls back to the default provider's default model. */
export function selectLlm(providers: ProviderConfig[], model?: string | null): ResolvedLlm | null {
  const enabled = providers.filter((p) => p.enabled);
  if (enabled.length === 0) return null;
  if (model) {
    const owner = enabled.find((p) => p.models.includes(model) || p.defaultModel === model);
    if (owner) return resolved(owner, model);
  }
  const fallback =
    enabled.find((p) => p.isDefault) ??
    [...enabled].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return resolved(fallback, fallback.defaultModel);
}
