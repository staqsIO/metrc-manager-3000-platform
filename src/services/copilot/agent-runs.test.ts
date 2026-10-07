import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAgentRunsEnabled,
  startAgentRun,
  completeAgentRun,
  failAgentRun,
} from './agent-runs';

const ORIGINAL_ENV = process.env.AGENT_RUNS_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AGENT_RUNS_ENABLED;
  else process.env.AGENT_RUNS_ENABLED = ORIGINAL_ENV;
});

describe('isAgentRunsEnabled', () => {
  it('returns false when env is unset', () => {
    delete process.env.AGENT_RUNS_ENABLED;
    expect(isAgentRunsEnabled()).toBe(false);
  });

  it('returns true for "1"', () => {
    process.env.AGENT_RUNS_ENABLED = '1';
    expect(isAgentRunsEnabled()).toBe(true);
  });

  it('returns true for "true" (any case)', () => {
    process.env.AGENT_RUNS_ENABLED = 'true';
    expect(isAgentRunsEnabled()).toBe(true);
    process.env.AGENT_RUNS_ENABLED = 'TRUE';
    expect(isAgentRunsEnabled()).toBe(true);
  });

  it('returns false for "0" or "false"', () => {
    process.env.AGENT_RUNS_ENABLED = '0';
    expect(isAgentRunsEnabled()).toBe(false);
    process.env.AGENT_RUNS_ENABLED = 'false';
    expect(isAgentRunsEnabled()).toBe(false);
  });
});

interface MockPrisma {
  run: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  artifact: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  artifactVersion: { create: ReturnType<typeof vi.fn> };
}

function makeMockPrisma(overrides: Partial<{
  runCreate: unknown;
  runUpdate: unknown;
  artifactCreate: unknown;
  artifactUpdate: unknown;
  versionCreate: unknown;
}> = {}): MockPrisma {
  return {
    run: {
      create: vi.fn().mockResolvedValue(overrides.runCreate ?? { id: 'run-123' }),
      update: vi.fn().mockResolvedValue(overrides.runUpdate ?? { id: 'run-123' }),
    },
    artifact: {
      create: vi.fn().mockResolvedValue(overrides.artifactCreate ?? { id: 'art-456' }),
      update: vi.fn().mockResolvedValue(overrides.artifactUpdate ?? { id: 'art-456' }),
    },
    artifactVersion: {
      create: vi.fn().mockResolvedValue(overrides.versionCreate ?? { id: 'ver-789' }),
    },
  };
}

describe('startAgentRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a Run row with status=running and returns the runId', async () => {
    const prisma = makeMockPrisma();
    const handle = await startAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      organizationId: 'org-A',
      facilityId: 'fac-1',
      userId: 'user-1',
      skillId: 'sample-out-candidates',
      prompt: 'What can I sample out?',
      model: 'anthropic/claude-sonnet-4-5',
    });
    expect(handle?.runId).toBe('run-123');
    expect(prisma.run.create).toHaveBeenCalledOnce();
    const args = prisma.run.create.mock.calls[0][0];
    expect(args.data.status).toBe('running');
    expect(args.data.organizationId).toBe('org-A');
    expect(args.data.facilityId).toBe('fac-1');
    expect(args.data.skillId).toBe('sample-out-candidates');
    expect(args.data.prompt).toBe('What can I sample out?');
  });

  it('returns null when prisma throws (write path never blocks the user)', async () => {
    const prisma = makeMockPrisma();
    prisma.run.create.mockRejectedValueOnce(new Error('DB down'));
    const handle = await startAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      organizationId: 'org-A',
      facilityId: null,
      userId: 'user-1',
      prompt: 'x',
    });
    expect(handle).toBeNull();
  });

  it('truncates prompt to 8000 chars', async () => {
    const prisma = makeMockPrisma();
    const longPrompt = 'A'.repeat(20_000);
    await startAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      organizationId: 'org-A',
      facilityId: null,
      userId: 'user-1',
      prompt: longPrompt,
    });
    const args = prisma.run.create.mock.calls[0][0];
    expect(args.data.prompt.length).toBe(8000);
  });
});

describe('completeAgentRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates Artifact + ArtifactVersion and updates Run to completed', async () => {
    const prisma = makeMockPrisma();
    const result = await completeAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      organizationId: 'org-A',
      facilityId: 'fac-1',
      content: 'Sample-out summary...',
      toolsUsed: ['find_sample_out_candidates'],
    });
    expect(result?.artifactId).toBe('art-456');
    expect(prisma.artifact.create).toHaveBeenCalledOnce();
    expect(prisma.artifactVersion.create).toHaveBeenCalledOnce();
    expect(prisma.artifact.update).toHaveBeenCalledOnce();
    expect(prisma.run.update).toHaveBeenCalledOnce();
    const runUpdate = prisma.run.update.mock.calls[0][0];
    expect(runUpdate.data.status).toBe('completed');
    expect(runUpdate.data.currentArtifactId).toBe('art-456');
    expect(runUpdate.data.toolsUsed).toEqual(['find_sample_out_candidates']);
  });

  it('returns null when artifact creation fails', async () => {
    const prisma = makeMockPrisma();
    prisma.artifact.create.mockRejectedValueOnce(new Error('insert failed'));
    const result = await completeAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      organizationId: 'org-A',
      facilityId: null,
      content: 'x',
      toolsUsed: [],
    });
    expect(result).toBeNull();
  });

  it('embeds toolResults in the version content for the artifact canvas', async () => {
    const prisma = makeMockPrisma();
    const sampleCandidates = [
      { label: '1A40A030...001', itemName: 'Astro Skunk', ageDays: 1152, quantity: 2.02 },
      { label: '1A40A030...002', itemName: 'Motorbreath', ageDays: 892, quantity: 3.21 },
    ];
    await completeAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      organizationId: 'org-A',
      facilityId: 'fac-1',
      content: 'Sample-out summary...',
      toolsUsed: ['find_sample_out_candidates'],
      toolResults: { find_sample_out_candidates: sampleCandidates },
    });
    const versionArgs = prisma.artifactVersion.create.mock.calls[0][0];
    const versionContent = versionArgs.data.content as { toolResults?: { find_sample_out_candidates?: unknown[] } };
    expect(versionContent.toolResults?.find_sample_out_candidates).toEqual(sampleCandidates);
  });

  it('embeds the audit transcript in the version content when provided', async () => {
    const prisma = makeMockPrisma();
    await completeAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      organizationId: 'org-A',
      facilityId: null,
      content: 'final',
      toolsUsed: ['t'],
      audit: { mappings: [{ type: 'facility', real: 'Example Farms', token: '__FAC_001__' }], entries: [] },
    });
    const versionArgs = prisma.artifactVersion.create.mock.calls[0][0];
    const versionContent = versionArgs.data.content as { content: string; audit?: unknown };
    expect(versionContent.content).toBe('final');
    expect(versionContent.audit).toBeDefined();
  });
});

describe('failAgentRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates Run to status=failed with truncated error message', async () => {
    const prisma = makeMockPrisma();
    await failAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      error: new Error('boom'),
    });
    expect(prisma.run.update).toHaveBeenCalledOnce();
    const args = prisma.run.update.mock.calls[0][0];
    expect(args.data.status).toBe('failed');
    expect(args.data.errorMessage).toBe('boom');
  });

  it('truncates very long error messages to 2000 chars', async () => {
    const prisma = makeMockPrisma();
    const longMsg = 'X'.repeat(5000);
    await failAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      error: new Error(longMsg),
    });
    const args = prisma.run.update.mock.calls[0][0];
    expect(args.data.errorMessage.length).toBe(2000);
  });

  it('swallows DB errors silently (write path never blocks)', async () => {
    const prisma = makeMockPrisma();
    prisma.run.update.mockRejectedValueOnce(new Error('DB unavailable'));
    // Should not throw
    await expect(failAgentRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      handle: { runId: 'run-123', startedAt: new Date() },
      error: new Error('original'),
    })).resolves.toBeUndefined();
  });
});
