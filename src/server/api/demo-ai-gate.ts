import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { resolveLlm } from '@/services/llm/registry';
import { DEMO_QUOTA_MESSAGE, clientIp, demoQuotaFor, isDemoMode } from '@/services/copilot/demo-quota';

/**
 * Charges one free demo question before a tRPC path uses the house key. These paths take no
 * visitor key; only the streaming chat route (src/app/api/copilot/chat/route.ts) does.
 * Returns false when the question was refused; outside demo mode, or with no house key, it
 * charges nothing and returns true.
 */
export async function takeDemoQuestion(forwardedFor: string | string[] | null | undefined): Promise<boolean> {
  if (!isDemoMode() || !(await resolveLlm())) return true;
  return (await demoQuotaFor(prisma, clientIp(forwardedFor)).consume()).allowed;
}

export async function takeDemoQuestionOrThrow(forwardedFor: string | string[] | null | undefined): Promise<void> {
  if (!(await takeDemoQuestion(forwardedFor))) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: DEMO_QUOTA_MESSAGE });
}

/** What the demo's AI panel shows; null on a real install. */
export async function demoQuotaStatus(forwardedFor: string | string[] | null | undefined) {
  if (!isDemoMode()) return null;
  const { remaining, perVisitor } = await demoQuotaFor(prisma, clientIp(forwardedFor)).peek();
  return { remaining, perVisitor, houseConfigured: !!(await resolveLlm()) };
}
