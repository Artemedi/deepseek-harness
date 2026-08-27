/** Explicit OpenViking REST search provider. */

import { Buffer } from 'node:buffer'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { MemoryProvider, MemoryProviderSearchRequest, MemorySearchResult } from './types.ts'
import { normalizeOpenVikingRecords, remoteFailure } from './remote-contract.ts'
import type { OpenVikingDepth, OpenVikingRecord } from './remote-contract.ts'

/** Configuration for the opt-in OpenViking retrieval route. */
export interface OpenVikingHttpConfig {
  readonly baseUrl: string
  readonly credentialRef?: string
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly targetUri?: string
}

type ResolvedConfig = Required<Omit<OpenVikingHttpConfig, 'credentialRef' | 'targetUri'>> & Pick<OpenVikingHttpConfig, 'credentialRef' | 'targetUri'>
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576

/** Fetches OpenViking's confirmed `/api/v1/search/find` result envelope. */
export default class OpenVikingHttpProvider implements MemoryProvider {
  readonly id = 'openviking'
  private readonly config: ResolvedConfig

  constructor(config: OpenVikingHttpConfig, private readonly resolveCredential: (ref: string) => Promise<string | undefined>) {
    if (config.baseUrl.trim().length === 0) throw new HarnessError('OpenViking baseUrl must not be empty', 'MEMORY_INVALID_REQUEST')
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      ...(config.credentialRef === undefined ? {} : { credentialRef: config.credentialRef }),
      ...(config.targetUri === undefined ? {} : { targetUri: config.targetUri }),
    }
  }

  async search(request: MemoryProviderSearchRequest): Promise<readonly MemorySearchResult['hits'][number][]> {
    if (request.depth === undefined) throw new HarnessError('OpenViking retrieval depth is required', 'MEMORY_INVALID_REQUEST')
    if (request.signal.aborted) throw request.signal.reason
    const secret = this.config.credentialRef === undefined ? undefined : await this.resolveCredential(this.config.credentialRef)
    if (this.config.credentialRef !== undefined && secret === undefined) {
      throw new HarnessError('OpenViking credential is not configured', 'MEMORY_UNAUTHORIZED')
    }
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('OpenViking request timed out')), this.config.timeoutMs)
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/search/find`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(secret === undefined ? {} : { Authorization: `Bearer ${secret}`, 'X-API-Key': secret }) },
        body: JSON.stringify({
          query: request.query,
          limit: request.limit,
          ...(this.config.targetUri === undefined ? {} : { target_uri: this.config.targetUri }),
        }),
      })
      if (!response.ok) throw remoteFailure(response.status, 'openviking')
      const raw = await readBoundedBody(response, this.config.maxResponseBytes)
      return normalizeOpenVikingRecords(parseRecords(raw, request.depth), request.depth, request)
    } catch (error: unknown) {
      if (error instanceof HarnessError) throw error
      if (request.signal.aborted) throw request.signal.reason
      if (controller.signal.aborted) throw new HarnessError('OpenViking request timed out', 'MEMORY_RETRYABLE')
      throw new HarnessError('OpenViking provider request failed', 'MEMORY_PROVIDER_UNAVAILABLE')
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener('abort', abort)
    }
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) throw new HarnessError('OpenViking response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new HarnessError('OpenViking response exceeds configured byte limit', 'MEMORY_PROVIDER_ERROR')
  return Buffer.from(bytes).toString('utf8')
}

function parseRecords(raw: string, depth: OpenVikingDepth | undefined): readonly OpenVikingRecord[] {
  if (depth === undefined) throw new HarnessError('OpenViking retrieval depth is required', 'MEMORY_INVALID_REQUEST')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new HarnessError('OpenViking response is not valid JSON', 'MEMORY_PROVIDER_ERROR') }
  if (!isRecord(value) || !isRecord(value.result)) throw new HarnessError('OpenViking response does not contain result', 'MEMORY_PROVIDER_ERROR')
  const result = value.result
  const entries: OpenVikingRecord[] = []
  for (const [key, kind] of [['memories', 'memory'], ['resources', 'resource'], ['skills', 'skill']] as const) {
    const items = result[key]
    if (items === undefined) continue
    if (!Array.isArray(items)) throw new HarnessError(`OpenViking result.${key} is malformed`, 'MEMORY_PROVIDER_ERROR')
    for (const [index, item] of items.entries()) {
      if (!isRecord(item) || typeof item.uri !== 'string' || typeof item.abstract !== 'string') {
        throw new HarnessError(`OpenViking result.${key}[${String(index)}] is malformed`, 'MEMORY_PROVIDER_ERROR')
      }
      if (depth === undefined) throw new HarnessError('OpenViking retrieval depth is required', 'MEMORY_INVALID_REQUEST')
      entries.push({ uri: item.uri, title: typeof item.title === 'string' ? item.title : kind, content: item.abstract, depth })
    }
  }
  return entries
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
