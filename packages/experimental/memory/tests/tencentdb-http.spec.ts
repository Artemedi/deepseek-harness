import { afterEach, describe, expect, it, vi } from 'vitest'
import TencentDbHttpProvider from '../src/tencentdb-http.ts'

const request = (signal = new AbortController().signal) => ({
  workspace: '/workspace/a', query: 'retry', limit: 2, maxContentBytes: 100, signal,
})

const response = (records: unknown) => new Response(JSON.stringify({ records }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function provider(resolveCredential: (ref: string) => Promise<string | undefined> = async ref => ref === 'TENCENT_KEY' ? 'secret-value' : undefined) {
  return new TencentDbHttpProvider({ baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY' }, resolveCredential)
}

describe('TencentDbHttpProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends an explicit scoped v3 search and normalizes bounded citations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://memory.example/v3/atomic/search')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-value' })
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'retry', workspace: '/workspace/a', limit: 2 })
      return response([{ id: 'opaque-1', kind: 'memory', title: 'Retry', content: 'evidence', source: 'chat', workspace: '/workspace/a' }])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search(request())).resolves.toEqual([{
      id: 'tencentdb:opaque-1', kind: 'memory', title: 'Retry', content: 'evidence', source: 'chat',
    }])
  })

  it('fails closed for missing credentials, HTTP errors, malformed JSON, oversized responses, and cancellation', async () => {
    await expect(provider(async () => undefined).search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{oops', { status: 200 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('1234567890', { status: 200 })))
    const bounded = new TencentDbHttpProvider({ baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', maxResponseBytes: 4 }, async () => 'secret')
    await expect(bounded.search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(provider().search(request(controller.signal))).rejects.toThrow('cancelled')
  })

  it('maps timeout and rejects malformed records without exposing the secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => reject(new Error('network')), 30)
    })))
    const timed = new TencentDbHttpProvider({ baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', timeoutMs: 1 }, async () => 'secret-value')
    await expect(timed.search(request())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 'bad', content: 'x' }])))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })
})
