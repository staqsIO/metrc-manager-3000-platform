type Env = Record<string, string | undefined>;

export interface Brand { name: string; logoUrl: string; supportEmail: string; emailFrom: string; appUrl: string }

/**
 * Merge the build-time inlined NEXT_PUBLIC_* values over the runtime env. The inlined values must
 * win (even when undefined) so a runtime NEXT_PUBLIC_BRAND_* on the server can't diverge from the
 * value baked into the client bundle.
 */
export function mergeBrandEnv(inlined: Env, runtime: Env | null): Env {
  return { ...(runtime ?? {}), ...inlined };
}

/**
 * Default env. Next.js only inlines literal `process.env.NEXT_PUBLIC_X` references, so these are
 * spelled out; the server-only vars are merged in only when not running in the browser.
 */
function defaultEnv(): Env {
  return mergeBrandEnv(
    {
      NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
      NEXT_PUBLIC_BRAND_LOGO_URL: process.env.NEXT_PUBLIC_BRAND_LOGO_URL,
    },
    typeof window === 'undefined' ? process.env : null,
  );
}

/**
 * Brand name/logo are build-time settings read only from NEXT_PUBLIC_* so server and client
 * always agree (a runtime fallback would make SSR and hydrated output diverge).
 */
export function getBrand(env: Env = defaultEnv()): Brand {
  const name = env.NEXT_PUBLIC_BRAND_NAME?.trim() || 'METRC Manager 3000';
  return {
    name,
    logoUrl: env.NEXT_PUBLIC_BRAND_LOGO_URL?.trim() || '/brand/logo.svg',
    supportEmail: env.SUPPORT_EMAIL?.trim() || 'support@staqs.io',
    emailFrom: env.EMAIL_FROM?.trim() || `${name} <noreply@staqs.io>`,
    appUrl: (env.APP_URL?.trim() || env.NEXTAUTH_URL?.trim() || 'http://localhost:3000').replace(/\/$/, ''),
  };
}
