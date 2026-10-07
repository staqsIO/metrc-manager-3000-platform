# CLAUDE.md

Guidance for AI coding assistants working in this repository.

## Stack

Next.js (App Router plus `src/pages/api`), TypeScript, tRPC, Prisma on PostgreSQL, NextAuth, Tailwind, Vitest, Playwright. Node 22, pnpm.

## Layout

- `src/app` pages, `src/features` feature UI, `src/server/api/routers` tRPC routers
- `src/services` METRC/Dutchie/Canix clients, sync, analytics, copilot
- `src/services/engines` pure calculation engines (no I/O)
- `src/lib` auth, prisma, brand, email, encryption, tRPC setup
- `prisma` schema, migrations, seed; `docker` entrypoint and cron

## Commands

- `pnpm client:build` build the sibling client package (run before install)
- `pnpm dev`, `pnpm build`, `pnpm lint`
- `pnpm exec tsc --noEmit && pnpm test` must pass before a PR
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm create-admin --email ...`
- `pnpm test:e2e` Playwright

## Conventions

- Never call METRC from React components. Go through tRPC routers and `src/services/metrc`.
- Keep calculation logic in pure engines under `src/services/engines`; pass data in, return data out, test without mocks.
- Pick the tRPC procedure by required access (`src/lib/trpc.ts`):
  - `protectedProcedure` any signed-in user
  - `facilityProcedure` facility reads (VIEWER-safe)
  - `facilityWriteProcedure` facility mutations (OPERATOR minimum)
  - `facilityAdminProcedure` ACL grants, credential management (ADMIN only)
  - `multiFacilityProcedure` reads across several accessible facilities
  Never use `facilityProcedure` for a facility-scoped mutation.
- Two Prisma clients exist (METRC data and dashboard/auth data); see `src/lib/prisma.ts`. They may point at one database.
- Facility credentials are encrypted with `METRC_ENCRYPTION_KEY`/`METRC_ENCRYPTION_SALT`; never change them after first use.
- Mutations follow preview, confirm, execute, and are written to the action log.
- Auth: no public sign-up unless `OPEN_SIGNUP=true`; first admin via `create-admin`. No built-in rate limiting.
- Auth details: Google sign-in requires a verified Google email; an unverified password account that signs in with Google is converted (password cleared); password sign-ups never join orgs via domain claims.
- Brand name/logo are build-time (`NEXT_PUBLIC_BRAND_*`).
- Never commit secrets or real credentials; `.env` is gitignored. Add any new variable to `.env.example`.
