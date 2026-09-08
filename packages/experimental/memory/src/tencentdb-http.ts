/** Explicit TencentDB Agent Memory v3 HTTP provider. */

import { Buffer } from 'node:buffer'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { MemoryProvider, MemoryProviderSearchRequest, MemorySearchResult } from './types.ts'
import { normalizeTencentDbRecords, remoteFailure } from './remote-contract.ts'
import type { TencentDbRecord } from './remote-contract.ts'

/** Configuration for the opt-in TencentDB v3 atomic-search route. */
export interface TencentDbHttpConfig {
  readonly baseUrl: string
  readonly credentialRef: string
  readonly serviceId: string
  readonly teamId: string
  readonly agentId: string
  readonly userId: string
  readonly authHeader?: string
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

type ResolvedConfig = Required<TencentDbHttpConfig>

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576

/** Fetches explicit TencentDB v3 atomic-search records and returns bounded citations. */
export default class TencentDbHttpProvider implements MemoryProvider {
  readonly id = 'tencentdb'
  private readonly config: ResolvedConfig

  constructor(config: TencentDbHttpConfig, private readonly resolveCredential: (ref: string) => Promise<string | undefined>) {
    if (config.baseUrl.trim().length === 0) throw new HarnessError('TencentDB baseUrl must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.credentialRef.trim().length === 0) throw new HarnessError('TencentDB credentialRef must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.serviceId.trim().length === 0) throw new HarnessError('TencentDB serviceId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.teamId.trim().length === 0) throw new HarnessError('TencentDB teamId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.agentId.trim().length === 0) throw new HarnessError('TencentDB agentId must not be empty', 'MEMORY_INVALID_REQUEST')
    if (config.userId.trim().length === 0) throw new HarnessError('TencentDB userId must not be empty', 'MEMORY_INVALID_REQUEST')
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      credentialRef: config.credentialRef,
      serviceId: config.serviceId,
      teamId: config.teamId,
      agentId: config.agentId,
      userId: config.userId,
      authHeader: config.authHeader ?? 'Authorization',
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    }
  }

  async search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    if (request.signal.aborted) throw request.signal.reason
    const secret = await this.resolveCredential(this.config.credentialRef)
    if (secret === undefined) throw new HarnessError('TencentDB credential is not configured', 'MEMORY_UNAUTHORIZED')
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
          [this.config.authHeader]: `Bearer ${secret}`,
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
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) throw new HarnessError('TencentDB response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new HarnessError('TencentDB response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  return Buffer.from(bytes).toString('utf8')
}

function parseRecords(raw: string): readonly TencentDbRecord[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new HarnessError('TencentDB response is not valid JSON', 'MEMORY_PROVIDER_ERROR')
  }
  if (!isRecord(value) || value.code !== 0) throw new HarnessError('TencentDB response reports an unsuccessful operation', 'MEMORY_PROVIDER_ERROR')
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

function findRecords(value: unknown): readonly unknown[] | undefined {
  if (!isRecord(value)) return undefined
  if (isRecord(value.data) && Array.isArray(value.data.items)) return value.data.items
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
