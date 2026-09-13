/** Local contract and response normalizers for future remote memory adapters. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { MemoryDepth, MemoryId } from './types.ts'

/** Explicit OpenViking context depth. */
export type OpenVikingDepth = 'L0' | 'L1' | 'L2'

/** Request passed to a remote adapter after DSH derives the caller scope. */
export interface RemoteMemorySearchRequest {
  readonly workspace: string
  readonly query: string
  readonly limit: number
  readonly maxContentBytes: number
  readonly depth?: MemoryDepth
  readonly signal: AbortSignal
}

/** Provider-neutral remote citation before it is adapted into a DSH durable event. */
export interface RemoteMemoryCitation {
  readonly id: MemoryId
  readonly kind: 'memory' | 'skill' | 'wiki' | 'code-graph' | 'resource'
  readonly title: string
  readonly source: string
  readonly content: string
}

/** A remote adapter returns bounded citations or throws a typed HarnessError. */
export interface RemoteMemoryProvider {
  readonly id: 'tencentdb' | 'openviking'
  search(request: RemoteMemorySearchRequest): Promise<readonly RemoteMemoryCitation[]>
}

/** Minimal TencentDB record accepted by the local stub adapter. */
export interface TencentDbRecord {
  readonly id: string
  readonly kind: RemoteMemoryCitation['kind']
  readonly title: string
  readonly content: string
  readonly source: string
}

/** Minimal OpenViking record accepted by the local stub adapter. */
export interface OpenVikingRecord {
  readonly uri: string
  readonly title: string
  readonly content: string
  readonly depth: OpenVikingDepth
}

/** Deterministic local OpenViking stub records. */
export const OPENVIKING_STUB_RECORDS: readonly OpenVikingRecord[] = [{
  uri: 'viking://stub/retry', title: 'Retry summary', content: 'OpenViking stub retry evidence', depth: 'L0',
}, {
  uri: 'viking://loader/retry', title: 'Loader retry detail', content: 'OpenViking Loader stub retry detail', depth: 'L1',
}, {
  uri: 'viking://stub/retry', title: 'Retry detail', content: 'OpenViking stub retry detail', depth: 'L1',
}]

/**
 * Map a remote HTTP outcome to a stable DSH failure without retaining provider body text.
 * @param status - remote HTTP status code.
 * @param provider - stable provider identifier used in the safe error message.
 * @returns a typed DSH memory failure.
 */
export function remoteFailure(status: number, provider: RemoteMemoryProvider['id']): HarnessError {
  const code = status === 401 || status === 403
    ? 'MEMORY_UNAUTHORIZED'
    : status === 408 || status === 429 || status === 599
      ? 'MEMORY_RETRYABLE'
      : status >= 500 && status <= 599
        ? 'MEMORY_PROVIDER_UNAVAILABLE'
        : 'MEMORY_PROVIDER_ERROR'
  return new HarnessError(`${provider} memory provider returned HTTP ${status}`, code)
}

/**
 * Normalize a TencentDB response with workspace isolation and byte bounds.
 * @param records - validated provider records.
 * @param request - authorized request carrying result and byte limits.
 * @returns bounded provider-neutral citations.
 */
export function normalizeTencentDbRecords(
  records: readonly TencentDbRecord[],
  request: RemoteMemorySearchRequest,
): readonly RemoteMemoryCitation[] {
  return bounded(records.map(record => ({
    id: memoryId(`tencentdb:${record.id}`), kind: record.kind, title: record.title,
    source: record.source, content: record.content,
  })), request)
}

/**
 * Normalize an OpenViking response at one explicit context depth.
 * @param records - validated provider records.
 * @param depth - explicitly selected OpenViking context depth.
 * @param request - authorized request carrying result and byte limits.
 * @returns bounded provider-neutral citations.
 */
export function normalizeOpenVikingRecords(
  records: readonly OpenVikingRecord[],
  depth: MemoryDepth | undefined,
  request: RemoteMemorySearchRequest,
): readonly RemoteMemoryCitation[] {
  if (depth === undefined) throw new HarnessError('OpenViking retrieval depth is required', 'MEMORY_INVALID_REQUEST')
  if (depth === 'L3') throw new HarnessError('OpenViking retrieval depth must be L0, L1, or L2', 'MEMORY_INVALID_REQUEST')
  const selected = records.filter(record => record.depth === depth).map(record => ({
    id: memoryId(`openviking:${record.uri}`), kind: 'resource' as const, title: record.title,
    source: record.uri, content: record.content,
  }))
  return bounded(selected, request)
}

function bounded(
  citations: readonly RemoteMemoryCitation[],
  request: RemoteMemorySearchRequest,
): readonly RemoteMemoryCitation[] {
  const result: RemoteMemoryCitation[] = []
  let remaining = request.maxContentBytes
  for (const citation of citations) {
    if (request.signal.aborted) throw request.signal.reason
    const content = citation.content.trim()
    if (content.length === 0) continue
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > remaining) continue
    result.push({ ...citation, content })
    remaining -= bytes
    if (result.length === request.limit || remaining === 0) break
  }
  return result
}

function memoryId(value: string): MemoryId {
  return value as MemoryId
}
