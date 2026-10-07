import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 10;
const COST = 12;
// Compared against when the user does not exist, so both paths cost one bcrypt compare.
// A real cost-12 bcrypt hash of a random throwaway string (must be well-formed or compare throws).
const DUMMY_HASH = '$2b$12$Hb52MNf6ckus8.N./nWsbultCqqwt9/jkA4Vr/xA4sC.wtnJzYLSS';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

type PasswordUser = { id: string; email: string; name: string | null; image: string | null; password: string | null };
type PasswordDb = { user: { findUnique(args: { where: { email: string } }): Promise<PasswordUser | null> } };

export async function authorizePassword(db: PasswordDb, email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } });
  const ok = await verifyPassword(password, user?.password);
  if (!user || !ok) return null;
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
