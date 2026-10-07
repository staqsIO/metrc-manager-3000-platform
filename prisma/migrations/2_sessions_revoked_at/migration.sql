-- Session revocation timestamp for account conversion (pre-hijack defence).
ALTER TABLE "users" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
