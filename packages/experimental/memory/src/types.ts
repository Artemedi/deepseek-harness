/** Public types for explicit experimental memory retrieval. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Identifies one replayable citation derived from a session event. */
export type MemoryId = Branded<'MemoryId'>

/** Explicit provider memory layer. */
export type MemoryDepth = 'L0' | 'L1' | 'L2' | 'L3'

/** Closed, non-sensitive failure vocabulary permitted in durable memory diagnostics. */
export type MemoryDiagnosticCode =
  | 'MEMORY_INVALID_REQUEST'
  | 'MEMORY_STALE_AGENT'
  | 'MEMORY_UNAUTHORIZED'
  | 'MEMORY_RETRYABLE'
  | 'MEMORY_PROVIDER_UNAVAILABLE'
  | 'MEMORY_PROVIDER_ERROR'

/** One model-visible citation returned by the local session-history provider. */
export interface MemoryHit {
  /** Stable local identity formed from the source session and event sequence. */
  readonly id: MemoryId
  /** Source session that owns the cited event. */
  readonly sessionId?: SessionId
  /** Source event sequence in that session. */
  readonly seq?: number
  /** First-party event type that supplied the cited text. */
  readonly eventType?: string
  /** Provider resource kind, when the source is remote. */
  readonly kind?: 'memory' | 'skill' | 'wiki' | 'code-graph' | 'resource'
  /** Human-readable provider title, when available. */
  readonly title?: string
  /** Opaque provider source, when available. */
  readonly source?: string
  /** Bounded text that may be shown to the model. */
  readonly content: string
}

/** Search input independent of a tool schema. */
export interface MemorySearchRequest {
  /** Literal query against first-party session event text. */
  readonly query: string
  /** Maximum number of citations returned. */
  readonly limit?: number
  /** Maximum UTF-8 bytes across every returned citation. */
  readonly maxContentBytes?: number
  /** Explicit provider route; local is the default. */
  readonly provider?: 'local' | 'tencentdb' | 'openviking'
  /** Provider layer: OpenViking requires L0-L2; TencentDB defaults to L1 and accepts L1-L3. */
  readonly depth?: MemoryDepth
  /** Cancellation for corpus reads. */
  readonly signal: AbortSignal
}

/** Provider request after DSH has derived and authorized the workspace scope. */
export interface MemoryProviderSearchRequest {
  /** Canonical workspace derived from the live Agent session. */
  readonly workspace: string
  /** Effective durable agent-preset identity, absent when the session uses no preset. */
  readonly agentPreset?: string
  /** Literal query selected by the explicit consumer. */
  readonly query: string
  /** Validated result count bound. */
  readonly limit: number
  /** Validated aggregate UTF-8 byte bound. */
  readonly maxContentBytes: number
  /** Explicit provider retrieval layer. */
  readonly depth?: MemoryDepth
  /** Cancellation owned by the calling operation. */
  readonly signal: AbortSignal
}

/** One completed conversation message accepted by a durable memory provider. */
export interface MemoryCaptureMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Capture input independent of provider-specific tenancy and wire fields. */
export interface MemoryCaptureRequest {
  readonly messages: readonly MemoryCaptureMessage[]
  readonly provider?: 'tencentdb'
  readonly signal: AbortSignal
}

/** Capture request after DSH derives the owning session and workspace. */
export interface MemoryProviderCaptureRequest extends MemoryCaptureRequest {
  readonly sessionId: SessionId
  readonly workspace: string
  /** Effective durable agent-preset identity, absent when the session uses no preset. */
  readonly agentPreset?: string
}

/** Provider-neutral retrieval implementation used behind `ctx.memory`. */
export interface MemoryProvider {
  /** Stable provider id recorded in the durable search observation. */
  readonly id: string
  /** Retrieve bounded citations without changing DSH authorization or persistence. */
  search(request: MemoryProviderSearchRequest): Promise<readonly MemoryHit[]>
  /** Persist a completed conversation slice when the provider supports capture. */
  capture?(request: MemoryProviderCaptureRequest): Promise<void>
}

/** Immutable execution plan produced after request validation and provider selection. */
export interface ResolvedMemorySearchSpec {
  readonly provider: MemoryProvider
  readonly workspace: string
  readonly query: string
  readonly limit: number
  readonly maxContentBytes: number
  readonly depth?: MemoryDepth
  readonly signal: AbortSignal
}

/** Detached result of one explicit memory search. */
/** Durable exact observation appended before citations reach a later model request. */
export interface MemorySearchEvent {
  readonly version: 1
  readonly provider: string
  readonly workspace: string
  readonly query: string
  readonly hits: readonly MemoryHit[]
}

/** Durable intent to export one completed turn to remote memory. */
export interface MemoryCaptureRequestedEvent {
  readonly version: 1
  readonly provider: 'tencentdb'
  readonly turn: number
  readonly messageCount: number
}

/** Durable completion of one remote-memory turn export. */
export interface MemoryCaptureSucceededEvent {
  readonly version: 1
  readonly provider: 'tencentdb'
  readonly turn: number
}

/** Durable safe failure of one remote-memory turn export. */
export interface MemoryCaptureFailedEvent extends MemoryCaptureSucceededEvent {
  readonly code: MemoryDiagnosticCode
}

/** Durable failure of automatic recall that did not block the model turn. */
export interface MemoryRecallFailedEvent {
  readonly version: 1
  readonly provider: 'tencentdb'
  readonly code: MemoryDiagnosticCode
  readonly depth?: 'L1' | 'L2' | 'L3'
}

/** Merge-extensible durable memory event map. */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact bounded citations returned by one explicit memory search. */
    'memory/search': MemorySearchEvent
    /** Intent durably flushed before exporting one completed turn to TencentDB. */
    'memory/capture-requested': MemoryCaptureRequestedEvent
    /** Confirmation that TencentDB accepted every message from one exported turn. */
    'memory/capture-succeeded': MemoryCaptureSucceededEvent
    /** Safe failure class recorded after one requested TencentDB turn export fails. */
    'memory/capture-failed': MemoryCaptureFailedEvent
    /** Safe per-layer recall failure that does not block the owning model turn. */
    'memory/recall-failed': MemoryRecallFailedEvent
  }
}

/** Durable provider-neutral result returned by one authorized memory search. */
export interface MemorySearchResult {
  /** Provider identifier recorded with the durable observation. */
  readonly provider: string
  /** Canonical workspace scope derived from the caller session. */
  readonly workspace: string
  /** Exact bounded text citations the consumer may expose to the model. */
  readonly hits: readonly MemoryHit[]
}
