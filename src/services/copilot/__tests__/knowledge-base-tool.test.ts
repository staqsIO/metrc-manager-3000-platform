import { describe, it, expect, afterEach } from 'vitest';
import { getCopilotToolDefs } from '@/services/copilot/copilot-tool-defs';

const names = () => getCopilotToolDefs().map((t) => t.function.name);

describe('ask_knowledge_base visibility', () => {
  afterEach(() => { delete process.env.MULTIAGENT_API_URL; });

  it('is hidden when MULTIAGENT_API_URL is unset', () => {
    delete process.env.MULTIAGENT_API_URL;
    expect(names()).not.toContain('ask_knowledge_base');
  });

  it('is offered when MULTIAGENT_API_URL is set', () => {
    process.env.MULTIAGENT_API_URL = 'http://kb.local';
    expect(names()).toContain('ask_knowledge_base');
  });
});
