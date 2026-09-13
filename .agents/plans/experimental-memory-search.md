# Plan: Experimental workspace memory search

Active plan for the experimental `memory_search` tool and local search provider.
Implements phase 2 of `.agents/notes/proposed/architecture/2026-08-26-three-project-integration-plan.md`,
scoped by `.agents/notes/implemented/architecture/2026-08-26-experimental-memory-search.md`.

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
- [x] Start and stop an operator-installed, commit-pinned standalone MemoryCore runtime from the DSH composition.
- [x] Add bounded L2/L3 recall with explicit upstream scenario/core contracts and a shared automatic-recall budget.
- [x] Add and run a live standalone MemoryCore v3 health, L0 capture/query, and L1 search smoke test.
- [x] Run live L1 and L2 extraction through an OpenAI-compatible LLM and read the resulting atomic memory and scenario.
- [x] Define and implement atomic L3 publication after live evidence showed `persona.md` remained readable when a later LLM continuation failed: file tools now write an isolated draft and publish only after the complete runner succeeds.
- [x] Prove automatic recall through a real headless Loader, AgentLoop, model request, and persisted event projection.
- [x] Enforce the pinned L0 capture bounds and validate the complete conversation acceptance result.
- [x] Replace the deployment-wide TencentDB isolation tuple with exact absolute-workspace/effective-preset bindings and reject ambiguous or unbound scopes before HTTP.
- [x] Define layered recall as fail-open for provider failures, fail-fast for cancellation, with a closed non-sensitive durable diagnostic vocabulary.
- [x] Stream remote responses under the configured byte limit and reject provider URLs that are not bare HTTP(S) origins.
- [x] Add every durable memory event to the generated persistence vocabulary so logs containing capture or recall diagnostics can resume.
- [x] Make failed L3 generation and source reads reject without advancing the checkpoint.
- [x] Publish the L3 fix as upstream PR `TencentCloud/TencentDB-Agent-Memory#1355` from signed commit `5782862`.

## Definition of done

- Search provider + `memory_search` tool compile and pass unit tests.
- A Loader test proves the tool records `memory/search` with exact citations
  before returning model-visible text, and that workspace-mismatch events are
  rejected.
- The opt-in TencentDB route captures L0 turns, retrieves bounded L1-L3 results,
  supports an owned local runtime, and records model-visible recall before use.
- Live L1/L2 extraction through a functioning MemoryCore LLM pipeline is
  verified; L3 draft isolation is covered by regression tests and a live AI-SDK
  write-then-429 smoke that leaves the published profile unchanged.
- HANDOFF reflects the shipped state.

## Notes

- This is an **experimental** package; it ships under
  `packages/experimental/*` and the `experimental-verifier` bundle.
- The final production-readiness review was completed after switching above the
  earlier Sol `high` boundary. It closed response buffering, endpoint parsing,
  durable event vocabulary, and L3 checkpoint/read-failure gaps.
- The broader rollout remains tracked in the
  [three-project integration plan](../notes/proposed/architecture/2026-08-26-three-project-integration-plan.md).
