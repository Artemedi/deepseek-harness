# Agent Note: Experimental workspace memory search

Status: proposed

English | [中文](2026-08-26-experimental-memory-search.zh.md)

## Problem

External memory can bypass the DSH session log by adding retrieved text directly to a prompt. That breaks replay because a resumed session cannot reconstruct what the model previously saw, and provider-supplied scope can widen access beyond the calling workspace.

## Proposal

Add an opt-in experimental `ctx.memory` service and `memory_search` tool. The local provider searches the existing `ctx.sessionQuery` corpus and does not replace DSH session persistence. The tool derives workspace scope from the exact live calling Agent's `SessionHeader.cwd`, appends a versioned `memory/search` event with the exact bounded citations, and returns those citations only after that append succeeds.

The first provider exposes search only. It validates stale Agents, missing workspaces, empty queries, hit limits, and aggregate byte limits before query work. An append-time invariant rejects a `memory/search` event whose workspace differs from its owning session.

The opt-in TencentDB provider uses the upstream v3 data-plane contract rather than translating a DSH workspace into provider tenancy. Deployment configuration supplies the memory service, Team, Agent, and User identifiers; every search sends that isolation tuple and records the returned L1 atomic-memory citations under the caller's DSH workspace. A numeric loopback standalone Gateway may use its upstream default with authentication disabled; DSH still supplies a non-secret bearer marker because the v3 data-plane parser requires the header shape. Hostname aliases and non-loopback endpoints require a DSH credential reference. Missing connection, authentication, or isolation configuration rejects the composition instead of selecting test data.

Optional managed mode launches an operator-installed, commit-pinned standalone MemoryCore checkout only through the local-host DSH subprocess service, explicitly forwards an existing DSH LLM credential, and blocks service activation until the numeric loopback health endpoint returns its exact ready envelope. The dependency is order-independent; remote execution worlds are rejected before credential resolution. The plugin refuses to adopt any existing HTTP listener and owns process-tree termination through unload and HMR. The configured OpenAI-compatible LLM may also be local. Application startup never downloads or updates MemoryCore because upstream does not publish a stable standalone Gateway executable.

Optional automatic capture exports only direct user text and assistant text from completed or max-token turns after the Agent becomes idle. DSH records and flushes a capture request before the remote write, then records a bounded success or failure event. Delivery is at least once because a process can stop after TencentDB accepts the turn but before DSH records success.

Optional automatic recall runs once before the first step, derives its query only from direct user input, and records the exact combined result before returning a separate model-visible reference message. It defaults to L1; deployments may opt into L2 and L3, which share one aggregate hit and byte budget. L2 uses the upstream scenario listing, ranks bounded path and summary metadata by literal query matches, and reads only selected profiles; L3 reads the singleton core profile. The message labels remote memory as potentially stale and non-instructional. A layer failure records a safe code and does not discard successful layers or block the model turn.

## Alternatives considered

**Direct external prompt injection.** Rejected because retrieved text would become hidden model state that replay cannot reconstruct from the session log.

**Use TencentDB Agent Memory or OpenViking as DSH session persistence.** Rejected because the append-only DSH session log owns replay, forks, tool history, and UI fidelity; external memory remains a derived retrieval provider.

**Accept workspace scope from tool arguments.** Rejected because model arguments are not an authorization source. The service derives scope from the calling Agent's session metadata.

## Acceptance criteria

- The local provider returns only citations from the caller's workspace and enforces request bounds.
- `memory_search` records the exact returned citations in `memory/search` before returning model-visible text.
- The package invariant rejects events that claim a workspace different from the owning session.
- A Loader-composed test runs the installed tool, observes its JSON result, and observes the durable event.
- A real headless Loader and AgentLoop test proves that logged TencentDB context precedes the direct prompt in the model request.
- TencentDB requests preserve the configured v3 isolation tuple, validate the business response envelope, and never expose deterministic stubs through an enabled runtime route.

## Risks

The local provider searches only session history. TencentDB L2 does not expose a semantic search endpoint, so DSH matches only bounded scenario path and summary metadata before selected reads; it never scans every scenario body. All remote layers require provider-specific authorization, response bounds, failure behavior, and durable event semantics before model use.
