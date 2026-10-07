# Contributing

## Setup

Follow "Develop locally" in [README.md](README.md).

## Workflow

1. Fork or branch from `main` (for example `feat/short-description`).
2. Keep changes focused; add or update tests.
3. Before opening a PR run:

   ```bash
   pnpm exec tsc --noEmit && pnpm test
   ```

4. Open a pull request against `main` with a clear description of what and why.

CI runs type checking and tests, and scans the repository with gitleaks. Never commit secrets; add new environment variables to `.env.example` with placeholder values.

## Security

Do not open public issues for vulnerabilities. See `SECURITY.md` in the root repository (https://github.com/staqsIO/metrc-formul8-os).

## License

By contributing you agree your contributions are licensed under the MIT license.
