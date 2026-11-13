import type { NextApiRequest, NextApiResponse } from 'next'
import { demoLogin, isGoogleEnabled, isOpenSignupEnabled } from '@/lib/auth-providers'

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json({ google: isGoogleEnabled(process.env), signupEnabled: isOpenSignupEnabled(process.env), demo: demoLogin(process.env) })
}
