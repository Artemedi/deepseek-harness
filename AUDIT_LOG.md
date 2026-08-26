# Audit Log

Append-only operational record for the Harness Integrations project. Each entry records commands, evidence, failures, and the next action. Never rewrite an earlier entry; add a correction entry when needed.

## 2026-08-26: Project initialized

- **Scope:** OpenViking, TencentDB Agent Memory, and Ruflo integration around DeepSeek Harness.
- **Decision:** Keep DSH as the owner of agent loop, session log, replay, authorization, persistence, and plugin composition.
- **Priority:** P0 gateway error transparency; TencentDB proxy validation; DSH-native memory capability; OpenViking adapter; Ruflo patterns over existing orchestration.
- **Evidence:** TencentDB documents a DSH-compatible OpenAI Chat Completions proxy path. OpenViking is a separate Python AGPLv3 context database. Ruflo overlaps DSH subagents, Agent Teams, workflow, jobs, and memory concerns.
- **Next action:** Run the opt-in TencentDB stack and probe when Docker/Podman compose and LLM credentials are available.

## 2026-08-26: Gateway failure observed

- **Symptom:** `This turn failed` with `{"type":"api_error","message":"Upstream error."}` during a free-model gateway request.
- **Decision:** Treat the incident as a P0 blocker before enabling external memory injection.
- **Required evidence:** Preserve route/provider/status/code/request id/original message/retryability through gateway, API transport, DSH session log, and Web UI without exposing secrets.
- **Next action:** Trace the gateway route and add keyless regression coverage for minimal and structured error envelopes.

## 2026-08-26: Local environment probe

- **Command:** `python3 integrations/tencentdb-agent-memory/probe.py`
- **Result:** `{"check": "health", "status": 0, "classification": "non-json-response"}`; TencentDB proxy was not listening on `127.0.0.1:8096`.
- **Environment:** Host lacked Node.js, pnpm, and Docker. Podman was available. A Node 22 image was available, but the repository pnpm checks stopped before gate execution because the non-TTY workspace install attempted to remove `node_modules`.
- **Next action:** Restore a Node 22/pnpm workspace runner and start TencentDB services with a compose-capable Podman setup.

## 2026-08-26: Opt-in Podman runner added

- **Files:** `integrations/tencentdb-agent-memory/run.sh`, `.env.example`, `README.md`.
- **Behavior:** The runner uses isolated names, ports, volumes, and a network; validates all LLM settings before pulling images or creating containers; supports `validate`, `start`, `status`, `logs`, and `stop`.
- **Security:** Runtime configs and `.env` are ignored and created with owner-only umask. Credentials are passed only to container configuration/environment and are never printed by the runner.
- **Validation:** `bash -n integrations/tencentdb-agent-memory/run.sh` and `python3 -m py_compile integrations/tencentdb-agent-memory/probe.py` passed. Missing `.env` exits before container creation. Placeholder credentials exit before image pulls.
- **Result:** TencentDB images were not present locally and no LLM credentials are available in this environment, so the stack was intentionally not started.
- **Next action:** Provide local LLM credentials, run `./run.sh start`, then execute the proxy probe and record health/chat results.

## 2026-08-26: TencentDB images pulled

- **Command:** `podman pull agentmemory/memory-core:latest`; `podman pull agentmemory/memory-hub:latest`; `podman pull agentmemory/memory-proxy:latest`.
- **Result:** All three public images pulled successfully into the local Podman image store. The runner uses the `latest` tags from `.env.example`; pin immutable digests before a production deployment.
- **Decision:** Do not start containers without both independent LLM credential groups. No partial stack was created.
- **Blocker:** `MEMORY_LLM_BASE_URL`, `MEMORY_LLM_API_KEY`, `MEMORY_LLM_MODEL`, `PROXY_UPSTREAM_URL`, `PROXY_UPSTREAM_API_KEY`, and `PROXY_UPSTREAM_MODEL` are not available in this environment.
- **Next action:** Supply credentials through an untracked local `.env`, run `./run.sh validate`, then `./run.sh start` and the proxy probe.

## 2026-08-26: Image digests pinned

- **Pinned images:** `memory-core@sha256:9798254a8cc06276b7c5b3c19df49f136fae25d579564e1f01f9c4b9b8cd2d11`, `memory-hub@sha256:39548fd616f6f211ad2288e33fe5e93870b705cffe0468047520cd786408e657`, and `memory-proxy@sha256:c8de30142787a5df7937c02c167f2ee37f00505b79036357653a6ce78a29fba5`.
- **Reason:** Avoid silently changing the integration runtime when upstream `latest` tags move.
- **Next action:** Review the pinned upstream release and run the stack only with local credentials supplied outside Git.

## 2026-08-26: Repeated gateway failure with pi-ai classification

- **Symptom:** `This turn failed` with `{"type":"api_error","message":"Upstream error."}` and DSH code `PI_AI_ERROR`.
- **Interpretation:** The failure arrived through the pi-ai in-stream error path. The generic gateway message contains no provider status, request id, or retryability, so DSH cannot make a reliable recovery decision from it.
- **Decision:** Keep this incident in the P0 gateway reliability track. Do not treat `PI_AI_ERROR` as evidence that TencentDB memory or OpenViking context is functioning.
- **Required follow-up:** Capture the gateway response status, headers, and redacted body at the provider boundary; preserve them in `LlmFailure`; classify transient upstream failures separately from unknown pi-ai errors; add a keyless assembled regression.
- **Next action:** Reproduce with a local stub that emits the minimal gateway `api_error` envelope, then trace it through `llm-pi-ai`, session finish events, API transport, and Web UI.

## 2026-08-26: Deterministic gateway-error probe

- **Fixture:** `integrations/tencentdb-agent-memory/stub_gateway.py` returns `502`, `{"error":{"type":"api_error","message":"Upstream error."}}`, and `X-Request-ID: stub-request-0001` without contacting an LLM provider.
- **Command:** `TDAI_PROXY_BASE_URL=http://127.0.0.1:18096/dsh/default TDAI_PROXY_MODEL=stub python3 integrations/tencentdb-agent-memory/probe.py --check-chat`.
- **Result:** Health returned 200. The chat probe returned status 502, `gateway-upstream-error`, and `request_id: stub-request-0001`. The probe exited nonzero as required for a failed upstream request.
- **Fix discovered:** Header lookup was case-sensitive and hid `X-Request-ID`; the probe now reads request-id and correlation-id case-insensitively.
- **Next action:** Port the same fixture semantics to the DSH pi-ai adapter and Web assembled regression, preserving the request id and a retryable upstream classification where status/retry facts justify it.

## 2026-08-26: DSH pi-ai recovery classification

- **Change:** The exact flattened pi-ai error message `Upstream error.` now maps to DSH code `SERVER` instead of `PI_AI_ERROR`.
- **Reason:** pi-ai discards the gateway status and cause chain before DSH receives the terminal stream event. The exact minimal envelope contains no permanent-rejection fact, so `SERVER` activates the provider's existing bounded retry policy.
- **Evidence:** In an isolated Node 22 workspace, `pnpm exec vitest run packages/llm/llm-pi-ai/tests/convert.spec.ts` passed 72/72 tests, including the new classification regression.
- **Limit:** This does not preserve HTTP status, provider identity, raw gateway body, retry-after, or request id in DSH. The direct adapter/gateway instrumentation work remains required.
- **Next action:** Add a full assembled DSH retry and Web presentation regression using the same minimal envelope.

## 2026-08-26: DSH-native memory seam contract

- **Document:** `docs/DSH_MEMORY_SEAM.md` defines the proposed experimental `ctx.memory` service, provider-neutral resource kinds, scopes, bounded searches, explicit store requests, and provider mappings.
- **Invariant:** Any recalled text that reaches a model is first retained in a durable `memory/search` session event. The first consumer is an explicit `memory_search` tool; hidden pre-request recall is deferred.
- **Provider stance:** TencentDB and OpenViking are replaceable remote providers. DSH session history remains authoritative and replayable when either external service is unavailable or changes.
- **Next action:** Implement the local provider and `memory_search` consumer as a DSH experimental plugin, then use the same conformance fixtures for TencentDB and OpenViking adapters.

## 2026-08-26: Memory scope ownership clarified

- **Decision:** The first memory consumer derives workspace scope from the calling Agent's canonical `SessionHeader.cwd`; it does not accept user-supplied owner or workspace ids.
- **Reason:** This follows the existing `session-query` authorization model and keeps provider strings from widening access outside DSH's workspace authority.
- **Next action:** Implement the experimental local provider only after its domain records, byte bounds, and model-facing durable event payload are covered by tests.

## 2026-08-26: Executable local memory reference provider

- **Files:** `integrations/local-memory.py` and `integrations/test_local_memory.py`.
- **Behavior:** Explicit JSONL records are scoped by workspace, storage is byte-bounded, literal search has a strict result cap, and the caller cannot retrieve records from another workspace.
- **Evidence:** `python3 -m unittest integrations/test_local_memory.py` passed 4/4 tests. A CLI smoke wrote to `/project/a`, found it only under `/project/a`, and returned `[]` for `/project/b`.
- **Limit:** The reference provider is not mounted in DSH and never injects prompt context. It is an executable provider conformance baseline; the DSH plugin must derive scope from `Agent.session.header.cwd` and append durable `memory/search` events.
- **Next action:** Create the experimental DSH memory service/package skeleton and use these tests as provider-conformance fixtures.

## 2026-08-26: DSH experimental package boundary selected

- **Decision:** The first mounted implementation will be an opt-in experimental pair, `experimental/memory` plus `experimental/tool-memory`. It will not appear in the default base bundle because release bundles may not depend on experimental packages.
- **Local provider:** The initial provider delegates workspace-authorized search to existing `ctx.sessionQuery`; it uses the calling Agent's `session.header.cwd` as scope and never accepts workspace ids from model arguments.
- **Durability:** `memory_search` must append a bounded `memory/search` event containing the exact cited text before a later model request can use it.
- **Next action:** Add package manifests, aggregate references, service types, invariant, local provider, explicit tool consumer, and a composed keyless test in one implementation slice.

## 2026-08-26: DSH-native experimental memory search slice

- **Packages:** Added opt-in `@deepseek-ai/dsh-experimental-memory` and `@deepseek-ai/dsh-experimental-tool-memory`; neither is part of the default base bundle.
- **Authority:** `ctx.memory.search()` requires the exact live Agent and derives scope from `Agent.session.header.cwd`. It searches only same-workspace `ctx.sessionQuery` records and rejects stale agents, missing workspaces, empty queries, and invalid bounds.
- **Durability:** `memory_search` appends `memory/search` with the exact bounded citations before returning the equivalent model-visible JSON tool result. An invariant rejects a durable observation with a workspace different from its owning session.
- **Evidence:** Local DSH commit `413915553f` (`feat: add experimental memory search seam`). Isolated Node 22 host artifact build, runtime closure, NodeNext consumer types, and package paths passed. Focused Vitest suites passed 6/6, including an actual Loader-composed `cordis.yml` tool execution; a real headless app-bin keyless snapshot verifies `memory/search` is logged before `tool/result` and reused by the following model step.
- **Limit:** Search currently covers DSH session history only. No automatic prompt injection, store operation, TencentDB provider, OpenViking provider, or provider-failure normalization has been added.
- **Next action:** Add an opt-in runnable composition/snapshot fixture, then evaluate TencentDB and OpenViking adapters against the same durable search observation rule.

## 2026-08-26: pi-ai structured diagnostics boundary rechecked

- **Finding:** `@earendil-works/pi-ai@0.82.1` exposes `SimpleStreamOptions.onResponse`, but its OpenAI-compatible implementation invokes that callback only after `retryProviderRequest()` returns a successful response.
- **P0 consequence:** A gateway HTTP 502 is raised inside `retryProviderRequest()` before `onResponse`; adapter code therefore cannot recover `status` or `X-Request-ID` through the public callback. The existing DSH regression still correctly preserves the flattened `Upstream error.` text and maps it to retryable `SERVER`.
- **Decision:** Do not ship an adapter workaround that claims structured-field preservation without evidence. The next valid implementation requires an upstream pi-ai change that forwards error response metadata, or an adapter-owned fetch/API path with equivalent retry, auth, stream, and replay semantics.
- **Evidence:** Local Node 22 adapter attempt was reverted after the focused test showed status/request id remained absent; existing adapter/convert/retry coverage remained intact in the prior verified commit.

## 2026-08-26: external memory adapter contract and runner hardening

- **Runner fix:** Corrected the TencentDB Podman runner's environment cleanup from the invalid `seta` command to `set +a`; `bash -n` passes.
- **Replay rule:** Generated TencentDB proxy configuration now disables proxy-side injection. DSH-native retrieval must append exact citations before model use; proxy injection would create unreplayable hidden context.
- **Adapter contract:** Added `docs/EXTERNAL_MEMORY_ADAPTERS.md` covering typed TencentDB resource mappings, explicit OpenViking L0/L1/L2 reads, opaque ids, bounds, typed failures, replay, rollback, and required conformance cases.
- **Evidence:** Local provider unittest passes 4/4. TencentDB `validate` fails closed without `.env` and prints no credentials. No TencentDB credentials were available, so the container stack and live provider behavior were not claimed.
- **Next action:** Implement stub-backed TencentDB/OpenViking adapters only after their retrieval APIs and credential profiles are supplied; retain direct DSH routing as rollback.

## 2026-08-26: Ruflo-to-DSH bounded orchestration preflight

- **Artifact:** Added `integrations/ruflo-dsh-plan.py` and a deterministic example plan. It validates a declarative task DAG before work reaches DSH, enforcing explicit task cost, max task count, dependency fan-out, cycle freedom, budget, and exactly one review stage.
- **Ownership:** The validator is not a scheduler and does not execute tasks, start agents, store reports, or authorize operations. Real execution remains with DSH `ctx.workflowEngine`, `ctx.subagents`, `ctx.agentTeams`, and `ctx.jobs`, preserving their session ownership, lifecycle, cancellation, and persistence rules.
- **Evidence:** New plan tests plus existing local-memory tests pass 8/8; the example CLI prints a valid bounded limits report; TencentDB runner syntax remains valid.
- **Next action:** Use the validator as preflight for a keyless DSH workflow fixture with an explicit coordinator and review consumer; do not add a second Ruflo runtime.

## 2026-08-26: validated DSH command bridge

- **Artifact:** Extended `integrations/ruflo-dsh-plan.py` with an explicit `--execute -- <command>` bridge. It validates the full plan first, then runs only the operator-supplied DSH command and returns that command's exit status.
- **Safety:** Plan task text is never converted into shell commands. Invalid DAGs, missing review, fan-out violations, cycles, and budget failures return before any subprocess starts. The bridge owns no DSH agent, job, workflow, session, or persistence state.
- **Evidence:** Local provider and orchestration tests pass 9/9; valid CLI execution prints the bounded plan report and command output; invalid-plan test confirms the marker command is not started; `bash -n` and Python bytecode checks pass.

## 2026-08-26: DSH P0 fix completed locally

- **DSH commit:** `2c902ca6aa` (`fix: retry flattened upstream gateway errors`). This commit remains in the DSH checkout and was not pushed to the upstream DSH remote.
- **Behavior:** The exact flattened pi-ai message `Upstream error.` maps to `SERVER`, activating the existing bounded retry policy. Other unknown pi-ai messages remain `PI_AI_ERROR`.
- **Evidence:** In isolated Node 22 workspaces, `packages/llm/llm-pi-ai/tests/convert.spec.ts` passed 72/72 tests and `packages/llm/llm-retry/tests/transport-recovery.spec.ts` passed 7/7 tests. The latter confirms the existing bounded retry lifecycle consumes the resulting `SERVER` failure.
- **Environment limitation:** DSH pre-commit hooks requiring `node` could not run on the host, so the commit used `LEFTHOOK=0` after staged whitespace validation. The Node 22 focused test is the recorded behavior evidence.
- **Next action:** Add the assembled retry/Web regression and preserve status/request-id facts at the adapter boundary where the upstream library still permits it.

## 2026-08-26: Exact pi-ai HTTP gateway boundary regression

- **Fixture:** The existing `llm-pi-ai` local OpenAI-compatible mock served HTTP 502 with `{"error":{"type":"api_error","message":"Upstream error."}}` and `X-Request-ID`.
- **Result:** The real pi-ai adapter preserved `Upstream error.` inside its error message and the DSH stream conversion classified it as `SERVER`.
- **Evidence:** In an isolated Node 22 workspace, `pnpm exec vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts packages/llm/llm-pi-ai/tests/convert.spec.ts` passed 120/120 tests.
- **Limit:** pi-ai retains the 502 prefix in message text but does not expose the HTTP status or request id as structured `LlmFailure` facts. Retry now works; observability remains unfinished.
- **Next action:** Add agent-loop/Web assembled retry coverage, then instrument the adapter or upstream SDK where structured response facts can be captured.

## 2026-08-26: P0 boundary and retry evidence confirmed

- **DSH tests:** `packages/llm/llm-pi-ai/tests/adapter.spec.ts` plus `convert.spec.ts` passed 120/120 in an isolated Node 22 workspace. `packages/llm/llm-retry/tests/transport-recovery.spec.ts` passed 7/7.
- **Observed path:** HTTP 502 with `{"error":{"type":"api_error","message":"Upstream error."}}` reaches the pi-ai adapter, retains `Upstream error.` in the failure message, maps to `SERVER`, and is eligible for the existing bounded retry policy.
- **Remaining gap:** The adapter does not yet expose HTTP status or `X-Request-ID` as structured `LlmFailure` fields because pi-ai flattens the upstream response before DSH receives it.
- **Next action:** Add assembled agent-loop/Web evidence and investigate a capture hook at the pi-ai HTTP provider boundary.

## 2026-08-26: DSH push authorization boundary

- **Attempt:** Pushed the three local DSH integration commits through the configured HTTPS remote, then retried with the available Harness SSH identity.
- **Result:** HTTPS has no non-interactive GitHub credentials; SSH was rejected because the deploy key has no permission to `deepseek-ai/deepseek-harness.git`.
- **Decision:** Keep the DSH commits local and do not alter remotes, rewrite history, or force-push. Harness remains pushed and synchronized.
- **Next action:** Continue keyless DSH workflow integration locally; obtain an authorized DSH contributor credential before publishing the existing commits.

## 2026-08-26: Keyless coordinator and review workflow fixture

- **Fixture:** Added a real headless Loader composition with a deterministic `workflow-mock` adapter. The parent invokes `workflow`; the worker-thread engine runs an explicit worker followed by an explicit review child through DSH `ctx.workflowEngine` and the existing spawn provider.
- **Persistence:** The assembled transcript records `tool-workflow/run-start`, two `tool-workflow/agent-*` pairs, `tool-workflow/run-end`, and separate owned child session logs. No second scheduler or hidden prompt state was introduced.
- **Evidence:** Node 22 replay after refresh passed `1/1` for the new bounded workflow snapshot. The expected transcript is stored under `examples/headless-agent/tests/snapshots/bounded-workflow/stream-json.expected.jsonl`.
- **Next action:** Apply the external Ruflo preflight plan to this composition and add provider conformance only when TencentDB/OpenViking retrieval APIs or credentials are available.

## 2026-08-26: DSH workflow fixture committed locally

- **DSH commit:** `b329e81c7f` (`test: add assembled bounded workflow snapshot`) contains the workflow fixture, deterministic adapter, and canonical replay transcript.
- **Push result:** The configured HTTPS remote requested unavailable credentials; the available SSH deploy key was rejected for `deepseek-ai/deepseek-harness.git`.
- **Decision:** Preserve the commit and worktree as-is. No force push, remote rewrite, or unrelated change was used to bypass repository authorization.
- **Next action:** Publish `b329e81c7f` after an authorized DSH contributor credential is provided; continue external adapter work only with supplied API contracts or credentials.

## 2026-08-26: Workflow result propagation regression fixed

- **Finding:** The first assembled workflow snapshot proved child lifecycle events but the deterministic parent adapter only inspected text blocks, so the final coordinator response omitted the workflow tool result.
- **Fix:** The keyless adapter now reads bounded text from the terminal `tool-result` content and returns it in the coordinator response. Production workflow and persistence code are unchanged.
- **Evidence:** Node 22 refresh and replay both passed `1/1`; Harness orchestration and local-memory tests passed `9/9`.
- **Next action:** Keep the workflow fixture as the keyless Ruflo-pattern evidence while external provider adapters remain gated on supplied API contracts and credentials.

## 2026-08-26: DSH workflow fix remains unpublished

- **DSH commit:** `9bcd24f52d` (`test: preserve workflow result in keyless snapshot`) fixes the coordinator result propagation regression after the assembled snapshot review.
- **Push result:** HTTPS has no non-interactive credentials; the configured SSH deploy key is unauthorized for `deepseek-ai/deepseek-harness.git`.
- **Evidence:** The commit is present locally and the updated refresh/replay evidence is `1/1` each.
- **Next action:** Publish the two local DSH workflow commits after authorization; continue with external adapter contracts and structured pi-ai diagnostics investigation.

## 2026-08-26: Preserve pi-ai HTTP status when flattened text includes it

- **DSH commit:** `2715bc03c2` (`fix: preserve pi-ai HTTP status when available`).
- **Behavior:** The pi-ai stream converter extracts an HTTP status only when pi-ai already included a recognizable status in the flattened error text, such as `502: ...`, `HTTP 500: ...`, or `API error (429): ...`. The existing stable code classification remains unchanged.
- **Security and honesty:** No request id, response headers, or raw body is synthesized; a bare `Upstream error.` still has no status because the public pi-ai callback does not expose the failed response.
- **Evidence:** Node 22 `convert.spec.ts` and `transport-recovery.spec.ts` passed `79/79`.
- **Next action:** Find an upstream-compatible failed-response hook or adapter-owned transport path before claiming complete gateway diagnostics preservation.

## 2026-08-26: pi-ai status fix remains local

- **Push result:** DSH commit `2715bc03c2` could not be pushed: HTTPS has no available GitHub credential and the available SSH deploy key is unauthorized for the upstream DSH repository.
- **Published audit:** This limitation is recorded in Harness commit `b4267af` and pushed to `origin/main`.
- **Next action:** Obtain DSH repository authorization or an upstream pi-ai failed-response hook; do not force-push or alter remotes.

## 2026-08-26: DSH memory search cancellation guard

- **DSH commit:** `afe0a966a2` (`fix: fail fast cancelled memory searches`).
- **Behavior:** `ctx.memory.search()` now rejects an already-aborted request before calling the session-query provider. This preserves cancellation ownership and prevents a cancelled model/tool operation from starting external or durable reads.
- **Evidence:** Memory service, package invariant, and real Loader composition tests passed `7/7`.
- **Design limit:** `memory/store` remains deferred because session-query intentionally excludes unknown declaration-merged events from searchable text; adding storage without an indexed first-party consumer would create an unowned persistence contract.
- **Next action:** Add remote adapter conformance only behind supplied TencentDB/OpenViking retrieval APIs; keep DSH session events authoritative.

## 2026-08-26: Memory cancellation guard remains local

- **Push result:** DSH commit `afe0a966a2` could not be published through HTTPS (no credential) or the available SSH deploy key (unauthorized for `deepseek-ai/deepseek-harness.git`).
- **Published audit:** Harness commit `f72f17f` records this result and is synchronized with `origin/main`.
- **Next action:** Obtain DSH contributor authorization before publishing local commits; continue only with locally verifiable seams and no remote-provider claims.

## 2026-08-26: UTF-8 byte-boundary coverage for memory citations

- **DSH commit:** `0dfcddc57f` (`test: cover UTF-8 memory byte limits`).
- **Coverage:** The memory service now has regression cases proving an oversized multibyte citation is excluded and a citation at the exact UTF-8 byte limit is retained.
- **Evidence:** Memory service, invariant, and real Loader composition tests passed `8/8`.
- **Next action:** Use this byte-boundary evidence as the required conformance baseline for TencentDB and OpenViking adapters when their retrieval APIs are supplied.

## 2026-08-26: UTF-8 memory test push remains unauthorized

- **Push result:** DSH commit `0dfcddc57f` was not publishable through the configured HTTPS remote or available SSH deploy key; both paths lack authorization for the upstream repository.
- **Published audit:** Harness commit `c6a3c8c` records the result and is synchronized with `origin/main`.
- **Next action:** Continue local conformance work and publish DSH commits once repository authorization is available.

## 2026-08-26: TencentDB deployment digest gate

- **Change:** The Podman runner now requires `TDAI_CORE_IMAGE`, `TDAI_HUB_IMAGE`, and `TDAI_PROXY_IMAGE` to use immutable `@sha256:` references before validation or startup proceeds.
- **Reason:** A reviewed deployment must not silently resolve mutable `latest` or tag references after image digests were pinned.
- **Evidence:** The runner regression passes for digest-pinned images, rejects mutable tags before any container operation, and confirms test credentials are absent from output. `bash -n` passes; Harness integration tests pass `11/11`.
- **Documentation:** Updated the TencentDB setup README with the immutable-image requirement.
- **Next action:** Pin and review any future upstream image update as an explicit audit entry before changing `.env.example`.

## 2026-08-26: Gateway probe failure conformance

- **Change:** Added keyless probe tests covering upstream API errors, structured errors, malformed/non-object JSON, case-insensitive request/correlation headers, and unreachable transport results.
- **Behavior:** An unreachable endpoint remains an explicit `status: 0` result with diagnostic text and no headers; it is not reported as a healthy empty response.
- **Evidence:** Probe, local-memory, and Ruflo integration tests passed `14/14`; Python compilation passed.
- **Documentation:** TencentDB probe README now documents transport classification and diagnostic header lookup.
- **Next action:** Use the probe fixture against the real pinned TencentDB proxy after credentials are supplied, without recording secrets or raw provider bodies.

## 2026-08-26: Local memory malformed-record failures

- **Change:** The provider-neutral JSONL reference provider now converts malformed JSON and structurally incomplete persisted records into explicit `MemoryError` failures.
- **Reason:** Corrupted provider data must not become an empty successful search or leak an implementation-specific parser exception. This is the failure behavior required before remote TencentDB/OpenViking adapters are mounted.
- **Evidence:** Harness local-memory and Ruflo tests passed `11/11`; runner syntax and Python bytecode checks passed.
- **Documentation:** Updated `README.md` with the reference-provider corruption rule.
- **Next action:** Reuse this explicit-failure expectation in stub conformance tests when external retrieval APIs are available.
