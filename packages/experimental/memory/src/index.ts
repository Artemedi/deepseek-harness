/**
 * Explicit, workspace-authorized memory retrieval over durable DSH session history.
 * @module @deepseek-ai/dsh-experimental-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { MemoryCaptureMessage, MemoryCaptureRequest, MemoryId, MemoryProvider, MemoryProviderSearchRequest, MemorySearchRequest, MemorySearchResult, ResolvedMemorySearchSpec } from './types.ts'
import { normalizeOpenVikingRecords, OPENVIKING_STUB_RECORDS } from './remote-contract.ts'
import TencentDbHttpProvider, { type TencentDbHttpConfig } from './tencentdb-http.ts'
import OpenVikingHttpProvider, { type OpenVikingHttpConfig } from './openviking-http.ts'

function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

export type * from './types.ts'
export { normalizeOpenVikingRecords, normalizeTencentDbRecords, remoteFailure } from './remote-contract.ts'
export type { OpenVikingDepth, OpenVikingRecord, RemoteMemoryCitation, RemoteMemoryProvider, RemoteMemorySearchRequest, TencentDbRecord } from './remote-contract.ts'
export { default as TencentDbHttpProvider } from './tencentdb-http.ts'
export type { TencentDbCaptureRequest, TencentDbConversationMessage, TencentDbHttpConfig } from './tencentdb-http.ts'
export { default as OpenVikingHttpProvider } from './openviking-http.ts'
export type { OpenVikingHttpConfig } from './openviking-http.ts'

/** Maximum citations one request can return. */
export const MAX_MEMORY_HITS = 20
/** Maximum bytes the local provider may return in one request. */
export const MAX_MEMORY_CONTENT_BYTES = 32_768

/** Deterministic OpenViking records used only when that experimental route is explicitly enabled without HTTP configuration. */
class StubOpenVikingProvider implements MemoryProvider {
  readonly id = 'openviking'

  search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    return Promise.resolve(normalizeOpenVikingRecords(OPENVIKING_STUB_RECORDS, request.depth, request))
  }
}

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
  /** Explicitly enabled provider routes; `local` must be included. */
  readonly providers?: string[]
  /** Explicit TencentDB HTTP provider configuration. */
  readonly tencentdb?: TencentDbHttpConfig
  /** Explicit OpenViking HTTP provider configuration. */
  readonly openviking?: OpenVikingHttpConfig
  /** Export completed turns to the explicitly configured TencentDB provider. */
  readonly automaticCapture?: boolean
}

/** Loader configuration for the experimental memory providers. */
export const Config: z<Config> = z.object({
  defaultLimit: z.number().step(1).min(1).max(MAX_MEMORY_HITS).default(5),
  defaultMaxContentBytes: z.number().step(1).min(1).max(MAX_MEMORY_CONTENT_BYTES).default(8_192),
  providers: z.array(z.string()).default(['local']),
  tencentdb: z.object({
    baseUrl: z.string(),
    credentialRef: z.string(),
    serviceId: z.string(),
    teamId: z.string(),
    agentId: z.string(),
    userId: z.string(),
    authHeader: z.string().default('Authorization'),
    timeoutMs: z.number().step(1).min(1).max(300_000).default(30_000),
    maxResponseBytes: z.number().step(1).min(1).max(16_777_216).default(1_048_576),
  }).required(false),
  openviking: z.object({
    baseUrl: z.string(),
    credentialRef: z.string().required(false),
    timeoutMs: z.number().step(1).min(1).max(300_000).default(30_000),
    maxResponseBytes: z.number().step(1).min(1).max(16_777_216).default(1_048_576),
    targetUri: z.string().required(false),
  }).required(false),
  automaticCapture: z.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/** Explicit local-memory service over the existing session-query corpus. */
export default class MemoryService extends Service {
  static inject = ['agents', 'sessionQuery', 'sessions']

  private readonly config: {
    readonly defaultLimit: number
    readonly defaultMaxContentBytes: number
    readonly providers: string[]
    readonly tencentdb?: TencentDbHttpConfig
    readonly openviking?: OpenVikingHttpConfig
    readonly automaticCapture: boolean
  }
  private readonly providers: Map<string, MemoryProvider>

  /** @param ctx - owning Cordis context. @param config - retrieval caps. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this.config = {
      defaultLimit: config.defaultLimit ?? 5,
      defaultMaxContentBytes: config.defaultMaxContentBytes ?? 8_192,
      providers: config.providers ?? ['local'],
      ...(config.tencentdb === undefined ? {} : { tencentdb: config.tencentdb }),
      ...(config.openviking === undefined ? {} : { openviking: config.openviking }),
      automaticCapture: config.automaticCapture ?? false,
    }
    const available = new Map<string, MemoryProvider>([
      ['local', new LocalSessionMemoryProvider(ctx.sessionQuery)],
      ['openviking', this.config.openviking === undefined
        ? new StubOpenVikingProvider()
        : new OpenVikingHttpProvider(this.config.openviking, async (ref) => {
          const credentials = ctx.get('credentials') as CredentialProvider | undefined
          return (await credentials?.resolve(credentialRef(ref)))?.value
        })],
    ])
    if (this.config.providers.includes('tencentdb') && this.config.tencentdb === undefined) {
      throw new HarnessError('TencentDB provider configuration is required when the route is enabled', 'MEMORY_INVALID_REQUEST')
    }
    if (this.config.tencentdb !== undefined) {
      available.set('tencentdb', new TencentDbHttpProvider(this.config.tencentdb, async (ref) => {
        const credentials = ctx.get('credentials') as CredentialProvider | undefined
        return (await credentials?.resolve(credentialRef(ref)))?.value
      }))
    }
    const providers = new Map<string, MemoryProvider>()
    for (const id of this.config.providers) {
      if (id.trim().length === 0) throw new HarnessError('memory provider id must not be empty', 'MEMORY_INVALID_REQUEST')
      if (providers.has(id)) throw new HarnessError(`memory provider "${id}" is configured more than once`, 'MEMORY_INVALID_REQUEST')
      const provider = available.get(id)
      if (provider === undefined) throw new HarnessError(`memory provider "${id}" is unavailable`, 'MEMORY_PROVIDER_ERROR')
      providers.set(id, provider)
    }
    if (!providers.has('local')) throw new HarnessError('memory provider configuration must include local', 'MEMORY_INVALID_REQUEST')
    this.providers = providers
    if (this.config.automaticCapture) {
      if (!providers.has('tencentdb')) throw new HarnessError('automatic memory capture requires the TencentDB provider', 'MEMORY_INVALID_REQUEST')
      ctx.on('agent/status', ({ agent, status }) => {
        if (status !== 'idle') return
        void agent.runMaintenance(signal => this.captureCompletedTurns(agent, signal)).catch((error: unknown) => {
          this.ctx.logger.warn(`automatic memory capture failed for session "${agent.session.id}": ${String(error)}`)
        })
      }, { global: true })
    }
  }

  /**
   * Resolve and validate one explicit memory search before provider execution.
   * @param agent - exact live caller whose session supplies the workspace scope.
   * @param request - query, bounds, provider route, and cancellation.
   * @returns immutable provider execution specification.
   */
  resolve(agent: Agent, request: MemorySearchRequest): ResolvedMemorySearchSpec {
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
    const providerId = request.provider ?? 'local'
    const provider = this.providers.get(providerId)
    if (provider === undefined) throw new HarnessError(`memory provider "${providerId}" is not enabled`, 'MEMORY_PROVIDER_ERROR')
    if (providerId === 'openviking' && request.depth === undefined) {
      throw new HarnessError('OpenViking retrieval depth is required', 'MEMORY_INVALID_REQUEST')
    }
    return {
      provider, workspace, query, limit, maxContentBytes, signal: request.signal,
      ...request.depth === undefined ? {} : { depth: request.depth },
    }
  }

  /**
   * Search same-workspace history using a resolved provider specification.
   * @param agent - exact live caller whose session supplies the workspace scope.
   * @param request - query, bounds, provider route, and cancellation.
   * @returns detached citations that a consumer must log before model use.
   */
  async search(agent: Agent, request: MemorySearchRequest): Promise<MemorySearchResult> {
    const spec = this.resolve(agent, request)
    const providerRequest: MemoryProviderSearchRequest = {
      workspace: spec.workspace, query: spec.query, limit: spec.limit, maxContentBytes: spec.maxContentBytes, signal: spec.signal,
      ...spec.depth === undefined ? {} : { depth: spec.depth },
    }
    const hits = await spec.provider.search(providerRequest)
    return { provider: spec.provider.id, workspace: spec.workspace, hits }
  }

  /**
   * Persist one completed conversation slice through an explicitly enabled provider.
   * @param agent - exact live Agent whose session and workspace own the slice.
   * @param request - bounded messages, provider selection, and cancellation.
   */
  async capture(agent: Agent, request: MemoryCaptureRequest): Promise<void> {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new HarnessError('memory capture requires an exact live Agent', 'MEMORY_STALE_AGENT')
    }
    const workspace = agent.session.header.cwd
    if (workspace === undefined) {
      throw new HarnessError('memory capture is unavailable because the caller session has no workspace', 'MEMORY_UNAUTHORIZED')
    }
    if (request.signal.aborted) throw request.signal.reason
    const providerId = request.provider ?? 'tencentdb'
    const provider = this.providers.get(providerId)
    if (provider?.capture === undefined) {
      throw new HarnessError(`memory provider "${providerId}" does not support capture`, 'MEMORY_PROVIDER_ERROR')
    }
    await provider.capture({
      sessionId: agent.session.id,
      workspace,
      messages: request.messages,
      provider: providerId,
      signal: request.signal,
    })
  }

  /** Export every completed, not-yet-successful turn in chronological order. */
  async captureCompletedTurns(agent: Agent, signal: AbortSignal): Promise<void> {
    const succeeded = new Set<number>()
    const completed: number[] = []
    for (const event of agent.session.events) {
      if (event.type === 'memory/capture-succeeded') succeeded.add(event.data.turn)
      if (event.type === 'turn/end' && (event.data.reason.kind === 'completed' || event.data.reason.kind === 'max-tokens')) {
        completed.push(event.data.turn)
      }
    }
    for (const turn of completed) {
      if (signal.aborted) throw signal.reason
      if (succeeded.has(turn)) continue
      const messages = turnCaptureMessages(agent, turn)
      if (messages.length === 0) continue
      agent.session.append('memory/capture-requested', {
        version: 1, provider: 'tencentdb', turn, messageCount: messages.length,
      })
      await this.ctx.sessions.flush(agent.session)
      try {
        await this.capture(agent, { provider: 'tencentdb', messages, signal })
        agent.session.append('memory/capture-succeeded', { version: 1, provider: 'tencentdb', turn })
      } catch (error: unknown) {
        const code = error instanceof HarnessError ? error.code : 'MEMORY_PROVIDER_ERROR'
        agent.session.append('memory/capture-failed', { version: 1, provider: 'tencentdb', turn, code })
      }
      await this.ctx.sessions.flush(agent.session)
    }
  }
}

function turnCaptureMessages(agent: Agent, turn: number): MemoryCaptureMessage[] {
  const messages: MemoryCaptureMessage[] = []
  let inside = false
  for (const event of agent.session.events) {
    if (event.type === 'turn/start' && event.data.turn === turn) inside = true
    if (!inside) continue
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const content = textContent(event.data.content)
      if (content !== '') messages.push({ role: 'user', content })
    } else if (event.type === 'assistant/message' && event.data.turn === turn) {
      const content = textContent(event.data.message.content)
      if (content !== '') messages.push({ role: 'assistant', content })
    }
    if (event.type === 'turn/end' && event.data.turn === turn) break
  }
  return messages
}

function textContent(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n').trim()
}
