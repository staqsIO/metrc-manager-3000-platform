import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importSPKI,
  importX509,
  jwtVerify,
  type JWK,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose'

type JwtKeyResolver =
  | ReturnType<typeof createLocalJWKSet>
  | CryptoKey
  | Uint8Array
  | JWK

const tokenKeyCache = new Map<string, JwtKeyResolver>()

// Server-only: read at runtime, the same variable that registers the portal
// token provider in src/lib/auth.ts.
const getAllowedIssuers = (): string[] => {
  const raw = process.env.AUTO_LOGIN_ISSUER_WHITELIST || ''
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const isIssuerAllowed = (issuer: string): boolean => {
  const allowedIssuers = getAllowedIssuers()
  if (allowedIssuers.length === 0) {
    return false
  }
  return allowedIssuers.includes(issuer)
}

const getJwtKeyForIssuer = async (issuerUrl: string, alg: string): Promise<JwtKeyResolver> => {
  const cached = tokenKeyCache.get(issuerUrl)
  if (cached) {
    return cached
  }

  const response = await fetch(issuerUrl, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Failed to fetch issuer key: ${response.status}`)
  }

  const body = (await response.text()).trim()

  if (body.startsWith('{')) {
    const jwks = JSON.parse(body) as JSONWebKeySet
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('Issuer JWKS did not include keys')
    }
    const jwkSet = createLocalJWKSet(jwks)
    tokenKeyCache.set(issuerUrl, jwkSet)
    return jwkSet
  }

  const isCertificate = body.includes('BEGIN CERTIFICATE')
  const key = isCertificate ? await importX509(body, alg) : await importSPKI(body, alg)
  tokenKeyCache.set(issuerUrl, key)
  return key
}

export const verifyAutoLoginToken = async (
  token: string,
): Promise<{ email: string } | null> => {
  try {
    const header = decodeProtectedHeader(token)
    if (!header.alg || header.alg === 'none') {
      return null
    }

    const payload = decodeJwt(token)
    const issuer = typeof payload.iss === 'string' ? payload.iss : null
    const email = typeof payload.email === 'string' ? payload.email : null

    if (!issuer || !email) {
      return null
    }

    if (!isIssuerAllowed(issuer)) {
      return null
    }

    const key = await getJwtKeyForIssuer(issuer, header.alg)
    if (typeof key === 'function') {
      await jwtVerify(token, key as JWTVerifyGetKey, { algorithms: [header.alg] })
    } else {
      await jwtVerify(token, key, { algorithms: [header.alg] })
    }

    return { email }
  } catch (error) {
    console.error('Invalid auto-login token:', error)
    return null
  }
}
