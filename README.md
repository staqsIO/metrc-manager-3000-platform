# METRC Manager 3000

A self-hosted web app for cannabis operators: METRC compliance and inventory dashboards, operational and financial analytics, and an AI Copilot. Built with Next.js, tRPC, Prisma and PostgreSQL.

## Run the full stack

To run everything with Docker, use the root repository: https://github.com/staqsIO/metrc-formul8-os

The Dockerfile in this repo builds with the parent (install) folder as context, since it also needs the sibling `metrc-formul8-os-client` checkout. From the install folder:

```bash
docker build -f metrc-formul8-os-platform/Dockerfile -t metrc-platform .
```

Brand name and logo are baked in at build time: pass `--build-arg NEXT_PUBLIC_BRAND_NAME=...` and `--build-arg NEXT_PUBLIC_BRAND_LOGO_URL=...` (the root docker compose maps its `BRAND_NAME` / `BRAND_LOGO_URL` settings to these). Setting them at runtime has no effect.

The image entrypoint takes one command: `web`, `migrate`, `sync`, `create-admin` or `cron`. Cron schedules are set with `CRON_SYNC_DAILY`, `CRON_SYNC_FULL` and `CRON_SYNC_SALES` (empty disables a job).

## Develop locally

Requirements: Node 22, pnpm 9, Docker (for Postgres). The sibling `metrc-formul8-os-client` repo must be checked out next to this one.

```bash
pnpm client:build
pnpm install
cp .env.example .env        # then fill in NEXTAUTH_SECRET and the encryption key/salt
                            # (DIRECT_URL must match DATABASE_URL for local runs)
docker run -d --name metrc-pg -e POSTGRES_USER=metrc -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=metrc -p 5432:5432 postgres:16
pnpm db:migrate && pnpm db:seed
pnpm create-admin --email you@example.com
pnpm dev
```

`.env.example` lists every variable the platform reads. Brand name and logo (`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`) are build-time settings; there is no runtime override.

`DASHBOARD_DATABASE_URL` defaults to `DATABASE_URL`. Migrations only run against `DATABASE_URL`, so pointing `DASHBOARD_DATABASE_URL` at a separate database is unsupported unless you apply the migrations to that database yourself.

## AI Copilot

LLM providers are managed by super admins at `/admin/llm-providers`.

- **OpenRouter** is an external service; prompts are anonymized before they leave your install. An optional key service URL can supply the API key, and the key service is consulted only for an OpenRouter provider that has a key service URL.
- **Ollama** runs locally, so data stays on the host. The model you choose must support tool calling.
- COA parsing uses the default provider's model when `openai/gpt-4o` is not offered, so on local-only installs a local model parses COAs.
- Changing a provider's base URL or key service URL clears its stored secret unless you re-enter it.

- Point an Ollama provider only at hosts you control; Ollama traffic is treated as local and is not anonymized.

On the first `migrate`, if no provider exists, providers are created from these environment variables. This happens once per install: afterwards the database is the source of truth, the variables are ignored, and manage providers in the UI. Deleting all providers disables AI and is not undone by a later `migrate`. If no variables were set, nothing is recorded, so adding them later still bootstraps.

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Creates an OpenRouter provider |
| `OPENROUTER_MODEL` | Default model (default `anthropic/claude-sonnet-4.6`) |
| `KEY_SERVICE_URL`, `KEY_SERVICE_API_KEY` | OpenRouter key service; both together also create OpenRouter without an API key |
| `OLLAMA_BASE_URL` | Creates an Ollama provider |
| `OLLAMA_MODEL` | Ollama model (default `qwen2.5:14b`) |
| `LLM_DEFAULT_PROVIDER` | `openrouter` or `ollama`; the default provider when both exist (openrouter if unset) |

## Authentication

- The first super admin is created with `create-admin`. There is no public sign-up unless `OPEN_SIGNUP=true`.
- Email and password sign-in is always on.
- Google sign-in is on only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, and it requires a verified Google email.
- A password account whose email was never verified is converted to a Google account (password cleared) when it later signs in with Google.
- Password sign-ups never join organizations through domain claims.
- There is no built-in rate limiting. Run the app behind a reverse proxy that rate-limits `/api/auth/*`.

## Tests

```bash
pnpm test        # unit tests (vitest)
pnpm test:e2e    # end-to-end tests (playwright)
```

## Project layout

- `src/app` - Next.js App Router pages and layouts
- `src/pages` - API routes (auth, tRPC, cron)
- `src/features` - feature UI modules (inventory, harvests, sales, ...)
- `src/server` - tRPC routers
- `src/services` - METRC, Dutchie, Canix, sync, analytics, copilot and pure engines
- `src/lib` - auth, prisma, email, brand, encryption and tRPC setup
- `src/shared` - shared components, hooks, types and utilities
- `src/scripts` - maintenance scripts
- `prisma` - schema, migrations and seed
- `scripts` - CLI scripts (create-admin, sync)
- `docker` - container entrypoint and cron schedule

## Contributors

Created by [Staqs](https://github.com/staqsIO), [Waev Tech](https://github.com/waevtech) and [UMB Advisors](https://github.com/UMB-Advisors). See the [root repository](https://github.com/staqsIO/metrc-formul8-os#contributors) for details.

## License

MIT. See [LICENSE](LICENSE).
