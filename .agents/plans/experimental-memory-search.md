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
- [x] Implement local **search-only** provider:
  - [x] workspace scope = `SessionHeader.cwd` of caller (not tool args)
  - [x] validate before query: stale agents, missing workspace, empty query,
        `hit_limit`, aggregate byte limit (`MAX_BYTES`)
  - [x] return only citations from the caller's workspace
- [x] Implement `memory_search` tool (tool agent):
  - [x] call `ctx.memory.search()`
  - [x] on success, append `memory/search` event with exact citations
      (append must succeed before returning model-visible text)
  - [x] on append rejection / failure, do NOT return retrieved text
- [x] Wire `append-time invariant`: reject `memory/search` whose workspace ≠
      owning session's workspace
- [x] Add package invariant test for the workspace-mismatch rejection
- [x] Loader-composed integration test:
  - [x] run installed `memory_search` tool against a local workspace with
        seeded session history
  - [x] observe JSON result (citations only, in bounded amounts)
  - [x] observe durable `memory/search` event on disk
- [x] Snapshot test covering model-visible transcript output
- [x] Update `.agents/HANDOFF.md` with current state
- [x] Review: does any path inject retrieved text outside the session log?
      (must not — replay safety gate)

## TencentDB follow-up

- [x] Align explicit L1 search with the upstream v3 isolation, service-header, and response-envelope contract.
- [x] Reject an enabled TencentDB route without real connection and isolation configuration.
- [x] Add an opt-in native retrieval overlay.
- [x] Add durable L0 capture with requested, succeeded, and safe failed events; delivery remains at least once across the crash window.
- [x] Add automatic logged L1 recall before the first model step with fail-open durable failures.
- [x] Allow the upstream anonymous loopback standalone Gateway while requiring bearer credentials for non-loopback endpoints.
- [ ] Install and manage a local standalone MemoryCore runtime from the DSH composition.
- [ ] Add bounded L2/L3 recall.
- [ ] Add a live standalone MemoryCore smoke test.

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
