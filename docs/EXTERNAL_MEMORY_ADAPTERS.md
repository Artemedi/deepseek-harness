# External Memory Adapter Contract

## Scope

This document defines the next provider adapters behind the experimental DSH memory seam. It does not authorize external providers to own DSH session history, agent identity, session replay, or prompt assembly.

## Shared Adapter Rules

Every adapter receives a scope derived by DSH from the exact calling Agent's `SessionHeader.cwd`. A model tool never accepts workspace, tenant, user, team, agent, task, or provider resource ids as authority input.

The adapter returns typed, bounded citations or a typed failure. It must not turn a provider timeout, authorization failure, malformed response, or unavailable service into an empty successful search.

Before a consumer exposes any citation to a later model request, it appends the exact bounded text to DSH `memory/search`. The durable observation includes the provider, DSH workspace, query, opaque citation id, source, title, and exact content. Scores and provider-only metadata do not substitute for cited text.

No adapter may run an implicit prompt-time query. Automatic retrieval needs an explicit producer event and a separate consumer that reuses a previously logged observation.

## TencentDB Agent Memory

### Safe Mapping

| TencentDB resource | DSH kind | DSH scope source | Adapter operation |
|---|---|---|---|
| Chat Memory | `memory` | Agent workspace plus trusted deployment mapping | explicit search only |
| Skill | `skill` | Agent workspace plus trusted deployment mapping | explicit search only |
| Wiki | `wiki` | Agent workspace plus trusted deployment mapping | explicit search only |
| CodeGraph | `code-graph` | Agent workspace plus trusted deployment mapping | explicit search only |

The TencentDB OpenAI-compatible proxy remains an operational experiment. Its `inject: true` configuration must not be used by a DSH-native memory profile because proxy-side injection produces model-visible state that DSH cannot reconstruct. A native adapter must call a documented retrieval endpoint or a narrow proxy operation that returns records; it must preserve the DSH direct LLM route as rollback.

The adapter uses an external configured base URL and a credential-store reference. It treats any returned provider memory id as opaque, prefixes it in a branded DSH `MemoryId`, and never infers authorization from it.

### Required Conformance Cases

- a same-workspace search returns at most the requested count and aggregate byte cap;
- cross-workspace provider records never reach the returned citations;
- 401/403, 429, 5xx, malformed JSON, and timeout are explicit failures;
- every citation shown by the tool exactly matches a prior `memory/search` event;
- profile rollback to direct DSH LLM routing requires no session migration.

## OpenViking

OpenViking is separately deployed under AGPLv3 and accessed only by a remote adapter. DSH does not vendor its source or persist `viking://` data into the DSH package distribution.

A request selects one explicit depth: `L0`, `L1`, or `L2`. The depth is a validated adapter request selected by deployment/tool policy, not a hidden prompt expansion. Each `viking://` response maps to an opaque `MemoryId`; its rendered content is byte bounded after UTF-8 encoding and recorded verbatim in `memory/search` before later model use.

### Required Conformance Cases

- invalid or omitted depth is rejected before network I/O;
- each returned `viking://` id is retained as opaque source metadata;
- larger L1/L2 provider documents are truncated only by an explicit byte policy, with the exact retained text logged;
- unavailable service, authorization denial, malformed record, and timeout fail loud;
- a replay run does not contact OpenViking to reconstruct prior citations.

## Deployment Gate

A provider may be mounted only after its stub conformance tests, Loader composition test, real app-bin keyless snapshot, credential redaction test, and rollback smoke pass. Production startup additionally requires explicit operator credentials; no credential values or raw provider responses enter the audit log.
