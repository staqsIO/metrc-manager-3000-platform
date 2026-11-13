import { TRPCError } from '@trpc/server';
import { prisma } from '@/lib/prisma';
import { resolveLlm } from '@/services/llm/registry';
import { DEMO_QUOTA_MESSAGE, demoQuotaFor, isDemoMode, visitorIp } from '@/services/copilot/demo-quota';

/** The client-address headers from the tRPC context (src/lib/trpc.ts). */
export interface IpHeaders { forwardedFor?: string | string[] | null; realIp?: string | string[] | null }

/**
 * Charges one free demo question before a tRPC path uses the house key. These paths take no
 * visitor key; only the streaming chat route (src/app/api/copilot/chat/route.ts) does.
 * Returns false when the question was refused; outside demo mode, or with no house key, it
 * charges nothing and returns true.
 */
export async function takeDemoQuestion(ctx: IpHeaders): Promise<boolean> {
  if (!isDemoMode() || !(await resolveLlm())) return true;
  return (await demoQuotaFor(prisma, visitorIp(ctx.forwardedFor, ctx.realIp)).consume()).allowed;
}

export async function takeDemoQuestionOrThrow(ctx: IpHeaders): Promise<void> {
  if (!(await takeDemoQuestion(ctx))) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: DEMO_QUOTA_MESSAGE });
}

/** What the demo's AI panel shows; null on a real install. */
export async function demoQuotaStatus(ctx: IpHeaders) {
  if (!isDemoMode()) return null;
  const { remaining, perVisitor } = await demoQuotaFor(prisma, visitorIp(ctx.forwardedFor, ctx.realIp)).peek();
  return { remaining, perVisitor, houseConfigured: !!(await resolveLlm()) };
}
