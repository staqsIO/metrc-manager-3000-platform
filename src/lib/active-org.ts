/**
 * Active organization cookie helpers.
 *
 * The "active org" is a UI preference controlling which organization's
 * facilities are shown. It is NOT auth data — access checks still
 * iterate all orgs the user belongs to.
 */

export const ACTIVE_ORG_COOKIE = 'f8-active-org';

/** Read the active org ID from a parsed cookies object (server-side). */
export function getActiveOrgId(cookies: Record<string, string | undefined>): string | null {
  return cookies[ACTIVE_ORG_COOKIE] ?? null;
}

/** Set the active org cookie (client-side, 30-day expiry). */
export function setActiveOrgCookie(orgId: string): void {
  document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; max-age=${30 * 86400}; SameSite=Lax`;
}

/** Remove the active org cookie (client-side). */
export function clearActiveOrgCookie(): void {
  document.cookie = `${ACTIVE_ORG_COOKIE}=; path=/; max-age=0`;
}

/**
 * Sign out wrapper that clears the active-org cookie before delegating to
 * NextAuth. Use this instead of `signOut()` directly so a stale `activeOrgId`
 * pointer doesn't carry over into the next sign-in (root cause of the
 * post-incident "OrgSwitcher still shows the deleted org" UX bug —
 * see ADR-020 Phase 4 / FOR-1481).
 */
export async function signOutWithCleanup(
  options?: Parameters<typeof import('next-auth/react').signOut>[0],
): Promise<unknown> {
  clearActiveOrgCookie();
  // Dynamic import keeps the next-auth client out of any SSR bundle that
  // might import this helper for the cookie utilities only.
  const { signOut } = await import('next-auth/react');
  return signOut(options);
}
