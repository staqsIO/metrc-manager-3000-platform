import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma, dashboardPrisma } from '@/lib/prisma';
import { executeCopilotQuery, checkCopilotRateLimit } from '@/services/copilot/copilot-service';
import { getUserOrgIds } from '@/lib/auth-helpers';
import { ACTIVE_ORG_COOKIE } from '@/lib/active-org';
import { isMetrcPlatformEnabled } from '@/lib/feature-flags';
import { getBrand } from '@/lib/brand';
import type { MetrcFacility } from '@prisma/client';
import { resolveLlm } from '@/services/llm/registry';
import type { ResolvedLlm } from '@/services/llm/types';
import { clientIp, demoQuotaFor, isDemoMode } from '@/services/copilot/demo-quota';
import { OWN_KEY_HEADER, demoErrorMessage, resolveDemoAccess } from '@/services/copilot/demo-ai';

// Input validation — mirrors the tRPC sendMessage schema
const requestSchema = z.object({
  facilityId: z.string().min(1).optional(),
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(50).optional(),
  model: z.string().optional(),
  skillId: z.string().max(100).optional(),
  captureAudit: z.boolean().optional(),
  /** Multi-turn thread id. When omitted, a new Conversation is created. */
  conversationId: z.string().min(1).optional(),
});

function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed || 'Untitled conversation';
}

/**
 * Resolve the Conversation for this turn. If the client passed a valid id we
 * reuse it; otherwise we mint a new one with a derived title. Returns null if
 * the persistence layer hits an error so the chat path stays unblocked.
 */
async function resolveConversation(opts: {
  conversationId: string | undefined;
  organizationId: string;
  userId: string;
  facilityId: string | null;
  prompt: string;
}): Promise<{ id: string; created: boolean } | null> {
  try {
    if (opts.conversationId) {
      const existing = await prisma.conversation.findUnique({
        where: { id: opts.conversationId },
        select: { id: true, organizationId: true },
      });
      if (existing && existing.organizationId === opts.organizationId) {
        return { id: existing.id, created: false };
      }
    }
    const created = await prisma.conversation.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        facilityId: opts.facilityId,
        title: deriveTitle(opts.prompt),
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    console.error('[copilot/sse] resolveConversation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Append a message + bump conversation.lastMessageAt. Best-effort — failures
 * never block the chat stream.
 */
async function appendConversationMessage(opts: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string | null;
  toolsUsed?: string[];
  audit?: unknown;
}) {
  try {
    await prisma.$transaction([
      prisma.conversationMessage.create({
        data: {
          conversationId: opts.conversationId,
          role: opts.role,
          content: opts.content,
          runId: opts.runId ?? null,
          toolsUsed: opts.toolsUsed ?? [],
          audit: (opts.audit ?? null) as never,
        },
      }),
      prisma.conversation.update({
        where: { id: opts.conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
  } catch (err) {
    console.error('[copilot/sse] appendConversationMessage failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * On the public demo, picks the visitor's own key or charges a free question on the house key.
 * Called right before streaming, after every access check, so a refused request costs nothing.
 * The key header is never logged or echoed back.
 */
async function demoGate(req: NextRequest, model: string | undefined): Promise<
  | { refused: Response }
  | { llm?: ResolvedLlm; onError: (err: unknown) => Promise<string | null> }
> {
  if (!isDemoMode()) return { onError: async () => null };
  const quota = demoQuotaFor(prisma, clientIp(req.headers.get('x-forwarded-for')));
  const keyHeader = req.headers.get(OWN_KEY_HEADER);
  const access = await resolveDemoAccess({
    demoMode: true,
    keyHeader,
    model,
    houseConfigured: keyHeader ? true : !!(await resolveLlm(model)),
    quota,
  });
  if (access.kind === 'refused') return { refused: new Response(access.message, { status: access.status }) };
  return {
    llm: access.kind === 'own' ? access.llm : undefined,
    onError: async (err) => {
      // The visitor got no answer, so a failed free question is given back.
      if (access.kind === 'house') await quota.refund().catch(() => {});
      return demoErrorMessage(err);
    },
  };
}

export async function POST(req: NextRequest) {
  // Authenticate
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Platform kill switch (mirrors platformProcedure in src/lib/trpc.ts)
  if (!isMetrcPlatformEnabled()) {
    return new Response(`${getBrand().name} is currently unavailable.`, { status: 403 });
  }

  // Parse and validate body
  let input: z.infer<typeof requestSchema>;
  try {
    const raw = await req.json();
    input = requestSchema.parse(raw);
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      : 'Invalid request body';
    return new Response(message, { status: 400 });
  }

  // Rate limit (shared bucket with tRPC endpoint)
  if (!checkCopilotRateLimit(session.user.id)) {
    return new Response('Rate limit exceeded. Please wait a moment.', { status: 429 });
  }

  // Always query fresh org IDs to avoid JWT staleness (matches resolveOrgIds in trpc.ts)
  const orgIds = await getUserOrgIds(dashboardPrisma, session.user.id);
  if (orgIds.length === 0) {
    return new Response('Forbidden', { status: 403 });
  }

  // Set up SSE stream
  const encoder = new TextEncoder();

  if (input.facilityId) {
    // -----------------------------------------------------------------------
    // FACILITY MODE — validate facility access, call with single facility
    // -----------------------------------------------------------------------
    const facility = await prisma.metrcFacility.findFirst({
      where: { id: input.facilityId, organizationId: { in: orgIds } },
    });
    if (!facility) {
      return new Response('Facility not found or access denied', { status: 403 });
    }

    // FOR-1172: enforce facility-level access grants
    const facilityAccess: Record<string, string> = (session.user as { facilityAccess?: Record<string, string> })?.facilityAccess ?? {};
    if (Object.keys(facilityAccess).length > 0 && !facilityAccess[input.facilityId]) {
      return new Response('No access to this facility', { status: 403 });
    }

    const conversation = await resolveConversation({
      conversationId: input.conversationId,
      organizationId: facility.organizationId,
      userId: session.user.id,
      facilityId: facility.id,
      prompt: input.message,
    });
    if (conversation) {
      await appendConversationMessage({
        conversationId: conversation.id,
        role: 'user',
        content: input.message,
      });
    }

    const demo = await demoGate(req, input.model);
    if ('refused' in demo) return demo.refused;

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        function send(event: string, data: unknown) {
          if (streamClosed) return;
          try {
            const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch (encodeErr) {
            console.error('[copilot/sse] enqueue failed:', encodeErr instanceof Error ? encodeErr.message : encodeErr);
            streamClosed = true;
          }
        }

        // Hint the client about the resolved conversation id ASAP so the URL
        // can be updated for resume-on-reload before the LLM finishes.
        if (conversation) {
          send('conversation', { id: conversation.id, created: conversation.created });
        }

        try {
          const result = await executeCopilotQuery({
            facility: facility as MetrcFacility,
            message: input.message,
            history: input.history,
            userId: session.user!.id,
            prisma,
            dashboardPrisma,
            model: input.model,
            skillId: input.skillId,
            captureAudit: input.captureAudit,
            llm: demo.llm,
            conversationId: conversation?.id ?? null,
            onToolCall: (event) => {
              if (event.tool === '_thinking') return;
              send('tool', event);
            },
          });

          if (conversation) {
            await appendConversationMessage({
              conversationId: conversation.id,
              role: 'assistant',
              content: result.content,
              runId: result.runId ?? null,
              toolsUsed: result.toolsUsed,
              audit: result.audit ?? null,
            });
          }

          send('complete', {
            content: result.content,
            toolsUsed: result.toolsUsed,
            ...(result.audit ? { audit: result.audit } : {}),
            ...(result.runId ? { runId: result.runId } : {}),
            ...(result.artifactId ? { artifactId: result.artifactId } : {}),
            ...(conversation ? { conversationId: conversation.id } : {}),
          });
        } catch (err) {
          const errorMessage = (await demo.onError(err)) ?? (err instanceof Error ? err.message : 'Internal error');
          send('error', { message: errorMessage });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } else {
    // -----------------------------------------------------------------------
    // ORG MODE — resolve accessible facilities, call with orgFacilities
    // -----------------------------------------------------------------------
    // Scope to active org (mirrors getAccessibleFacilities in cross-facility.ts;
    // refactor to call it directly is tracked separately — SSE endpoint needs
    // ctx-shape adaptation).
    const activeOrgId = req.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null;
    const scopedOrgIds = activeOrgId && orgIds.includes(activeOrgId)
      ? [activeOrgId]
      : orgIds;

    let orgFacilities = await prisma.metrcFacility.findMany({
      where: { organizationId: { in: scopedOrgIds }, isActive: true },
    });

    // FOR-1172: filter by facility access grants
    const facilityAccess: Record<string, string> = (session.user as { facilityAccess?: Record<string, string> })?.facilityAccess ?? {};
    if (Object.keys(facilityAccess).length > 0) {
      const allowed = new Set(Object.keys(facilityAccess));
      orgFacilities = orgFacilities.filter(f => allowed.has(f.id));
    }

    // Org-mode write-through uses the active org id (or first scoped org)
    // for the Conversation row.
    const orgWriteThroughId = scopedOrgIds[0];
    const orgConversation = orgWriteThroughId
      ? await resolveConversation({
          conversationId: input.conversationId,
          organizationId: orgWriteThroughId,
          userId: session.user.id,
          facilityId: null,
          prompt: input.message,
        })
      : null;
    if (orgConversation) {
      await appendConversationMessage({
        conversationId: orgConversation.id,
        role: 'user',
        content: input.message,
      });
    }

    const demo = await demoGate(req, input.model);
    if ('refused' in demo) return demo.refused;

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        function send(event: string, data: unknown) {
          if (streamClosed) return;
          try {
            const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          } catch (encodeErr) {
            console.error('[copilot/sse] enqueue failed:', encodeErr instanceof Error ? encodeErr.message : encodeErr);
            streamClosed = true;
          }
        }

        if (orgConversation) {
          send('conversation', { id: orgConversation.id, created: orgConversation.created });
        }

        try {
          const result = await executeCopilotQuery({
            orgFacilities: orgFacilities as MetrcFacility[],
            message: input.message,
            history: input.history,
            userId: session.user!.id,
            prisma,
            dashboardPrisma,
            model: input.model,
            skillId: input.skillId,
            captureAudit: input.captureAudit,
            llm: demo.llm,
            conversationId: orgConversation?.id ?? null,
            onToolCall: (event) => {
              if (event.tool === '_thinking') return;
              send('tool', event);
            },
          });

          if (orgConversation) {
            await appendConversationMessage({
              conversationId: orgConversation.id,
              role: 'assistant',
              content: result.content,
              runId: result.runId ?? null,
              toolsUsed: result.toolsUsed,
              audit: result.audit ?? null,
            });
          }

          send('complete', {
            content: result.content,
            toolsUsed: result.toolsUsed,
            ...(result.audit ? { audit: result.audit } : {}),
            ...(result.runId ? { runId: result.runId } : {}),
            ...(result.artifactId ? { artifactId: result.artifactId } : {}),
            ...(orgConversation ? { conversationId: orgConversation.id } : {}),
          });
        } catch (err) {
          const errorMessage = (await demo.onError(err)) ?? (err instanceof Error ? err.message : 'Internal error');
          send('error', { message: errorMessage });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
}
