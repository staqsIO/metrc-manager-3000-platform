type Env = Record<string, string | undefined>;
export const isGoogleEnabled = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const isOpenSignupEnabled = (env: Env) => (env.OPEN_SIGNUP ?? '').trim().toLowerCase() === 'true';
export const isPortalLoginEnabled = (env: Env) => Boolean(env.AUTO_LOGIN_ISSUER_WHITELIST?.trim());
