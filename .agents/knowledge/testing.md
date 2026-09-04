# Testing — how tests run and what CI checks

## Local test commands

```sh
pnpm run test                 # vitest unit tests
pnpm run test:coverage        # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e             # real-API tests; self-skips without DEEPSEEK_API_KEY
pnpm run test:snapshot        # keyless ACP/headless replay vs expected outputs
pnpm run test:snapshot:record # re-record expected outputs (needs key); filter: -t <name>
```

- `test` covers source-plane unit behavior. `test:coverage` is the **CI**
  coverage gate, not `test` (see `docs/testing.md#why`).
- `test:e2e` requires `DEEPSEEK_API_KEY` (optional `DEEPSEEK_BASE_URL`, root
  `.env`). Without a key it self-skips — do not treat skip as pass.
- Subprocess tests can run in two launch modes: built `lib/` or source via the
  `dsh` launcher (`node --import tsx/esm`). A test exercising the *shipped
  package* must use built output; a *source regression* uses the declared
  launcher. Full policy: `docs/testing.md#test-subprocess-launch-modes`.

## Snapshot discipline

- Every non-trivial model- or product-user-visible behavior change adds or
  updates a **keyless** snapshot through a real runnable example in the same
  PR. Package tests, e2e-only assertions, and mock-only fixtures do **not**
  substitute for the assembled application transcript.
- Fixtures must replay on macOS/Linux. When a snapshot fails, **fix the
  fixture**, not the normalizer.
- `SessionEventMap`, agent-loop, and session-lifecycle changes must update the
  TypeScript and Python SDK expected outputs in the same PR; `pnpm run test`
  alone does not cover them ([surfaces](docs/testing.md#when-a-snapshot-test-is-required)).

## Matching evidence to changes

| Surface | Evidence |
|---|---|
| Behavior change | focused unit test |
| Model/user output change | snapshot test |
| Docs change | `doc-sync` |
| Published path / config change | build + hygiene + built smoke |
| Provider/LM behavior | real-API e2e |

## Local pre-push check

Run checks before pushes via the
[`dsh-pre-push-checks` skill](.agents/skills/dsh-pre-push-checks/SKILL.md);
report only the commands run. After `gh stack sync`, validate immediately —
**never merge before checks pass.**

- Never default to the full suite. Run the full matrix only on explicit
  request, for CI diagnosis, or for an irreducibly repository-wide change.
  CI owns exhaustive coverage and the platform matrix.

## Quality gates (doc-sync aggregate)

`pnpm run doc-sync` runs the full local documentation quality gate via
`scripts/run-gates.ts doc-sync`. Leaf gates are listed there; relevant ones
for knowledge files:

- `verify-agent-note-format` — **only** walks `.agents/notes/{proposed,implemented,rejected}/**/*.md`;
  `HANDOFF.md`, `knowledge/`, `plans/` are out of scope (exempt by design).
- `verify-md-links` — checks `.agents/notes/**/*.md`, `docs/**/*.md`, `AGENTS.md`,
  `packages/*/*.md`, `examples/**/*.md`. **Not** `knowledge/` or `HANDOFF.md`
  (these are working files; keep their links honest anyway).
- `verify-translation-pairing` — owns `.zh.md` consistency for Agent Notes.
  Knowledge/HANDOFF/plans files are exempt.
- `verify-doc-budgets` — hard budgets in `scripts/doc-budgets.manifest.json`.
  The **root `AGENTS.md`** has a budget of **1950 words**; it is already well
  under. `.agents/knowledge/AGENTS.md` and other knowledge files are unbudgeted
  working files.
