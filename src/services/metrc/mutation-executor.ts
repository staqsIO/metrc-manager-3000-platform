/**
 * Core reusable helper for executing Metrc mutations with:
 * 1. beforeState capture (passed in by caller)
 * 2. Try/catch with FAILED ActionLog on error
 * 3. COMPLETED ActionLog on success
 * 4. Inline verification re-read + comparison
 * 5. Update ActionLog to VERIFIED or UNVERIFIED
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { VerificationResult, Discrepancy } from './verification-checks';

export interface MutationExecutorInput {
  prisma: PrismaClient;
  facilityId: string;
  userId: string;
  actionType: string;
  targetType: string;
  targetIds: string[];
  targetCount: number;
  /** The actual Metrc API call wrapped in a function */
  executeFn: () => Promise<void>;
  /** Pre-captured entity snapshot (optional — degraded verification if missing) */
  beforeState?: unknown;
  /** Verification function: re-reads from Metrc and compares. Return null to skip verification. */
  verifyFn?: () => Promise<VerificationResult | null>;
  /** Delay in ms before running verification (handles Metrc eventual consistency). Default: 1000 */
  verifyDelayMs?: number;
}

export interface MutationExecutorResult {
  actionLogId: string;
  status: 'COMPLETED' | 'VERIFIED' | 'UNVERIFIED' | 'FAILED';
  verified?: boolean;
  discrepancies?: Discrepancy[];
  error?: string;
}

export async function executeMutationWithVerification(
  input: MutationExecutorInput,
): Promise<MutationExecutorResult> {
  const {
    prisma,
    facilityId,
    userId,
    actionType,
    targetType,
    targetIds,
    targetCount,
    executeFn,
    beforeState,
    verifyFn,
    verifyDelayMs = 1000,
  } = input;

  // 1. Execute the mutation
  try {
    await executeFn();
  } catch (err) {
    // Create FAILED ActionLog
    const actionLog = await prisma.actionLog.create({
      data: {
        facilityId,
        userId,
        actionType,
        status: 'FAILED',
        targetType,
        targetIds,
        targetCount,
        beforeState: beforeState as Prisma.InputJsonValue ?? undefined,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        errorDetails: err instanceof Error
          ? { name: err.name, stack: err.stack } as unknown as Prisma.InputJsonValue
          : undefined,
        executedAt: new Date(),
      },
    });

    return {
      actionLogId: actionLog.id,
      status: 'FAILED',
      verified: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // 2. Create COMPLETED ActionLog
  const actionLog = await prisma.actionLog.create({
    data: {
      facilityId,
      userId,
      actionType,
      status: 'COMPLETED',
      targetType,
      targetIds,
      targetCount,
      beforeState: beforeState as Prisma.InputJsonValue ?? undefined,
      executedAt: new Date(),
    },
  });

  // 3. Verify if verifyFn provided
  if (!verifyFn) {
    return { actionLogId: actionLog.id, status: 'COMPLETED', verified: undefined };
  }

  // Wait for Metrc eventual consistency before verifying
  if (verifyDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, verifyDelayMs));
  }

  try {
    let result = await verifyFn();

    if (!result) {
      // Verification skipped (e.g., no check function for this type)
      return { actionLogId: actionLog.id, status: 'COMPLETED', verified: undefined };
    }

    // Retry once on verification failure (Metrc eventual consistency)
    if (!result.verified && verifyDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, verifyDelayMs * 2));
      result = await verifyFn() ?? result;
    }

    const newStatus = result.verified ? 'VERIFIED' : 'UNVERIFIED';

    // 4. Update ActionLog with verification result
    await prisma.actionLog.update({
      where: { id: actionLog.id },
      data: {
        status: newStatus,
        afterState: result.discrepancies.length > 0
          ? { discrepancies: result.discrepancies } as unknown as Prisma.InputJsonValue
          : undefined,
        metadata: { verifiedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      actionLogId: actionLog.id,
      status: newStatus,
      verified: result.verified,
      discrepancies: result.discrepancies,
    };
  } catch (verifyErr) {
    // Verification read failed — mark UNVERIFIED but don't throw
    await prisma.actionLog.update({
      where: { id: actionLog.id },
      data: {
        status: 'UNVERIFIED',
        metadata: {
          verificationError: verifyErr instanceof Error ? verifyErr.message : 'Unknown verification error',
          verifiedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      actionLogId: actionLog.id,
      status: 'UNVERIFIED',
      verified: false,
      discrepancies: [],
    };
  }
}
