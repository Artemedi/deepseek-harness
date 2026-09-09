/** Explicit TencentDB Agent Memory v3 HTTP provider. */

import { Buffer } from 'node:buffer'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { MemoryCaptureMessage, MemoryProvider, MemoryProviderCaptureRequest, MemoryProviderSearchRequest, MemorySearchResult } from './types.ts'
import { normalizeTencentDbRecords, remoteFailure } from './remote-contract.ts'
import type { TencentDbRecord } from './remote-contract.ts'

/** Configuration for the opt-in TencentDB v3 atomic-search route. */
export interface TencentDbHttpConfig {
  /** Absolute TencentDB MemoryCore Gateway origin. */
  readonly baseUrl: string
  /** Validated bearer credential; loopback may omit it and use a non-secret protocol marker. */
  readonly credentialRef?: string
  /** Memory instance selected by `x-tdai-service-id`. */
  readonly serviceId: string
  /** Provider-side Team isolation identifier. */
  readonly teamId: string
  /** Provider-side Agent isolation identifier. */
  readonly agentId: string
  /** Provider-side User isolation identifier. */
  readonly userId: string
  /** Header carrying the bearer token. */
  readonly authHeader?: string
  /** Per-request network timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum accepted response body size in bytes. */
  readonly maxResponseBytes?: number
}

type ResolvedConfig = Required<Omit<TencentDbHttpConfig, 'credentialRef'>> & Pick<TencentDbHttpConfig, 'credentialRef'>

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576
const MAX_CAPTURE_MESSAGES = 256
const MAX_CAPTURE_BYTES = 1_048_576

/** One text message accepted by TencentDB's v3 conversation-ingest route. */
export type TencentDbConversationMessage = MemoryCaptureMessage

/** A completed DSH conversation slice to persist as TencentDB L0 memory. */
export type TencentDbCaptureRequest = Pick<MemoryProviderCaptureRequest, 'sessionId' | 'messages' | 'signal'>

/** Fetches explicit TencentDB v3 atomic-search records and returns bounded citations. */
export default class TencentDbHttpProvider implements MemoryProvider {
  readonly id = 'tencentdb'
  private readonly config: ResolvedConfig

  constructor(config: TencentDbHttpConfig, private readonly resolveCredential: (ref: string) => Promise<string | undefined>) {
    if (config.baseUrl.trim().length === 0) throw new HarnessError('TencentDB baseUrl must not be empty', 'MEMORY_INVALID_REQUEST')
    let baseUrl: URL
    try {
      baseUrl = new URL(config.baseUrl)
    } catch {
      throw new HarnessError('TencentDB baseUrl must be an absolute URL', 'MEMORY_INVALID_REQUEST')
    }
    if (config.credentialRef !== undefined && config.credentialRef.trim().length === 0) {
      throw new HarnessError('TencentDB credentialRef must not be empty', 'MEMORY_INVALID_REQUEST')
    }
    if (config.credentialRef === undefined && !isLoopbackHostname(baseUrl.hostname)) {
      throw new HarnessError('TencentDB credentialRef is required for a non-loopback Gateway', 'MEMORY_INVALID_REQUEST')
    }
    if (config.serviceId.trim().length === 0) throw new HarnessError('TencentDB serviceId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.teamId.trim().length === 0) throw new HarnessError('TencentDB teamId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.agentId.trim().length === 0) throw new HarnessError('TencentDB agentId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.userId.trim().length === 0) throw new HarnessError('TencentDB userId must not be empty', 'MEMORY_INVALID_REQUEST')
    const authHeader = config.authHeader ?? 'Authorization'
    if (authHeader.trim().length === 0 || ['content-type', 'x-tdai-service-id'].includes(authHeader.toLowerCase())) {
      throw new HarnessError('TencentDB authHeader is empty or collides with a protocol header', 'MEMORY_INVALID_REQUEST')
    }
    this.config = {
      baseUrl: baseUrl.href.replace(/\/$/, ''),
      ...(config.credentialRef === undefined ? {} : { credentialRef: config.credentialRef }),
      serviceId: config.serviceId,
      teamId: config.teamId,
      agentId: config.agentId,
      userId: config.userId,
      authHeader,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    }
  }

  async search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    if (request.signal.aborted) throw request.signal.reason
    const authHeaders = await this.resolveAuthHeaders()
    if (request.signal.aborted) throw request.signal.reason
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('TencentDB request timed out')), this.config.timeoutMs)
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${this.config.baseUrl}/v3/atomic/search`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...authHeaders,
          'x-tdai-service-id': this.config.serviceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          team_id: this.config.teamId,
          agent_id: this.config.agentId,
          user_id: this.config.userId,
          query: request.query,
          limit: request.limit,
        }),
      })
      if (!response.ok) throw remoteFailure(response.status, 'tencentdb')
      const raw = await readBoundedBody(response, this.config.maxResponseBytes)
      return normalizeTencentDbRecords(parseRecords(raw), request)
    } catch (error: unknown) {
      if (error instanceof HarnessError) throw error
      if (request.signal.aborted) throw request.signal.reason
      if (controller.signal.aborted) throw new HarnessError('TencentDB request timed out', 'MEMORY_RETRYABLE')
      throw new HarnessError('TencentDB provider request failed', 'MEMORY_PROVIDER_UNAVAILABLE')
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener('abort', abort)
    }
  }

  /** Persists a bounded completed conversation slice for asynchronous memory extraction. */
  async capture(request: TencentDbCaptureRequest): Promise<void> {
    if (request.signal.aborted) throw request.signal.reason
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : ''
    if (sessionId.length === 0) throw new HarnessError('TencentDB capture sessionId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (!Array.isArray(request.messages) || request.messages.length === 0) throw new HarnessError('TencentDB capture messages must not be empty', 'MEMORY_INVALID_REQUEST')
    if (request.messages.length > MAX_CAPTURE_MESSAGES) throw new HarnessError('TencentDB capture exceeds the message count limit', 'MEMORY_INVALID_REQUEST')
    for (const [index, message] of request.messages.entries()) {
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || message.content.trim().length === 0) {
        throw new HarnessError(`TencentDB capture message ${String(index)} is malformed`, 'MEMORY_INVALID_REQUEST')
      }
    }
    const body = JSON.stringify({
      team_id: this.config.teamId,
      agent_id: this.config.agentId,
      user_id: this.config.userId,
      session_id: sessionId,
      messages: request.messages,
    })
    if (Buffer.byteLength(body, 'utf8') > MAX_CAPTURE_BYTES) {
      throw new HarnessError('TencentDB capture exceeds the request byte limit', 'MEMORY_INVALID_REQUEST')
    }

    if (request.signal.aborted) throw request.signal.reason
    const authHeaders = await this.resolveAuthHeaders()
    if (request.signal.aborted) throw request.signal.reason
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('TencentDB request timed out')), this.config.timeoutMs)
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${this.config.baseUrl}/v3/conversation/add`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...authHeaders,
          'x-tdai-service-id': this.config.serviceId,
          'Content-Type': 'application/json',
        },
        body,
      })
      if (!response.ok) throw remoteFailure(response.status, 'tencentdb')
      parseSuccessEnvelope(await readBoundedBody(response, this.config.maxResponseBytes))
    } catch (error: unknown) {
      if (error instanceof HarnessError) throw error
      if (request.signal.aborted) throw request.signal.reason
      if (controller.signal.aborted) throw new HarnessError('TencentDB request timed out', 'MEMORY_RETRYABLE')
      throw new HarnessError('TencentDB provider request failed', 'MEMORY_PROVIDER_UNAVAILABLE')
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener('abort', abort)
    }
  }

  private async resolveAuthHeaders(): Promise<Record<string, string>> {
    // Upstream v3 parses a mandatory Bearer shape even when standalone
    // Gateway authentication is disabled. This loopback-only marker carries
    // no authority; non-loopback endpoints were rejected in the constructor.
    if (this.config.credentialRef === undefined) return { [this.config.authHeader]: 'Bearer dsh-local-loopback' }
    const secret = await this.resolveCredential(this.config.credentialRef)
    if (secret === undefined) throw new HarnessError('TencentDB credential is not configured', 'MEMORY_UNAUTHORIZED')
    return { [this.config.authHeader]: `Bearer ${secret}` }
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === '[::1]' || normalized === '::1') return true
  const segments = normalized.split('.')
  return segments.length === 4
    && segments[0] === '127'
    && segments.every(segment => /^\d{1,3}$/.test(segment) && Number(segment) <= 255)
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) throw new HarnessError('TencentDB response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new HarnessError('TencentDB response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  return Buffer.from(bytes).toString('utf8')
}

function parseRecords(raw: string): readonly TencentDbRecord[] {
  const value = parseSuccessEnvelope(raw)
  const records = findRecords(value)
  if (records === undefined) throw new HarnessError('TencentDB response does not contain records', 'MEMORY_PROVIDER_ERROR')
  return records.map((record, index) => {
    if (!isRecord(record) || typeof record.id !== 'string' || typeof record.content !== 'string') {
      throw new HarnessError(`TencentDB record ${String(index)} is malformed`, 'MEMORY_PROVIDER_ERROR')
    }
    return {
      id: record.id,
      kind: 'memory',
      title: typeof record.type === 'string' ? record.type : 'Atomic memory',
      content: record.content,
      source: `tencentdb:atomic:${record.id}`,
    }
  })
}

function parseSuccessEnvelope(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new HarnessError('TencentDB response is not valid JSON', 'MEMORY_PROVIDER_ERROR')
  }
  if (!isRecord(value) || value.code !== 0) throw new HarnessError('TencentDB response reports an unsuccessful operation', 'MEMORY_PROVIDER_ERROR')
  return value
}

function findRecords(value: unknown): readonly unknown[] | undefined {
  if (!isRecord(value)) return undefined
  if (isRecord(value.data) && Array.isArray(value.data.items)) return value.data.items
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
