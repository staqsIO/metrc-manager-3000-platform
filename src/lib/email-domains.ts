// Dependency-free: imported by Edge middleware.
export function parseDomainList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function isEmailDomainAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return allowed.includes(email.slice(at + 1).trim().toLowerCase());
}
