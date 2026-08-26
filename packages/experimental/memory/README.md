# Experimental Memory Service

`@deepseek-ai/dsh-experimental-memory` provides explicit, workspace-authorized retrieval over the DSH session-query corpus.

The service accepts an exact live `Agent`, derives the workspace from `agent.session.header.cwd`, validates request bounds, and delegates retrieval to a provider-neutral search interface. The shipped provider reads bounded citations from same-workspace session events. It does not store provider state, inject prompt content, or replace session persistence. The `memory/search` event records the exact citations before a consumer gives them to a later model request.

## Model Experience

### Service output

#### What the model sees

The service itself registers no model-facing schema or prompt text; `memory_search` owns the explicit presentation of its bounded citations.

#### Token effect

No tokens are added by this service unless a composed consumer presents a returned citation.

#### KV Cache effect

The service does not add model context unless a consumer explicitly records and presents its result.

## Known Limitations and Deferred Work

- **Session-history provider only** — TencentDB Agent Memory, OpenViking retrieval depths, memory storage, and automatic extraction require separate providers and consumers.
- **External API references only** — TencentDB MemoryCore documentation ([README](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryCore/README.md)) and OpenViking retrieval/context-layer documentation ([retrieval](https://docs.openviking.ai/en/concepts/07-retrieval), [L0/L1/L2](https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/03-context-layers.md)) are read-only design inputs. They are not runtime dependencies, and this package makes no network call or provider credential request.
- **Stub adapter contract** — `src/remote-contract.ts` contains pure response normalizers for workspace-filtered TencentDB records and explicit OpenViking `L0`/`L1`/`L2` records. It is not mounted by `MemoryService` until a durable event schema and provider failure transport are implemented.
