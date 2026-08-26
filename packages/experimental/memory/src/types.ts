/** Public types for explicit experimental memory retrieval. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Identifies one replayable citation derived from a session event. */
export type MemoryId = Branded<'MemoryId'>

/** One model-visible citation returned by the local session-history provider. */
export interface MemoryHit {
  /** Stable local identity formed from the source session and event sequence. */
  readonly id: MemoryId
  /** Source session that owns the cited event. */
  readonly sessionId: SessionId
  /** Source event sequence in that session. */
  readonly seq: number
  /** First-party event type that supplied the cited text. */
  readonly eventType: string
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
  /** Cancellation for corpus reads. */
  readonly signal: AbortSignal
}

/** Provider request after DSH has derived and authorized the workspace scope. */
export interface MemoryProviderSearchRequest {
  /** Canonical workspace derived from the live Agent session. */
  readonly workspace: string
  /** Literal query selected by the explicit consumer. */
  readonly query: string
  /** Validated result count bound. */
  readonly limit: number
  /** Validated aggregate UTF-8 byte bound. */
  readonly maxContentBytes: number
  /** Cancellation owned by the calling operation. */
  readonly signal: AbortSignal
}

/** Provider-neutral retrieval implementation used behind `ctx.memory`. */
export interface MemoryProvider {
  /** Stable provider id recorded in the durable search observation. */
  readonly id: string
  /** Retrieve bounded citations without changing DSH authorization or persistence. */
  search(request: MemoryProviderSearchRequest): Promise<readonly MemoryHit[]>
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

/** Merge-extensible durable memory event map. */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact bounded citations returned by one explicit memory search. */
    'memory/search': MemorySearchEvent
  }
}

export interface MemorySearchResult {
  /** Provider identifier recorded with the durable observation. */
  readonly provider: string
  /** Canonical workspace scope derived from the caller session. */
  readonly workspace: string
  /** Exact bounded text citations the consumer may expose to the model. */
  readonly hits: readonly MemoryHit[]
}
