/**
 * Explicit, workspace-authorized memory retrieval over durable DSH session history.
 * @module @deepseek-ai/dsh-experimental-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { MemoryId, MemoryProvider, MemoryProviderSearchRequest, MemorySearchRequest, MemorySearchResult } from './types.ts'

function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

export type * from './types.ts'
export { normalizeOpenVikingRecords, normalizeTencentDbRecords, remoteFailure } from './remote-contract.ts'
export type { OpenVikingDepth, OpenVikingRecord, RemoteMemoryCitation, RemoteMemoryProvider, RemoteMemorySearchRequest, TencentDbRecord } from './remote-contract.ts'

/** Maximum citations one request can return. */
export const MAX_MEMORY_HITS = 20
/** Maximum bytes the local provider may return in one request. */
export const MAX_MEMORY_CONTENT_BYTES = 32_768

/** Provider backed by DSH's existing workspace-authorized session-query corpus. */
class LocalSessionMemoryProvider implements MemoryProvider {
  readonly id = 'local-session-query'

  constructor(private readonly query: Pick<SessionQueryEngine, 'filterSessions' | 'filterEvents'>) {}

  async search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    const records = await this.query.filterSessions([{ kind: 'cwd', values: [request.workspace] }], request.signal)
    const hits: MemorySearchResult['hits'][number][] = []
    let remaining = request.maxContentBytes
    for (const record of records) {
      if (request.signal.aborted) throw request.signal.reason
      const documents = await this.query.filterEvents(record.header.id, [{ kind: 'text', text: request.query }])
      for (const document of documents) {
        const content = document.text.trim()
        if (content.length === 0) continue
        const bytes = Buffer.byteLength(content, 'utf8')
        if (bytes > remaining) continue
        hits.push({ id: MemoryId(`local:${document.sessionId}:${document.seq}`), sessionId: document.sessionId, seq: document.seq, eventType: document.type, content })
        remaining -= bytes
        if (hits.length === request.limit || remaining === 0) return hits
      }
    }
    return hits
  }
}

/** Memory retrieval configuration. */
export interface Config {
  /** Default maximum citations returned to an explicit consumer. */
  readonly defaultLimit?: number
  /** Default aggregate UTF-8 citation cap. */
  readonly defaultMaxContentBytes?: number
}

/** Loader configuration for the experimental local provider. */
export const Config: z<Config> = z.object({
  defaultLimit: z.number().step(1).min(1).max(MAX_MEMORY_HITS).default(5),
  defaultMaxContentBytes: z.number().step(1).min(1).max(MAX_MEMORY_CONTENT_BYTES).default(8_192),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/** Explicit local-memory service over the existing session-query corpus. */
export default class MemoryService extends Service {
  static inject = ['agents', 'sessionQuery']

  private readonly config: Required<Config>
  private readonly provider: MemoryProvider

  /** @param ctx - owning Cordis context. @param config - retrieval caps. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this.config = {
      defaultLimit: config.defaultLimit ?? 5,
      defaultMaxContentBytes: config.defaultMaxContentBytes ?? 8_192,
    }
    this.provider = new LocalSessionMemoryProvider(ctx.sessionQuery)
  }

  /**
   * Search same-workspace session history for bounded model-facing citations.
   * @param agent - exact live caller whose session supplies the workspace scope.
   * @param request - query, bounds, and cancellation.
   * @returns detached citations that a consumer must log before model use.
   */
  async search(agent: Agent, request: MemorySearchRequest): Promise<MemorySearchResult> {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new HarnessError('memory search requires an exact live Agent', 'MEMORY_STALE_AGENT')
    }
    const workspace = agent.session.header.cwd
    if (workspace === undefined) {
      throw new HarnessError('memory search is unavailable because the caller session has no workspace', 'MEMORY_UNAUTHORIZED')
    }
    const query = request.query.trim()
    if (query.length === 0) throw new HarnessError('memory search query must not be empty', 'MEMORY_INVALID_REQUEST')
    const limit = request.limit ?? this.config.defaultLimit
    const maxContentBytes = request.maxContentBytes ?? this.config.defaultMaxContentBytes
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEMORY_HITS) {
      throw new HarnessError(`memory search limit must be an integer from 1 through ${MAX_MEMORY_HITS}`, 'MEMORY_INVALID_REQUEST')
    }
    if (!Number.isSafeInteger(maxContentBytes) || maxContentBytes < 1 || maxContentBytes > MAX_MEMORY_CONTENT_BYTES) {
      throw new HarnessError(`memory search maxContentBytes must be an integer from 1 through ${MAX_MEMORY_CONTENT_BYTES}`, 'MEMORY_INVALID_REQUEST')
    }
    if (request.signal.aborted) throw request.signal.reason

    const hits = await this.provider.search({ workspace, query, limit, maxContentBytes, signal: request.signal })
    return { provider: this.provider.id, workspace, hits }
  }
}
