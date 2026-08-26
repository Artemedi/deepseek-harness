# DSH Memory Seam

## Purpose

`ctx.memory` is an experimental DSH capability for recalling and committing reusable knowledge without replacing the append-only session log. It gives TencentDB Agent Memory and OpenViking one provider interface while preserving replay, authorization, and bounded model context.

## Service Definition

```ts
interface MemoryScope {
  /** Canonical caller Session cwd; the first local authorization boundary. */
  readonly workspace: string
  /** Optional provider-specific extensions derived by trusted DSH services. */
  readonly teamId?: string
  readonly agentId?: string
  readonly taskId?: string
}

type MemoryKind = 'memory' | 'skill' | 'wiki' | 'code-graph' | 'resource'

type MemoryId = Branded<'MemoryId'>

type MemoryProvider = 'local' | 'tencentdb' | 'openviking'

interface MemorySearchRequest {
  readonly query: string
  readonly scope: MemoryScope
  readonly kinds?: readonly MemoryKind[]
  readonly limit: number
  readonly maxContentBytes: number
  readonly signal: AbortSignal
}

interface MemoryHit {
  readonly id: MemoryId
  readonly provider: MemoryProvider
  readonly kind: MemoryKind
  readonly title: string
  readonly content: string
  readonly source: string
  readonly score?: number
}

interface MemorySearchResult {
  readonly hits: readonly MemoryHit[]
  readonly provider: MemoryProvider
  readonly observedAt: number
}

interface MemoryStoreRequest {
  readonly scope: MemoryScope
  readonly kind: MemoryKind
  readonly title: string
  readonly content: string
  readonly source: string
  readonly signal: AbortSignal
}

interface MemoryService {
  search(request: MemorySearchRequest): Promise<MemorySearchResult>
  store(request: MemoryStoreRequest): Promise<MemoryId>
}
```

The implementation validates `limit` and byte caps before provider dispatch. Providers reject unavailable, unauthorized, or malformed requests; they never return a synthetic empty result that looks like a completed search.

## Durable DSH Events

A provider response must not become hidden prompt state. The consumer records a bounded search observation before adding its content to any later model request:

```ts
'memory/search': {
  version: 1
  provider: MemoryProvider
  scope: MemoryScope
  query: string
  hits: Array<{
    id: MemoryId
    kind: MemoryKind
    title: string
    source: string
    content: string
  }>
}

'memory/store': {
  version: 1
  provider: MemoryProvider
  scope: MemoryScope
  id: MemoryId
  kind: MemoryKind
  title: string
  source: string
}
```

`memory/search` contains the exact bounded text shown to the model, not only ids or scores. This keeps a resumed or forked session reproducible even when the external backend later changes or becomes unavailable.

## Consumer Rules

The first consumer is an explicit model-facing `memory_search` tool. It records a `memory/search` event and returns cited results as its tool result. No pre-request hidden recall runs in the first release.

A later automatic injection plugin may use a prior durable `memory/search` event as its source. It must not query a provider during prompt assembly without first recording the resulting observation.

`memory_store` is explicit and opt-in. Automatic extraction from conversation is provider-derived asynchronous state and does not alter the DSH session log or claim to be a source of truth.

## Provider Mapping

| Provider | Mapping |
|---|---|
| Local | Current workspace-scoped DSH session-query and domain storage; useful for early test coverage. |
| TencentDB | Chat Memory, Skill, Wiki, and CodeGraph map to typed kinds. Team, agent, and task map to explicit scope fields. |
| OpenViking | `viking://` entries map to opaque `MemoryId` values. L0, L1, and L2 are explicit retrieval-depth operations, not hidden prompt expansion. |

## Authorization

The first consumer derives `workspace` from the calling Agent's canonical `SessionHeader.cwd` and rejects a caller without a workspace. It never accepts a user-supplied workspace or owner id as authorization. A provider may further constrain individual resource ACLs, but it cannot widen a DSH caller from one workspace/team/agent/task scope to another. Workspace path canonicalization and session owner identity are owned by DSH, not provider-supplied strings.

## Verification

- Unit tests cover request bounds, scope propagation, provider failures, and durable event shape.
- A runnable keyless transcript proves that `memory_search` records the exact model-visible cited text.
- Provider conformance tests run against local stubs for TencentDB and OpenViking.
- An assembled Web test shows recalled citations and provider errors without exposing credentials.
