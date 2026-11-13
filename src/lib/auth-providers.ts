type Env = Record<string, string | undefined>;
export const isGoogleEnabled = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const isOpenSignupEnabled = (env: Env) => (env.OPEN_SIGNUP ?? '').trim().toLowerCase() === 'true';
export const isPortalLoginEnabled = (env: Env) => Boolean(env.AUTO_LOGIN_ISSUER_WHITELIST?.trim());
// Public demo: the shared login is shown on the sign-in page. Only when DEMO_MODE=1.
export const demoLogin = (env: Env): { email: string; password: string } | null =>
  env.DEMO_MODE === '1'
    ? { email: (env.DEMO_EMAIL || 'demo@example.com').trim().toLowerCase(), password: env.DEMO_PASSWORD || 'metrc-manager-demo' }
    : null;
