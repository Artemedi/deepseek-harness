/** Explicit TencentDB Agent Memory v3 HTTP provider. */

import { Buffer } from 'node:buffer'
import { isAbsolute, resolve } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { MemoryCaptureMessage, MemoryProvider, MemoryProviderCaptureRequest, MemoryProviderSearchRequest, MemorySearchResult } from './types.ts'
import { parseRemoteMemoryOrigin, readBoundedResponseText, resolveRemoteMemoryLimit } from './http-response.ts'
import { normalizeTencentDbRecords, remoteFailure } from './remote-contract.ts'
import type { TencentDbRecord } from './remote-contract.ts'

/** Provider-side Team isolation identity. */
export type TencentDbTeamId = Branded<'TencentDbTeamId'>
/** Provider-side Agent isolation identity. */
export type TencentDbAgentId = Branded<'TencentDbAgentId'>
/** Provider-side User isolation identity. */
export type TencentDbUserId = Branded<'TencentDbUserId'>

/** One explicit DSH workspace/preset to TencentDB tenancy binding. */
export interface TencentDbIsolationBinding {
  /** Absolute DSH workspace path. */
  readonly workspace: string
  /** Effective agent preset; omission binds only sessions with no preset. */
  readonly agentPreset?: string
  /** Provider-side Team isolation identifier. */
  readonly teamId: string
  /** Provider-side Agent isolation identifier. */
  readonly agentId: string
  /** Provider-side User isolation identifier. */
  readonly userId: string
}

/** Configuration for the opt-in TencentDB v3 atomic-search route. */
export interface TencentDbHttpConfig {
  /** Absolute TencentDB MemoryCore Gateway origin. */
  readonly baseUrl: string
  /** Validated bearer credential; loopback may omit it and use a non-secret protocol marker. */
  readonly credentialRef?: string
  /** Memory instance selected by `x-tdai-service-id`. */
  readonly serviceId: string
  /** Exact DSH workspace/preset to provisioned TencentDB isolation mappings. */
  readonly isolationBindings: TencentDbIsolationBinding[]
  /** Header carrying the bearer token. */
  readonly authHeader?: string
  /** Per-request network timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum accepted response body size in bytes. */
  readonly maxResponseBytes?: number
}

interface ResolvedBinding {
  readonly workspace: string
  readonly agentPreset?: string
  readonly teamId: TencentDbTeamId
  readonly agentId: TencentDbAgentId
  readonly userId: TencentDbUserId
}

interface ResolvedConfig {
  readonly baseUrl: string
  readonly credentialRef?: string
  readonly serviceId: string
  readonly isolationBindings: ReadonlyMap<string, ResolvedBinding>
  readonly authHeader: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576
const MAX_TIMEOUT_MS = 300_000
const MAX_RESPONSE_BYTES = 16_777_216
const MAX_CAPTURE_MESSAGES = 100
const MAX_CAPTURE_CONTENT_LENGTH = 8_192
const MAX_CAPTURE_BYTES = 1_048_576

/** One text message accepted by TencentDB's v3 conversation-ingest route. */
export type TencentDbConversationMessage = MemoryCaptureMessage

/** A completed DSH conversation slice to persist as TencentDB L0 memory. */
export type TencentDbCaptureRequest = Pick<MemoryProviderCaptureRequest, 'sessionId' | 'workspace' | 'agentPreset' | 'messages' | 'signal'>

/** Fetches explicit TencentDB v3 atomic-search records and returns bounded citations. */
export default class TencentDbHttpProvider implements MemoryProvider {
  readonly id = 'tencentdb'
  private readonly config: ResolvedConfig

  constructor(config: TencentDbHttpConfig, private readonly resolveCredential: (ref: string) => Promise<string | undefined>) {
    const baseUrl = parseRemoteMemoryOrigin(config.baseUrl, 'TencentDB')
    if (config.credentialRef !== undefined && config.credentialRef.trim().length === 0) {
      throw new HarnessError('TencentDB credentialRef must not be empty', 'MEMORY_INVALID_REQUEST')
    }
    if (config.credentialRef === undefined && !isLoopbackHostname(baseUrl.hostname)) {
      throw new HarnessError('TencentDB credentialRef is required for a non-loopback Gateway', 'MEMORY_INVALID_REQUEST')
    }
    if (config.serviceId.trim().length === 0) throw new HarnessError('TencentDB serviceId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (!Array.isArray(config.isolationBindings) || config.isolationBindings.length === 0) {
      throw new HarnessError('TencentDB isolationBindings must not be empty', 'MEMORY_INVALID_REQUEST')
    }
    const isolationBindings = new Map<string, ResolvedBinding>()
    const profileOwners = new Map<string, string>()
    for (const [index, binding] of config.isolationBindings.entries()) {
      if (binding.workspace.trim().length === 0 || !isAbsolute(binding.workspace)) {
        throw new HarnessError(`TencentDB isolation binding ${String(index)} workspace must be absolute`, 'MEMORY_INVALID_REQUEST')
      }
      if (binding.agentPreset !== undefined && binding.agentPreset.trim().length === 0) {
        throw new HarnessError(`TencentDB isolation binding ${String(index)} agentPreset must not be empty`, 'MEMORY_INVALID_REQUEST')
      }
      if (binding.teamId.trim().length === 0 || binding.agentId.trim().length === 0 || binding.userId.trim().length === 0) {
        throw new HarnessError(`TencentDB isolation binding ${String(index)} identifiers must not be empty`, 'MEMORY_INVALID_REQUEST')
      }
      const workspace = resolve(binding.workspace)
      const agentPreset = binding.agentPreset?.trim()
      const teamId = binding.teamId.trim()
      const agentId = binding.agentId.trim()
      const userId = binding.userId.trim()
      const key = bindingKey(workspace, agentPreset)
      if (isolationBindings.has(key)) {
        throw new HarnessError(`TencentDB isolation binding ${String(index)} duplicates a DSH workspace and agent preset`, 'MEMORY_INVALID_REQUEST')
      }
      const profileKey = JSON.stringify([teamId, agentId])
      const previousOwner = profileOwners.get(profileKey)
      if (previousOwner !== undefined) {
        throw new HarnessError(`TencentDB isolation binding ${String(index)} reuses a Team/Agent profile owned by another DSH scope`, 'MEMORY_INVALID_REQUEST')
      }
      profileOwners.set(profileKey, key)
      isolationBindings.set(key, {
        workspace,
        ...(agentPreset === undefined ? {} : { agentPreset }),
        teamId: teamId as TencentDbTeamId,
        agentId: agentId as TencentDbAgentId,
        userId: userId as TencentDbUserId,
      })
    }
    const authHeader = config.authHeader ?? 'Authorization'
    if (authHeader.trim().length === 0 || ['content-type', 'x-tdai-service-id'].includes(authHeader.toLowerCase())) {
      throw new HarnessError('TencentDB authHeader is empty or collides with a protocol header', 'MEMORY_INVALID_REQUEST')
    }
    this.config = {
      baseUrl: baseUrl.origin,
      ...(config.credentialRef === undefined ? {} : { credentialRef: config.credentialRef }),
      serviceId: config.serviceId,
      isolationBindings,
      authHeader,
      timeoutMs: resolveRemoteMemoryLimit(config.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'TencentDB', 'timeoutMs'),
      maxResponseBytes: resolveRemoteMemoryLimit(config.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES, 'TencentDB', 'maxResponseBytes'),
    }
  }

  async search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    if (request.signal.aborted) throw request.signal.reason
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('TencentDB search timed out')), this.config.timeoutMs)
    const abort = (): void => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      return await this.searchAtDepth({ ...request, signal: controller.signal })
    } catch (error: unknown) {
      if (error instanceof HarnessError) throw error
      if (request.signal.aborted) throw request.signal.reason
      if (controller.signal.aborted) throw new HarnessError('TencentDB search timed out', 'MEMORY_RETRYABLE')
      throw error
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener('abort', abort)
    }
  }

  private async searchAtDepth(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    const isolation = this.isolation(request)
    const depth = request.depth ?? 'L1'
    if (depth === 'L1') {
      const value = await this.post('/v3/atomic/search', { ...isolation, query: request.query, limit: request.limit }, request.signal)
      return normalizeTencentDbRecords(parseAtomicRecords(value), request)
    }
    if (depth === 'L2') return this.searchScenarios(request, isolation)
    if (depth === 'L3') {
      const value = await this.post('/v3/core/read', isolation, request.signal)
      const data = envelopeData(value)
      if (data.content === null) return []
      if (typeof data.content !== 'string') throw malformed('TencentDB core response is malformed')
      return normalizeTencentDbRecords([{
        id: 'core:persona', kind: 'memory', title: 'Core memory', content: data.content, source: 'tencentdb:core:persona',
      }], request)
    }
    throw new HarnessError('TencentDB retrieval depth must be L1, L2, or L3', 'MEMORY_INVALID_REQUEST')
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
      if (message.content.length > MAX_CAPTURE_CONTENT_LENGTH) {
        throw new HarnessError(`TencentDB capture message ${String(index)} exceeds the content length limit`, 'MEMORY_INVALID_REQUEST')
      }
    }
    const payload = {
      ...this.isolation(request),
      session_id: sessionId,
      messages: request.messages,
    }
    const body = JSON.stringify(payload)
    if (Buffer.byteLength(body, 'utf8') > MAX_CAPTURE_BYTES) {
      throw new HarnessError('TencentDB capture exceeds the request byte limit', 'MEMORY_INVALID_REQUEST')
    }

    const value = await this.post('/v3/conversation/add', payload, request.signal)
    const data = envelopeData(value)
    if (!Array.isArray(data.accepted_ids) || !data.accepted_ids.every(id => typeof id === 'string' && id.length > 0)
      || !Array.isArray(data.accepted_versions) || !data.accepted_versions.every(version => typeof version === 'string' && version.length > 0)
      || data.accepted_ids.length !== request.messages.length
      || data.accepted_versions.length !== request.messages.length
      || data.total_count !== request.messages.length) {
      throw malformed('TencentDB capture response is malformed')
    }
  }

  private isolation(request: Pick<MemoryProviderSearchRequest, 'workspace' | 'agentPreset'>): Record<string, string> {
    if (!isAbsolute(request.workspace)) {
      throw new HarnessError('TencentDB isolation requires an absolute caller workspace', 'MEMORY_UNAUTHORIZED')
    }
    const binding = this.config.isolationBindings.get(bindingKey(resolve(request.workspace), request.agentPreset))
    if (binding === undefined) {
      throw new HarnessError('TencentDB isolation is not configured for the caller workspace and agent preset', 'MEMORY_UNAUTHORIZED')
    }
    return { team_id: binding.teamId, agent_id: binding.agentId, user_id: binding.userId }
  }

  private async searchScenarios(
    request: MemoryProviderSearchRequest,
    isolation: Record<string, string>,
  ): Promise<readonly MemorySearchResult['hits'][number][]> {
    const listed = await this.post('/v3/scenario/ls', isolation, request.signal)
    const entries = parseScenarioEntries(listed)
      .map(entry => ({ ...entry, score: scenarioScore(entry, request.query) }))
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, request.limit)
    const records: TencentDbRecord[] = []
    for (const entry of entries) {
      const value = await this.post('/v3/scenario/read', { ...isolation, path: entry.path }, request.signal)
      const data = envelopeData(value)
      if (data.content === null) continue
      if (typeof data.content !== 'string') throw malformed('TencentDB scenario response is malformed')
      records.push({
        id: `scenario:${entry.path}`, kind: 'memory', title: entry.summary ?? entry.path,
        content: data.content, source: `tencentdb:scenario:${entry.path}`,
      })
    }
    return normalizeTencentDbRecords(records, request)
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const authHeaders = await this.resolveAuthHeaders()
    if (signal.aborted) throw signal.reason
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('TencentDB request timed out')), this.config.timeoutMs)
    const abort = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { ...authHeaders, 'x-tdai-service-id': this.config.serviceId, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw remoteFailure(response.status, 'tencentdb')
      return parseSuccessEnvelope(await readBoundedResponseText(response, this.config.maxResponseBytes, 'TencentDB'))
    } catch (error: unknown) {
      if (error instanceof HarnessError) throw error
      if (signal.aborted) throw signal.reason
      if (controller.signal.aborted) throw new HarnessError('TencentDB request timed out', 'MEMORY_RETRYABLE')
      throw new HarnessError('TencentDB provider request failed', 'MEMORY_PROVIDER_UNAVAILABLE')
    } finally {
      clearTimeout(deadline)
      signal.removeEventListener('abort', abort)
    }
  }

  private async resolveAuthHeaders(): Promise<Record<string, string>> {
    // Upstream v3 parses a mandatory Bearer shape even when standalone
    // Gateway authentication is disabled. This loopback-only marker carries
    // no authority; non-loopback endpoints were rejected in the constructor.
    if (this.config.credentialRef === undefined) return { [this.config.authHeader]: 'Bearer dsh-local-loopback' }
    const secret = await this.resolveCredential(this.config.credentialRef)
    if (secret === undefined || secret.trim().length === 0) {
      throw new HarnessError('TencentDB credential is not configured', 'MEMORY_UNAUTHORIZED')
    }
    return { [this.config.authHeader]: `Bearer ${secret}` }
  }
}

function bindingKey(workspace: string, agentPreset: string | undefined): string {
  return JSON.stringify([workspace, agentPreset ?? null])
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === '[::1]' || normalized === '::1') return true
  const segments = normalized.split('.')
  return segments.length === 4
    && segments[0] === '127'
    && segments.every(segment => /^\d{1,3}$/.test(segment))
}

function parseAtomicRecords(value: Record<string, unknown>): readonly TencentDbRecord[] {
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

function parseScenarioEntries(value: Record<string, unknown>): Array<{ path: string; summary?: string }> {
  const data = envelopeData(value)
  if (!Array.isArray(data.entries)) throw malformed('TencentDB scenario list does not contain entries')
  return data.entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== 'string') throw malformed(`TencentDB scenario entry ${String(index)} is malformed`)
    return { path: entry.path, ...(typeof entry.summary === 'string' ? { summary: entry.summary } : {}) }
  }).filter(entry => entry.path.length > 0 && !entry.path.endsWith('/'))
}

function scenarioScore(entry: { path: string; summary?: string }, query: string): number {
  const haystack = `${entry.path}\n${entry.summary ?? ''}`.toLowerCase()
  const normalized = query.trim().toLowerCase()
  const terms = [...new Set(normalized.split(/[^\p{L}\p{N}_-]+/u).filter(term => term.length > 1))]
  return (haystack.includes(normalized) ? 10 : 0)
    + terms.reduce((score, term) => score + Number(haystack.includes(term)), 0)
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

function envelopeData(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.data)) throw malformed('TencentDB response does not contain data')
  return value.data
}

function malformed(message: string): HarnessError {
  return new HarnessError(message, 'MEMORY_PROVIDER_ERROR')
}

function findRecords(value: Record<string, unknown>): readonly unknown[] | undefined {
  if (isRecord(value.data) && Array.isArray(value.data.items)) return value.data.items
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
