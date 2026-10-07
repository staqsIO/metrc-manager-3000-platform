// Stub env vars so modules that import `@/lib/prisma` load without throwing.
// Tests must not hit the DB — they pass stub Prisma clients into pure helpers.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.DASHBOARD_DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.NEXTAUTH_SECRET ??= 'test-secret';
