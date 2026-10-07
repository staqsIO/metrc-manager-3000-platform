import crypto from 'crypto'

/**
 * FOR-1495: timing-safe Bearer-token check for cron endpoints.
 *
 * Compares the incoming Authorization header against `Bearer ${CRON_SECRET}`
 * with `crypto.timingSafeEqual`, avoiding the short-circuit behavior of `!==`
 * that can leak secret length / content via response-time differences.
 *
 * Returns false (not throws) when CRON_SECRET is unset so callers don't have
 * to guard for that case — a missing secret should always 401, never crash.
 */
export function verifyCronSecret(authHeader: string | undefined): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false
  const expected = `Bearer ${secret}`
  // timingSafeEqual requires equal-length buffers; length mismatch is a fast
  // (and safe — length itself isn't sensitive) reject before the constant-time
  // compare runs.
  if (authHeader.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
}
