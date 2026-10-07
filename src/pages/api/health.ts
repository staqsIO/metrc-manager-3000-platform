import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '@/lib/prisma'

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    await prisma.$queryRaw`SELECT 1`
    return res.status(200).json({ ok: true, db: 'up' })
  } catch {
    return res.status(503).json({ ok: false, db: 'down' })
  }
}
