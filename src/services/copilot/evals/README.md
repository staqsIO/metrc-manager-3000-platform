# Copilot Eval Harness

Regression tests for Copilot correctness. Locks Bug A/B/D fixes and guards against tool-selection drift.

## Status

**SCAFFOLD** — Replace the example set with your own golden set.

What exists today:
- `runner.ts` — tsx script that loads a golden-set JSON and executes each question. Wiring to `executeCopilotQuery` is a stub with inline instructions.
- `golden-set.schema.json` — JSON schema for question format
- `golden-set.example.json` — 3 seed questions (Bug B regression, Bug D regression, FIFO count)
- GitHub Action — see `.github/workflows/copilot-eval.yml`

## Running locally

```bash
# With scaffold stubs (exits 0, prints "not wired")
pnpm copilot:eval

# Against a specific facility (will fail until executeQuestion is wired)
FACILITY_ID=<cuid> pnpm copilot:eval

# Custom golden set
pnpm copilot:eval ./custom-set.json
```

## Follow-up work (next session)

1. Drop your full golden set into `golden-set.json` (schema-validated)
2. Wire `executeQuestion` in `runner.ts` to actually call `executeCopilotQuery` from `copilot-service.ts` — code snippet included in runner TODO comment
3. Create a test facility seed with deterministic inventory so numeric assertions are stable
4. Enable the GitHub Action nightly against staging
5. Add `--bail` flag for fast CI feedback
6. Optional: LLM-as-judge response-quality grading (Phase 2)

## Design principles

- **Deterministic assertions only** — tool selection (exact/subset), substring match, numeric ±tolerance. No LLM grading in v1.
- **Fast** — budget 10s per question, 10s * 20 = ~3 minutes full run. Nightly GH Action.
- **Explicit failures** — runner prints the exact failure reason per question.
- **Scaffold mode is green** — without FACILITY_ID the runner exits 0 so the scaffold PR merges cleanly. Real failures only appear once wired.
