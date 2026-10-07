import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'

/**
 * FOR-997: Upsert a provider identity mapping for a user.
 * Links external provider IDs (Google sub, LibreChat ObjectId) to canonical users.
 *
 * Gracefully degrades: if the user_identity_map table doesn't exist (P2021),
 * logs a warning and returns without blocking sign-in.
 */
export async function upsertIdentityMapping({
  userId,
  provider,
  providerAccountId,
  email,
  metadata = {},
}: {
  userId: string
  provider: string
  providerAccountId: string
  email: string
  metadata?: Prisma.InputJsonValue
}): Promise<void> {
  try {
    await prisma.userIdentityMap.upsert({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      create: {
        id: crypto.randomUUID(),
        userId,
        provider,
        providerAccountId,
        canonicalEmail: email.toLowerCase(),
        metadata,
      },
      update: {
        userId,
        canonicalEmail: email.toLowerCase(),
        metadata,
        updatedAt: new Date(),
      },
    })
  } catch (error: unknown) {
    // P2021 = table does not exist in Prisma
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2021'
    ) {
      console.warn(
        '[identity-map] user_identity_map table not found — skipping. Run the migration first.'
      )
      return
    }
    console.error('[identity-map] Failed to upsert identity mapping:', error)
  }
}
