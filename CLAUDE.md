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

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
