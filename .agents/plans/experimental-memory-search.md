# Plan: Experimental workspace memory search

Active plan for the experimental `memory_search` tool and local search provider.
Implements phase 2 of `.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md`,
scoped by `.agents/notes/proposed/architecture/2026-08-26-experimental-memory-search.md`.

## Goal

Add an opt-in experimental `ctx.memory` service + `memory_search` tool. Local
provider searches the existing `ctx.sessionQuery` corpus (session history only),
derives workspace scope from the calling agent's `SessionHeader.cwd` (never from
tool args), records a versioned `memory/search` event with exact bounded citations
before returning model-visible text, and enforces an append-time invariant that
rejects events claiming a workspace other than the owning session.

## Checklist

- [x] Define `ctx.memory` Service Definition + local stub provider
      (commits `f9983eb1d0`–`dd944e5e79`: `resolve(memory)` Explicit-Provider)
- [x] Add experimental JSON verifier bundle
      (`packages/experimental/verifier/`, `packages/bundle/experimental-verifier/`)
- [x] Adopt risk-based cross-review policy
      (`.agents/notes/implemented/2026-08-30-risk-based-cross-review-policy.md`)
- [ ] Implement local **search-only** provider:
  - [ ] workspace scope = `SessionHeader.cwd` of caller (not tool args)
  - [ ] validate before query: stale agents, missing workspace, empty query,
        `hit_limit`, aggregate byte limit (`MAX_BYTES`)
  - [ ] return only citations from the caller's workspace
- [ ] Implement `memory_search` tool (tool agent):
  - [ ] call `ctx.memory.search()`
  - [ ] on success, append `memory/search` event with exact citations
      (append must succeed before returning model-visible text)
  - [ ] on append rejection / failure, do NOT return retrieved text
- [ ] Wire `append-time invariant`: reject `memory/search` whose workspace ≠
      owning session's workspace
- [ ] Add package invariant test for the workspace-mismatch rejection
- [ ] Loader-composed integration test:
  - [ ] run installed `memory_search` tool against a local workspace with
        seeded session history
  - [ ] observe JSON result (citations only, in bounded amounts)
  - [ ] observe durable `memory/search` event on disk
- [ ] Snapshot test covering model-visible transcript output
- [ ] Update `.agents/HANDOFF.md` with current state
- [ ] Review: does any path inject retrieved text outside the session log?
      (must not — replay safety gate)

## Definition of done

- Search provider + `memory_search` tool compile and pass unit tests.
- A Loader test proves the tool records `memory/search` with exact citations
  before returning model-visible text, and that workspace-mismatch events are
  rejected.
- No external durable vector store wired yet (search is session-history-only).
- HANDOFF reflects the shipped state.

## Notes

- This is an **experimental** package; it ships under
  `packages/experimental/*` and the `experimental-verifier` bundle.
- Phase 1 (TencentDB proxy validation) and phases 3–5 are **out of scope**
  here — tracked in the three-project integration plan note.
