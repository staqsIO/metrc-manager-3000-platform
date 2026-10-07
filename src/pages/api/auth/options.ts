import type { NextApiRequest, NextApiResponse } from 'next'
import { isGoogleEnabled, isOpenSignupEnabled } from '@/lib/auth-providers'

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json({ google: isGoogleEnabled(process.env), signupEnabled: isOpenSignupEnabled(process.env) })
}
