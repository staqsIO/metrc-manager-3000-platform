import type { ChatMessage, ToolDefinition } from '@/services/copilot/openrouter-client';
import { openRouterChat, listOpenRouterModels } from './openrouter';
import { ollamaChat, listOllamaModels } from './ollama';
import type { ChatOptions, ProviderConfig, ResolvedLlm } from './types';

export function chatCompletion(llm: ResolvedLlm, messages: ChatMessage[], tools?: ToolDefinition[], opts: ChatOptions = {}): Promise<ChatMessage> {
  switch (llm.provider.type) {
    case 'OPENROUTER': return openRouterChat(llm, messages, tools, opts);
    case 'OLLAMA': return ollamaChat(llm, messages, tools, opts);
  }
}

export function listModels(p: ProviderConfig): Promise<string[]> {
  switch (p.type) {
    case 'OPENROUTER': return listOpenRouterModels(p);
    case 'OLLAMA': return listOllamaModels(p);
  }
}
