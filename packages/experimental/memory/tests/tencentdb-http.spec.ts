import { afterEach, describe, expect, it, vi } from 'vitest'
import TencentDbHttpProvider from '../src/tencentdb-http.ts'

const request = (signal = new AbortController().signal) => ({
  workspace: '/workspace/a', query: 'retry', limit: 2, maxContentBytes: 100, signal,
})

const response = (items: unknown, code = 0) => new Response(JSON.stringify({ code, message: code === 0 ? 'ok' : 'failed', request_id: 'request-1', data: { items } }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function provider(resolveCredential: (ref: string) => Promise<string | undefined> = async ref => ref === 'TENCENT_KEY' ? 'secret-value' : undefined) {
  return new TencentDbHttpProvider({
    baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
    teamId: 'team-1', agentId: 'agent-1', userId: 'user-1',
  }, resolveCredential)
}

describe('TencentDbHttpProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends an explicit scoped v3 search and normalizes bounded citations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://memory.example/v3/atomic/search')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-value', 'x-tdai-service-id': 'memory-1' })
      expect(JSON.parse(String(init?.body))).toEqual({
        team_id: 'team-1', agent_id: 'agent-1', user_id: 'user-1', query: 'retry', limit: 2,
      })
      return response([{ id: 'opaque-1', type: 'preference', content: 'evidence', background: 'chat', score: 0.9 }])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search(request())).resolves.toEqual([{
      id: 'tencentdb:opaque-1', kind: 'memory', title: 'preference', content: 'evidence', source: 'tencentdb:atomic:opaque-1',
    }])
  })

  it('fails closed for missing credentials, HTTP errors, malformed JSON, oversized responses, and cancellation', async () => {
    await expect(provider(async () => undefined).search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{oops', { status: 200 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('1234567890', { status: 200 })))
    const bounded = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      teamId: 'team-1', agentId: 'agent-1', userId: 'user-1', maxResponseBytes: 4,
    }, async () => 'secret')
    await expect(bounded.search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(provider().search(request(controller.signal))).rejects.toThrow('cancelled')
  })

  it('maps timeout and rejects malformed records without exposing the secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => reject(new Error('network')), 30)
    })))
    const timed = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      teamId: 'team-1', agentId: 'agent-1', userId: 'user-1', timeoutMs: 1,
    }, async () => 'secret-value')
    await expect(timed.search(request())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 'bad', content: 'x' }])))
    await expect(provider().search(request())).resolves.toMatchObject([{ title: 'Atomic memory' }])

    vi.stubGlobal('fetch', vi.fn(async () => response([], 42)))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })

  it('captures a scoped DSH session through the v3 conversation route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://memory.example/v3/conversation/add')
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer secret-value', 'x-tdai-service-id': 'memory-1', 'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        team_id: 'team-1', agent_id: 'agent-1', user_id: 'user-1', session_id: 'dsh-session-1',
        messages: [{ role: 'user', content: 'remember this' }, { role: 'assistant', content: 'noted' }],
      })
      return new Response(JSON.stringify({ code: 0, message: 'ok', request_id: 'capture-1', data: {} }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().capture({
      sessionId: 'dsh-session-1',
      messages: [{ role: 'user', content: 'remember this' }, { role: 'assistant', content: 'noted' }],
      signal: new AbortController().signal,
    })).resolves.toBeUndefined()
  })

  it('fails closed for invalid capture input, credentials, envelopes, HTTP failures, cancellation, and timeout', async () => {
    const capture = (overrides: Partial<Parameters<TencentDbHttpProvider['capture']>[0]> = {}) => ({
      sessionId: 'session-1', messages: [{ role: 'user' as const, content: 'hello' }],
      signal: new AbortController().signal, ...overrides,
    })
    await expect(provider().capture(capture({ sessionId: ' ' }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [{ role: 'user', content: ' ' }] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [{ role: 'tool' as 'user', content: 'output' }] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider(async () => undefined).capture(capture())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(provider().capture(capture())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{oops', { status: 200 })))
    await expect(provider().capture(capture())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => response([], 9)))
    await expect(provider().capture(capture())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    const cancelled = new AbortController()
    cancelled.abort(new Error('capture cancelled'))
    await expect(provider().capture(capture({ signal: cancelled.signal }))).rejects.toThrow('capture cancelled')

    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => reject(new Error('network')), 30)
    })))
    const timed = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      teamId: 'team-1', agentId: 'agent-1', userId: 'user-1', timeoutMs: 1,
    }, async () => 'secret-value')
    await expect(timed.capture(capture())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })
  })

  it('bounds capture request and response sizes', async () => {
    await expect(provider().capture({
      sessionId: 'session-1', messages: Array.from({ length: 257 }, () => ({ role: 'user', content: 'x' })),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture({
      sessionId: 'session-1', messages: [{ role: 'user', content: 'x'.repeat(1_048_576) }],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('1234567890', { status: 200 })))
    const bounded = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      teamId: 'team-1', agentId: 'agent-1', userId: 'user-1', maxResponseBytes: 4,
    }, async () => 'secret')
    await expect(bounded.capture({
      sessionId: 'session-1', messages: [{ role: 'assistant', content: 'ok' }], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })
})
