import type { PrismaClient } from '@prisma/client';
import type { AnonymizationAudit } from './anonymizer';

/**
 * Phase 1c — write-through wrapper for executeCopilotQuery.
 *
 * Each Copilot turn that hits this path creates a Run row at start, an
 * Artifact + ArtifactVersion at completion, and ties them together so we
 * have a durable record for the future agent-first surface (resumable
 * runs, shareable artifact links, scheduled run history).
 *
 * Gated behind `AGENT_RUNS_ENABLED` so we can land code without forcing
 * the write path on. Any failure inside the write path is logged and
 * swallowed — the user-facing response is never blocked by Run-table
 * writes.
 */

export function isAgentRunsEnabled(): boolean {
  // Accept '1' or 'true' for ergonomics
  const v = process.env.AGENT_RUNS_ENABLED;
  return v === '1' || v?.toLowerCase() === 'true';
}

export interface StartRunParams {
  prisma: PrismaClient;
  organizationId: string;
  facilityId: string | null;
  userId: string;
  skillId?: string;
  prompt: string;
  model?: string;
  /** Multi-turn thread this Run belongs to. Null for legacy single-turn calls. */
  conversationId?: string | null;
}

export interface RunHandle {
  runId: string;
  startedAt: Date;
}

export async function startAgentRun(params: StartRunParams): Promise<RunHandle | null> {
  try {
    const startedAt = new Date();
    const run = await params.prisma.run.create({
      data: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        userId: params.userId,
        skillId: params.skillId ?? null,
        status: 'running',
        prompt: params.prompt.slice(0, 8000),
        model: params.model ?? null,
        iterations: [],
        toolsUsed: [],
        startedAt,
        conversationId: params.conversationId ?? null,
      },
      select: { id: true },
    });
    return { runId: run.id, startedAt };
  } catch (err) {
    console.error('[agent-runs] startAgentRun failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface CompleteRunParams {
  prisma: PrismaClient;
  handle: RunHandle;
  organizationId: string;
  facilityId: string | null;
  content: string;
  toolsUsed: string[];
  audit?: AnonymizationAudit;
  /** Parsed JSON results per tool name. Stored on ArtifactVersion.content
   * so the artifact canvas can render structured tables (Phase 2c-B). */
  toolResults?: Record<string, unknown>;
}

export async function completeAgentRun(params: CompleteRunParams): Promise<{ artifactId: string } | null> {
  try {
    const { handle, prisma } = params;
    const artifact = await prisma.artifact.create({
      data: {
        runId: handle.runId,
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        type: 'Report',
        title: params.content.slice(0, 80).split('\n')[0] || 'Untitled',
      },
      select: { id: true },
    });
    const versionContent = {
      content: params.content,
      toolsUsed: params.toolsUsed,
      ...(params.audit ? { audit: params.audit } : {}),
      ...(params.toolResults ? { toolResults: params.toolResults } : {}),
    } as unknown as object; // Prisma Json input
    const version = await prisma.artifactVersion.create({
      data: {
        artifactId: artifact.id,
        content: versionContent as never,
      },
      select: { id: true },
    });
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { currentVersionId: version.id },
    });
    await prisma.run.update({
      where: { id: handle.runId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        toolsUsed: params.toolsUsed,
        currentArtifactId: artifact.id,
      },
    });
    return { artifactId: artifact.id };
  } catch (err) {
    console.error('[agent-runs] completeAgentRun failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function failAgentRun(params: {
  prisma: PrismaClient;
  handle: RunHandle;
  error: unknown;
}): Promise<void> {
  try {
    const message = params.error instanceof Error ? params.error.message : String(params.error);
    await params.prisma.run.update({
      where: { id: params.handle.runId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: message.slice(0, 2000),
      },
    });
  } catch (err) {
    console.error('[agent-runs] failAgentRun failed:', err instanceof Error ? err.message : err);
  }
}
