# Experimental Memory Service

`@deepseek-ai/dsh-experimental-memory` provides explicit, workspace-authorized retrieval over the DSH session-query corpus.

The service accepts an exact live `Agent`, derives the workspace from `agent.session.header.cwd`, validates request bounds, and delegates retrieval to a provider-neutral search interface. The shipped `local` provider reads bounded citations from same-workspace session events and is mandatory in the configured provider set. Provider configuration is resolved at load time: empty, duplicate, unknown, or missing-`local` routes fail before any search runs. The service does not store provider state, inject prompt content, or replace session persistence. The `memory/search` event records the exact normalized query and citations before a consumer gives them to a later model request.

TencentDB can be enabled explicitly with `providers: ['local', 'tencentdb']` and a `tencentdb` object containing `baseUrl`, memory-instance `serviceId`, and the required `teamId`, `agentId`, and `userId` isolation identifiers. A numeric loopback Gateway may omit `credentialRef`; DSH then supplies the non-secret bearer marker required by the upstream v3 parser even when Gateway authentication is disabled. Hostname aliases such as `localhost` and every non-loopback Gateway require a DSH credential containing the Gateway's bearer secret, and an explicitly configured but unresolved credential fails without fallback. The native route sends the identifiers using TencentDB's v3 `POST /v3/atomic/search` contract, validates both HTTP status and the response envelope, and maps `data.items` to bounded citations. `automaticCapture: true` exports completed and max-token turns through `POST /v3/conversation/add` after the Agent becomes idle; it excludes synthetic user context and records durable requested, succeeded, or safe failed events around the remote operation. `automaticRecall: true` searches L1 before the first step of each turn, records the exact result in `memory/search`, and enters the same citations as a separate user message labelled as stale, non-instructional reference context. Recall failures append a safe code and continue without memory. Enabling either automatic operation without TencentDB or enabling the route without its connection and isolation configuration fails during composition loading. Endpoint, credential, isolation, capture, and recall changes require reloading the composition.

`tencentdbRuntime` makes DSH own a co-located standalone MemoryCore process. It waits for `@deepseek-ai/dsh-subprocess-local` regardless of composition order, rejects remote or unspecified execution worlds before resolving credentials, launches `args` in `cwd`, explicitly forwards the configured existing LLM credential, and requires the exact `{ "status": "ok" }` health envelope before activation. It terminates the complete process tree on unload or HMR. `dataDir` owns the local SQLite and file state; `gatewayConfig` defaults to `tdai-gateway.standalone.yaml`. Startup rejects a non-numeric-loopback or path-bearing endpoint, a missing LLM credential, any existing HTTP listener, an early process exit, or a readiness timeout. The LLM URL may itself be a local OpenAI-compatible service, so managed mode does not require a third-party memory service. The runtime must be an operator-installed checkout pinned to a reviewed commit because upstream does not publish a standalone Gateway executable; DSH never clones or installs mutable external code during application startup.

OpenViking can be enabled explicitly with `providers: ['local', 'openviking']` and an `openviking` object containing `baseUrl`, optional `credentialRef`, and optional trusted `targetUri`. The native route calls the confirmed `POST /api/v1/search/find` endpoint with `query`, `limit`, and the configured target URI. It maps `result.memories`, `result.resources`, and `result.skills` records into opaque citations and applies the DSH-selected `L0`, `L1`, or `L2` depth, bounds, timeout, cancellation, redirect rejection, and typed failures. Without that object, the route is a deterministic local stub. The adapter does not use session context or implicit prompt injection.

## Model Experience

### Service output

#### What the model sees

The service itself registers no model-facing schema or prompt text; `memory_search` owns the explicit presentation of its bounded citations.

#### Token effect

No tokens are added by this service unless a composed consumer presents a returned citation.

#### KV Cache effect

The service does not add model context unless a consumer explicitly records and presents its result.

## Known Limitations and Deferred Work

- **L1 recall only** — TencentDB receives L0 conversation turns and performs its own asynchronous extraction. DSH exposes L1 atomic memories through `memory_search` and optional first-step automatic recall; L2/L3 context remains deferred.
- **Capture delivery** — DSH flushes the durable request before sending a turn and records the outcome afterward. A crash between remote success and the local success event can resend that turn; TencentDB message identity or a future idempotency key must close this at-least-once window.
- **Opt-in HTTP routes** — TencentDB and OpenViking HTTP providers are selected only by explicit provider configuration; the default DSH/Web composition remains unchanged. OpenViking retains a deterministic local stub for contract tests. TencentDB accepts an externally managed Gateway or a DSH-managed, operator-installed local runtime.
- **OpenViking scope** — the native route uses the confirmed `/api/v1/search/find` envelope and a trusted deployment `targetUri`; it does not infer tenant authorization from DSH filesystem paths or provider response fields. The deployment must provide an isolated target URI when multi-tenant scope matters.
- **Upstream distribution** — Managed mode needs an installed, commit-pinned MemoryCore checkout because the current upstream npm package has no Gateway executable. Configuration load never downloads packages, clones repositories, or pulls containers.
- **Remote durable fields** — remote hits omit DSH session ids and event sequences because they are not first-party session records. They retain provider id, opaque source, kind, title, and exact bounded content in `memory/search`.
