import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {}, dashboardPrisma: {} }));
vi.mock('@/services/llm/registry', () => ({
  getProviders: async () => [
    { id: 'or', name: 'OpenRouter', type: 'OPENROUTER', models: ['anthropic/claude-sonnet-4.6'], defaultModel: 'anthropic/claude-sonnet-4.6', enabled: true, isDefault: true, createdAt: new Date(0) },
    { id: 'off', name: 'Off', type: 'OLLAMA', models: ['x'], defaultModel: 'x', enabled: false, isDefault: false, createdAt: new Date(1) },
  ],
  resolveLlm: async () => ({ provider: { name: 'OpenRouter' }, model: 'anthropic/claude-sonnet-4.6' }),
}));

import { copilotRouter } from '@/server/api/routers/copilot';
import { createCallerFactory } from '@/lib/trpc';

const caller = createCallerFactory(copilotRouter)({ prisma: {}, session: { user: { id: 'u1' } }, activeOrgId: null } as never);

describe('copilot model endpoints', () => {
  it('lists models from enabled providers only', async () => {
    const models = await caller.getAvailableModels({});
    expect(models).toEqual([{ model_id: 'anthropic/claude-sonnet-4.6', display_name: 'claude-sonnet-4.6', provider: 'OpenRouter', supports_function_calling: true, max_context_tokens: null }]);
  });
  it('reports the default model', async () => {
    await expect(caller.getActiveModel()).resolves.toEqual({ modelId: 'anthropic/claude-sonnet-4.6', displayName: 'claude-sonnet-4.6', provider: 'OpenRouter' });
  });
});
