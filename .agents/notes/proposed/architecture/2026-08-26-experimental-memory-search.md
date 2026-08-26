# Agent Note: Experimental workspace memory search

Status: proposed

English | [中文](2026-08-26-experimental-memory-search.zh.md)

## Problem

External memory can bypass the DSH session log by adding retrieved text directly to a prompt. That breaks replay because a resumed session cannot reconstruct what the model previously saw, and provider-supplied scope can widen access beyond the calling workspace.

## Proposal

Add an opt-in experimental `ctx.memory` service and `memory_search` tool. The local provider searches the existing `ctx.sessionQuery` corpus and does not replace DSH session persistence. The tool derives workspace scope from the exact live calling Agent's `SessionHeader.cwd`, appends a versioned `memory/search` event with the exact bounded citations, and returns those citations only after that append succeeds.

The first provider exposes search only. It validates stale Agents, missing workspaces, empty queries, hit limits, and aggregate byte limits before query work. An append-time invariant rejects a `memory/search` event whose workspace differs from its owning session.

## Alternatives considered

**Direct external prompt injection.** Rejected because retrieved text would become hidden model state that replay cannot reconstruct from the session log.

**Use TencentDB Agent Memory or OpenViking as DSH session persistence.** Rejected because the append-only DSH session log owns replay, forks, tool history, and UI fidelity; external memory remains a derived retrieval provider.

**Accept workspace scope from tool arguments.** Rejected because model arguments are not an authorization source. The service derives scope from the calling Agent's session metadata.

## Acceptance criteria

- The local provider returns only citations from the caller's workspace and enforces request bounds.
- `memory_search` records the exact returned citations in `memory/search` before returning model-visible text.
- The package invariant rejects events that claim a workspace different from the owning session.
- A Loader-composed test runs the installed tool, observes its JSON result, and observes the durable event.

## Risks

The initial provider searches only session history and does not provide semantic vector retrieval or external durable knowledge. Adding automatic recall, memory storage, TencentDB, or OpenViking requires provider-specific authorization, response bounds, failure behavior, and durable event semantics before model use.
