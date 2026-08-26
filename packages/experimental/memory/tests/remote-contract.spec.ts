import { describe, expect, it } from 'vitest'
import { normalizeOpenVikingRecords, normalizeTencentDbRecords } from '../src/remote-contract.ts'

const request = (overrides: Partial<{ workspace: string; query: string; limit: number; maxContentBytes: number; signal: AbortSignal }> = {}) => ({
  workspace: '/workspace/a', query: 'retry', limit: 5, maxContentBytes: 100, signal: new AbortController().signal, ...overrides,
})

describe('remote memory contract normalizers', () => {
  it('keeps only TencentDB records in the DSH-derived workspace', () => {
    const records = [
      { id: 'chat-1', kind: 'memory' as const, title: 'Gateway', content: 'retry evidence', source: 'chat', workspace: '/workspace/a' },
      { id: 'chat-2', kind: 'memory' as const, title: 'Private', content: 'do not return', source: 'chat', workspace: '/workspace/b' },
    ]
    expect(normalizeTencentDbRecords(records, request())).toEqual([{
      id: 'tencentdb:chat-1', kind: 'memory', title: 'Gateway', content: 'retry evidence', source: 'chat',
    }])
  })

  it('rejects OpenViking retrieval without an explicit depth', () => {
    expect(() => normalizeOpenVikingRecords([], undefined, request())).toThrow(/depth is required/)
  })

  it('keeps opaque OpenViking URI and selected depth', () => {
    const records = [
      { uri: 'viking://team/private', title: 'L0', content: 'summary', depth: 'L0' as const },
      { uri: 'viking://team/private', title: 'L1', content: 'detail', depth: 'L1' as const },
    ]
    expect(normalizeOpenVikingRecords(records, 'L1', request())).toEqual([{
      id: 'openviking:viking://team/private', kind: 'resource', title: 'L1', source: 'viking://team/private', content: 'detail',
    }])
  })

  it('enforces UTF-8 bounds and cancellation', () => {
    const text = 'retry восстановлен'
    expect(normalizeTencentDbRecords([
      { id: 'one', kind: 'memory', title: 'x', content: text, source: 's', workspace: '/workspace/a' },
    ], request({ maxContentBytes: Buffer.byteLength(text, 'utf8') - 1 }))).toEqual([])
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    expect(() => normalizeOpenVikingRecords([
      { uri: 'viking://x', title: 'x', content: 'retry', depth: 'L2' },
    ], 'L2', request({ signal: controller.signal }))).toThrow('cancelled')
  })
})
