/**
 * Public types for the domain-verification module.
 *
 * The DomainMatchService is the read path used by auth callbacks
 * (createUserOrganization). The state-machine / challenge-issuer / verifier
 * modules (deferred to a later commit in ADR-020 Phase 2) handle write paths.
 */
export interface DomainClaim {
  /** OrganizationDomain row id */
  domainId: string
  /** Organization to attach the user to */
  organizationId: string
  /** Role name to grant on auto-attach (looked up against the Role table) */
  defaultRoleName: string
}

export interface DomainMatchService {
  /**
   * Returns the verified org claim for a given email, or null when:
   *   - email is malformed
   *   - the email's domain matches a generic mailbox provider (gmail, etc.)
   *   - no VERIFIED OrganizationDomain row matches the domain
   */
  findClaimingOrg(email: string): Promise<DomainClaim | null>

  /** True when the given (already-normalized) domain is in the generic-providers list. */
  isGenericDomain(domain: string): Promise<boolean>

  /**
   * Lowercases, trims, strips trailing dot, IDN-punycodes the domain part of
   * an email. Returns null when the email is unparseable. Plus-addressing
   * (`user+tag@example.com`) is preserved on the local part but only the
   * domain is returned by this helper.
   */
  normalizeDomain(rawEmail: string): string | null
}
