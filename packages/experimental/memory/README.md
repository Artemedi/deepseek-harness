---
description: "Configure workspace-authorized session memory, TencentDB capture and recall, OpenViking retrieval, or a managed local MemoryCore Gateway."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-memory

English | [中文](README.zh.md)

## Summary

Use `dsh-experimental-memory` when an agent needs bounded citations from same-workspace session history or an explicitly configured remote memory provider. The default local route reads the existing session-query corpus without injecting prompt content. Optional TencentDB routes add durable automatic capture and pre-step recall; OpenViking adds explicit layered retrieval. Every remote route is opt-in, and the package preserves workspace and agent-preset isolation before network access.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service in a base-backed composition, then add `dsh-experimental-tool-memory` only when the model should initiate explicit searches.

### When to choose it

Choose this package for workspace-scoped retrieval, explicit remote-memory isolation, or TencentDB capture and recall that must remain visible in the durable Session log. Keep the existing session-query stack alone when callers need only ordinary transcript search; this package does not replace Session persistence or provider-side storage.

### Minimal configuration

The default route requires the base session, projection, agent, and query services already present in shipped profiles:

```yaml
- id: experimental-memory
  name: '@deepseek-ai/dsh-experimental-memory'
```

| Field | Default | Meaning |
|---|---|---|
| `providers` | `['local']` | Enabled routes; `local` is always required |
| `tencentdb` | absent | TencentDB Gateway endpoint, credential, service, and isolation bindings |
| `tencentdbRuntime` | absent | Operator-installed local MemoryCore process owned by DSH |
| `openviking` | absent | OpenViking endpoint, credential, and optional target URI |
| `automaticCapture` | `false` | Export completed and max-token turns to TencentDB |
| `automaticRecall` | `false` | Recall TencentDB context before the first step |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-memory) is the exhaustive source for every accepted field and default.

### Provider and durability boundaries

The local provider accepts an exact live `Agent`, derives authority from `agent.session.header.cwd`, and returns bounded same-workspace event citations. Empty, duplicate, unknown, or missing-`local` provider sets fail at composition time. A consumer must append the exact result as `memory/search` before presenting citations to a later model request.

TencentDB requires a bare HTTP(S) origin, a memory-instance service id, and non-empty bindings from absolute DSH workspace plus optional effective agent preset to provisioned Team, Agent, and User ids. Numeric loopback may use the non-secret local bearer marker; hostname aliases and non-loopback gateways require a resolved DSH credential. L1 atomic memory, L2 scenario profiles, and the singleton L3 core profile become bounded citations under one deadline and byte budget.

With `automaticCapture`, idle-agent maintenance projects uncaptured completed turns from durable events, flushes `memory/capture-requested`, calls `/v3/conversation/add`, and records success or a closed diagnostic code. Delivery is at least once. With `automaticRecall`, the first step searches configured L1-L3 depths under one aggregate budget, logs the exact combined result, and prepends a separate message labelled as stale, non-instructional reference context; a failed layer does not discard successful layers or block the turn.

`tencentdbRuntime` owns an operator-installed, commit-pinned standalone MemoryCore process through the DSH subprocess seam. It forwards an existing LLM credential, requires an exact healthy response before activation, rejects occupied or non-loopback endpoints, retains state under `dataDir`, and terminates the process tree on unload. Application startup never clones, installs, or pulls mutable upstream code.

OpenViking calls the confirmed `/api/v1/search/find` route and maps memory, resource, and skill records at explicit L0-L2 depth. Response streaming, deadlines, cancellation, redirect refusal, and output bounds remain enforced. Without an `openviking` object, the explicitly enabled route is a deterministic local contract-test stub.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`MemoryService` resolves caller authority and provider routing. A registered Session projection folds direct user and assistant messages into completed turns and removes a turn only after `memory/capture-succeeded`, so restart recovery does not depend on synchronous log scans. Provider adapters own wire validation and normalize external records into bounded opaque citations; the managed-runtime adapter owns only process lifecycle.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, configuration, local route, capture projection, and automatic recall/capture orchestration |
| [`src/tencentdb-http.ts`](src/tencentdb-http.ts) | TencentDB isolation, L1-L3 retrieval, and conversation capture |
| [`src/tencentdb-runtime.ts`](src/tencentdb-runtime.ts) | Managed local Gateway lifecycle and readiness |
| [`src/openviking-http.ts`](src/openviking-http.ts) | OpenViking request and response boundary |
| [`src/remote-contract.ts`](src/remote-contract.ts) | Shared remote citation normalization and safe failures |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant checks for durable memory events |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session-query subsystem](../../../docs/subsystems/session-query.md) — the local retrieval corpus and filtering boundary.
- [TencentDB integration guide](../../../docs/user/guide/tencentdb-memory.md) — deployment and managed-runtime configuration.
- [TencentDB integration contract](../../../integrations/tencentdb-agent-memory/README.md) — pinned upstream surface and verification.
- [Memory tool](../tool-memory/README.md) — explicit model-facing search and durable result recording.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-memory) — complete loader configuration.

-----

<a id="model-experience"></a>
## Model Experience

### Service output

#### What the model sees

The service itself registers no model-facing schema. Automatic recall contributes a separate untrusted reference message; `memory_search` owns explicit presentation of bounded citations.

#### Token effect

The local and capture paths add no request tokens. Automatic recall adds bounded citation text, and a composed tool consumer adds its schema and result.

#### KV Cache effect

The service does not rewrite earlier context. Automatic recall and explicit results append after the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints define where deployments need extra isolation or delivery handling.

- **Capture is at least once** — a crash after remote acceptance but before the local success event can resend a turn because the pinned upstream route accepts no idempotency key or client message id.
- **Remote routes are opt-in** — the default DSH and Web compositions make no TencentDB or OpenViking request.
- **OpenViking scope is deployment-owned** — a trusted `targetUri` must provide isolation when provider-side multi-tenancy matters.
- **Managed mode needs an installed upstream checkout** — the current upstream package does not publish a standalone Gateway executable.
- **Remote citations are opaque** — they omit DSH session ids and event sequences and retain only provider identity, source metadata, and bounded content.
- **Binding migration is manual** — changing a workspace or agent preset does not move or merge an existing provider-side profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
