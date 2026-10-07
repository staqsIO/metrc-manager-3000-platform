import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getToken = vi.fn()
vi.mock('next-auth/jwt', () => ({ getToken: (...args: unknown[]) => getToken(...args) }))

import { middleware, config } from './middleware'

function req(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

describe('middleware', () => {
  beforeEach(() => {
    getToken.mockReset()
    getToken.mockResolvedValue(null)
  })

  it.each(['/brand/logo.svg', '/brand/logo.png'])(
    'lets signed-out requests for public brand asset %s through',
    async (path) => {
      const res = await middleware(req(path))
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-next')).toBe('1')
    },
  )

  it('redirects signed-out page requests to sign-in', async () => {
    const res = await middleware(req('/dashboard'))
    expect(res.headers.get('location')).toBe('http://localhost:3000/auth/signin')
  })

  it('matcher excludes common static file extensions', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`)
    for (const p of ['/favicon-32x32.png', '/favicon.svg', '/brand/logo.svg', '/robots.txt']) {
      expect(pattern.test(p)).toBe(false)
    }
    expect(pattern.test('/dashboard')).toBe(true)
    expect(pattern.test('/api/trpc/foo')).toBe(true)
  })

  it('matcher never skips /api/ paths, even when they end in a static extension', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`)
    // tRPC batch URLs join procedure names with commas; a trailing ".png" must not bypass the gate.
    expect(pattern.test('/api/trpc/x.list,y.png')).toBe(true)
    expect(pattern.test('/api/files/logo.svg')).toBe(true)
  })
})
