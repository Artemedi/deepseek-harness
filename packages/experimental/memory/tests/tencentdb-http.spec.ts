import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import TencentDbHttpProvider from '../src/tencentdb-http.ts'

const binding = {
  workspace: '/workspace/a', agentPreset: 'standard',
  teamId: 'team-1', agentId: 'agent-1', userId: 'user-1',
}
const request = (signal = new AbortController().signal) => ({
  workspace: binding.workspace, agentPreset: binding.agentPreset,
  query: 'retry', limit: 2, maxContentBytes: 100, signal,
})
const captureScope = { workspace: binding.workspace, agentPreset: binding.agentPreset }

const response = (items: unknown, code = 0) => new Response(JSON.stringify({ code, message: code === 0 ? 'ok' : 'failed', request_id: 'request-1', data: { items } }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new TypeError('expected a string request body')
  return init.body
}

function provider(resolveCredential: (ref: string) => Promise<string | undefined> = async ref => ref === 'TENCENT_KEY' ? 'secret-value' : undefined) {
  return new TencentDbHttpProvider({
    baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
    isolationBindings: [binding],
  }, resolveCredential)
}

function anonymousProvider(baseUrl = 'http://127.0.0.1:8420', resolveCredential = vi.fn(async () => undefined)) {
  return {
    provider: new TencentDbHttpProvider({
      baseUrl, serviceId: 'memory-1', isolationBindings: [binding],
    }, resolveCredential),
    resolveCredential,
  }
}

describe('TencentDbHttpProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends an explicit scoped v3 search and normalizes bounded citations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe('https://memory.example/v3/atomic/search')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-value', 'x-tdai-service-id': 'memory-1' })
      expect(JSON.parse(requestBody(init))).toEqual({
        team_id: 'team-1', agent_id: 'agent-1', user_id: 'user-1', query: 'retry', limit: 2,
      })
      return response([{ id: 'opaque-1', type: 'preference', content: 'evidence', background: 'chat', score: 0.9 }])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search(request())).resolves.toEqual([{
      id: 'tencentdb:opaque-1', kind: 'memory', title: 'preference', content: 'evidence', source: 'tencentdb:atomic:opaque-1',
    }])
  })

  it('selects only the exact workspace and agent-preset binding before any HTTP request', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(requestBody(init))).toMatchObject({
        team_id: 'team-2', agent_id: 'agent-2', user_id: 'user-2',
      })
      return response([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const scoped = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding, {
        workspace: '/workspace/b', agentPreset: 'minimal',
        teamId: 'team-2', agentId: 'agent-2', userId: 'user-2',
      }],
    }, async () => 'secret')

    await expect(scoped.search({ ...request(), workspace: '/workspace/b', agentPreset: 'minimal' }))
      .resolves.toEqual([])
    await expect(scoped.search({ ...request(), workspace: '/workspace/b', agentPreset: 'standard' }))
      .rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    await expect(scoped.search({ ...request(), workspace: '/workspace/unbound' }))
      .rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.stubGlobal('fetch', vi.fn(async () => response([])))
    const unpreset = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [{
        workspace: binding.workspace, teamId: binding.teamId, agentId: binding.agentId, userId: binding.userId,
      }],
    }, async () => 'secret')
    await expect(unpreset.search({
      workspace: binding.workspace, query: 'retry', limit: 2, maxContentBytes: 100,
      signal: new AbortController().signal,
    })).resolves.toEqual([])
  })

  it('rejects ambiguous or incomplete isolation bindings during construction', () => {
    const config = {
      baseUrl: 'http://127.0.0.1:8420', serviceId: 'memory-1', isolationBindings: [binding],
    }
    expect(() => new TencentDbHttpProvider({ ...config, isolationBindings: [] }, async () => undefined))
      .toThrow('isolationBindings must not be empty')
    expect(() => new TencentDbHttpProvider({
      ...config, isolationBindings: [{ ...binding, workspace: 'relative/path' }],
    }, async () => undefined)).toThrow('workspace must be absolute')
    expect(() => new TencentDbHttpProvider({
      ...config, isolationBindings: [binding, { ...binding }],
    }, async () => undefined)).toThrow('duplicates a DSH workspace and agent preset')
    expect(() => new TencentDbHttpProvider({
      ...config,
      isolationBindings: [binding, { ...binding, workspace: '/workspace/../workspace/a', agentPreset: ' standard ' }],
    }, async () => undefined)).toThrow('duplicates a DSH workspace and agent preset')
    expect(() => new TencentDbHttpProvider({
      ...config,
      isolationBindings: [binding, { ...binding, workspace: '/workspace/b', agentPreset: 'minimal' }],
    }, async () => undefined)).toThrow('reuses a Team/Agent profile')
    expect(() => new TencentDbHttpProvider({ ...config, serviceId: ' ' }, async () => undefined))
      .toThrow('serviceId must not be empty')
    expect(() => new TencentDbHttpProvider({
      ...config, isolationBindings: [{ ...binding, agentPreset: ' ' }],
    }, async () => undefined)).toThrow('agentPreset must not be empty')
    expect(() => new TencentDbHttpProvider({
      ...config, isolationBindings: [{ ...binding, teamId: ' ' }],
    }, async () => undefined)).toThrow('identifiers must not be empty')
    expect(() => new TencentDbHttpProvider({
      ...config, isolationBindings: null as unknown as typeof config.isolationBindings,
    }, async () => undefined)).toThrow('isolationBindings must not be empty')
    expect(() => new TencentDbHttpProvider({ ...config, timeoutMs: 0 }, async () => undefined))
      .toThrow('timeoutMs must be a positive integer')
    expect(() => new TencentDbHttpProvider({ ...config, maxResponseBytes: 16_777_217 }, async () => undefined))
      .toThrow('maxResponseBytes must be a positive integer')
  })

  it('retrieves only query-matched L2 scenarios through bounded list and read calls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(requestUrl(input)).pathname
      const body = JSON.parse(requestBody(init)) as Record<string, unknown>
      expect(body).toMatchObject({ team_id: 'team-1', agent_id: 'agent-1', user_id: 'user-1' })
      if (path === '/v3/scenario/ls') {
        return new Response(JSON.stringify({ code: 0, data: { entries: [
          { path: 'retry/', summary: 'Retry directory' },
          { path: 'deploy.md', summary: 'Production retry procedure' },
          { path: 'style.md', summary: 'Writing preferences' },
        ] } }), { status: 200 })
      }
      expect(path).toBe('/v3/scenario/read')
      expect(body.path).toBe('deploy.md')
      return new Response(JSON.stringify({ code: 0, data: { path: 'deploy.md', content: 'Retry production deploy once.' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().search({ ...request(), depth: 'L2' })).resolves.toEqual([{
      id: 'tencentdb:scenario:deploy.md', kind: 'memory', title: 'Production retry procedure',
      content: 'Retry production deploy once.', source: 'tencentdb:scenario:deploy.md',
    }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('handles null and untitled L2 profiles and rejects malformed scenario data', async () => {
    const reads: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(requestUrl(input)).pathname
      const body = JSON.parse(requestBody(init)) as { path?: string }
      if (path === '/v3/scenario/ls') {
        return new Response(JSON.stringify({ code: 0, data: { entries: [
          { path: '', summary: 'retry' },
          { path: 'retry/' },
          { path: 'retry-a.md' },
          { path: 'retry-b.md' },
        ] } }), { status: 200 })
      }
      reads.push(body.path ?? '')
      return new Response(JSON.stringify({
        code: 0, data: { content: body.path === 'retry-a.md' ? null : 'fallback title' },
      }), { status: 200 })
    }))
    await expect(provider().search({ ...request(), depth: 'L2' })).resolves.toEqual([{
      id: 'tencentdb:scenario:retry-b.md', kind: 'memory', title: 'retry-b.md',
      content: 'fallback title', source: 'tencentdb:scenario:retry-b.md',
    }])
    expect(reads).toEqual(['retry-a.md', 'retry-b.md'])

    for (const entries of [undefined, [null], [{ path: 42 }]]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { entries } }), { status: 200 })))
      await expect(provider().search({ ...request(), depth: 'L2' }))
        .rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    }

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({
      code: 0,
      data: requestUrl(input).endsWith('/v3/scenario/ls')
        ? { entries: [{ path: 'retry.md', summary: 'retry' }] }
        : { content: 42 },
    }), { status: 200 })))
    await expect(provider().search({ ...request(), depth: 'L2' }))
      .rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })

  it('applies one timeout to the complete multi-request L2 search', async () => {
    vi.useFakeTimers()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith('/v3/scenario/ls')) {
        return new Response(JSON.stringify({ code: 0, data: { entries: [
          { path: 'retry-a.md', summary: 'retry a' }, { path: 'retry-b.md', summary: 'retry b' },
        ] } }), { status: 200 })
      }
      reads += 1
      if (reads === 1) {
        return new Promise(resolve => setTimeout(() => {
          resolve(new Response(JSON.stringify({
            code: 0, data: { content: 'first' },
          }), { status: 200 }))
        }, 20))
      }
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => {
        const reason: unknown = init.signal?.reason
        reject(reason instanceof Error ? reason : new Error('request aborted', { cause: reason }))
      }, { once: true }))
    }))
    const timed = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding], timeoutMs: 30,
    }, async () => 'secret')
    const pending = timed.search({ ...request(), depth: 'L2' })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(10)
    await rejected
  })

  it('retrieves the singleton L3 core profile and handles an absent profile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0, data: { content: 'User prefers concise answers.' },
    }), { status: 200 })))
    await expect(provider().search({ ...request(), depth: 'L3' })).resolves.toEqual([{
      id: 'tencentdb:core:persona', kind: 'memory', title: 'Core memory',
      content: 'User prefers concise answers.', source: 'tencentdb:core:persona',
    }])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { content: null } }), { status: 200 })))
    await expect(provider().search({ ...request(), depth: 'L3' })).resolves.toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { content: 42 } }), { status: 200 })))
    await expect(provider().search({ ...request(), depth: 'L3' })).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: null }), { status: 200 })))
    await expect(provider().search({ ...request(), depth: 'L3' })).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })

  it('uses the non-secret protocol bearer required by an unprotected loopback Gateway', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-tdai-service-id': 'memory-1', 'Content-Type': 'application/json' })
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer dsh-local-loopback' })
      return requestUrl(_input).endsWith('/v3/atomic/search')
        ? response([])
        : new Response(JSON.stringify({
          code: 0, message: 'ok',
          data: { accepted_ids: ['message-1'], accepted_versions: ['v1'], total_count: 1 },
        }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const local = anonymousProvider()

    await expect(local.provider.search(request())).resolves.toEqual([])
    await expect(local.provider.capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'user', content: 'hello' }], signal: new AbortController().signal,
    })).resolves.toBeUndefined()
    expect(local.resolveCredential).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    'http://127.0.0.2:8420',
    'http://[::1]:8420',
  ])('allows anonymous loopback endpoint %s', (baseUrl) => {
    expect(() => anonymousProvider(baseUrl)).not.toThrow()
  })

  it.each([
    'https://memory.example',
    'http://localhost:8420',
    'http://localhost.example:8420',
    'http://0.0.0.0:8420',
    'http://[::]:8420',
  ])('rejects anonymous non-loopback endpoint %s', (baseUrl) => {
    expect(() => anonymousProvider(baseUrl)).toThrow('credentialRef is required for a non-loopback Gateway')
  })

  it('rejects non-HTTP origins and embedded URL state', () => {
    for (const baseUrl of ['file:///tmp/memory', 'https://user@memory.example', 'https://memory.example/v1', 'https://memory.example?q=1']) {
      expect(() => new TencentDbHttpProvider({
        baseUrl, credentialRef: 'TENCENT_KEY', serviceId: 'memory-1', isolationBindings: [binding],
      }, async () => 'secret-value')).toThrow('must be an HTTP(S) origin')
    }
  })

  it('rejects an empty ref and keeps an explicit unresolved loopback ref unauthorized', async () => {
    expect(() => new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', credentialRef: ' ', serviceId: 'memory-1',
      isolationBindings: [binding],
    }, async () => undefined)).toThrow('credentialRef must not be empty')
    const local = new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', credentialRef: 'MISSING_KEY', serviceId: 'memory-1',
      isolationBindings: [binding],
    }, async () => undefined)
    await expect(local.search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    const empty = new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', credentialRef: 'EMPTY_KEY', serviceId: 'memory-1',
      isolationBindings: [binding],
    }, async () => ' ')
    await expect(empty.search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
  })

  it('rejects an auth header that collides with fixed protocol headers', () => {
    expect(() => new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', serviceId: 'memory-1', isolationBindings: [binding],
      authHeader: 'Content-Type',
    }, async () => undefined)).toThrow('collides with a protocol header')
    expect(() => new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', serviceId: 'memory-1', isolationBindings: [binding],
      authHeader: ' ',
    }, async () => undefined)).toThrow('collides with a protocol header')
    expect(() => new TencentDbHttpProvider({
      baseUrl: 'http://127.0.0.1:8420', serviceId: 'memory-1', isolationBindings: [binding],
      authHeader: 'X-TDAI-Service-ID',
    }, async () => undefined)).toThrow('collides with a protocol header')
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
      isolationBindings: [binding], maxResponseBytes: 4,
    }, async () => 'secret')
    await expect(bounded.search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(provider().search(request(controller.signal))).rejects.toThrow('cancelled')
  })

  it('maps timeout and rejects malformed records without exposing the secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('network'))
      }, 30)
    })))
    const timed = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding], timeoutMs: 1,
    }, async () => 'secret-value')
    await expect(timed.search(request())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 'bad', content: 'x' }])))
    await expect(provider().search(request())).resolves.toMatchObject([{ title: 'Atomic memory' }])

    vi.stubGlobal('fetch', vi.fn(async () => response([], 42)))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => response([null])))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 1, content: 'x' }])))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })

  it('propagates active cancellation and maps ordinary transport failures', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const reason: unknown = init.signal?.reason
        reject(reason instanceof Error ? reason : new Error('request aborted', { cause: reason }))
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = provider().search(request(controller.signal))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    controller.abort(new Error('active cancellation'))
    await expect(pending).rejects.toThrow('active cancellation')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset') }))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' })
    await expect(provider().search({ ...request(), workspace: undefined as unknown as string }))
      .rejects.toBeInstanceOf(TypeError)
  })

  it('observes cancellation that lands while a credential is resolving', async () => {
    let releaseCredential!: (value: string) => void
    const resolveCredential = vi.fn(async () => new Promise<string>((resolve) => { releaseCredential = resolve }))
    const scoped = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding],
    }, resolveCredential)
    const controller = new AbortController()
    const pending = scoped.search(request(controller.signal))
    await vi.waitFor(() => {
      expect(resolveCredential).toHaveBeenCalledOnce()
    })
    controller.abort(new Error('cancelled during credentials'))
    releaseCredential('secret')
    await expect(pending).rejects.toThrow('cancelled during credentials')
  })

  it('rejects unsupported depth and a non-absolute caller workspace', async () => {
    await expect(provider().search({ ...request(), depth: 'L0' }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().search({ ...request(), workspace: 'relative/path' }))
      .rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
  })

  it('captures a scoped DSH session through the v3 conversation route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe('https://memory.example/v3/conversation/add')
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer secret-value', 'x-tdai-service-id': 'memory-1', 'Content-Type': 'application/json',
      })
      expect(JSON.parse(requestBody(init))).toEqual({
        team_id: 'team-1', agent_id: 'agent-1', user_id: 'user-1', session_id: 'dsh-session-1',
        messages: [{ role: 'user', content: 'remember this' }, { role: 'assistant', content: 'noted' }],
      })
      return new Response(JSON.stringify({
        code: 0, message: 'ok', request_id: 'capture-1',
        data: { accepted_ids: ['message-1', 'message-2'], accepted_versions: ['v1', 'v1'], total_count: 2 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().capture({
      ...captureScope,
      sessionId: SessionId('dsh-session-1'),
      messages: [{ role: 'user', content: 'remember this' }, { role: 'assistant', content: 'noted' }],
      signal: new AbortController().signal,
    })).resolves.toBeUndefined()
  })

  it('fails closed for invalid capture input, credentials, envelopes, HTTP failures, cancellation, and timeout', async () => {
    const capture = (overrides: Partial<Parameters<TencentDbHttpProvider['capture']>[0]> = {}) => ({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'user' as const, content: 'hello' }],
      signal: new AbortController().signal, ...overrides,
    })
    await expect(provider().capture(capture({ sessionId: SessionId(' ') }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ sessionId: undefined as unknown as SessionId }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [{ role: 'user', content: ' ' }] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: null as unknown as [] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture(capture({ messages: [{ role: 'user', content: 42 as unknown as string }] }))).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
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
      setTimeout(() => {
        reject(new Error('network'))
      }, 30)
    })))
    const timed = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding], timeoutMs: 1,
    }, async () => 'secret-value')
    await expect(timed.capture(capture())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })
  })

  it('bounds capture request and response sizes', async () => {
    await expect(provider().capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: Array.from({ length: 101 }, () => ({ role: 'user', content: 'x' })),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'user', content: 'x'.repeat(8_193) }],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })

    const boundaryMessages = Array.from({ length: 100 }, (_, index) => ({
      role: 'user' as const, content: index === 0 ? 'x'.repeat(8_192) : 'x',
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0, message: 'ok', request_id: 'capture-boundary',
      data: {
        accepted_ids: boundaryMessages.map((_, index) => `message-${String(index)}`),
        accepted_versions: boundaryMessages.map(() => 'v1'),
        total_count: boundaryMessages.length,
      },
    }), { status: 200 })))
    await expect(provider().capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: boundaryMessages, signal: new AbortController().signal,
    })).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('1234567890', { status: 200 })))
    const bounded = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [binding], maxResponseBytes: 4,
    }, async () => 'secret')
    await expect(bounded.capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'assistant', content: 'ok' }], signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })

    const hugeScope = new TencentDbHttpProvider({
      baseUrl: 'https://memory.example', credentialRef: 'TENCENT_KEY', serviceId: 'memory-1',
      isolationBindings: [{ ...binding, teamId: 'x'.repeat(1_048_576) }],
    }, async () => 'secret')
    await expect(hugeScope.capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'user', content: 'x' }],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
  })

  it('rejects malformed conversation acceptance details', async () => {
    const capture = () => provider().capture({
      ...captureScope, sessionId: SessionId('session-1'), messages: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
    })
    for (const data of [
      {},
      { accepted_ids: [], accepted_versions: [], total_count: 0 },
      { accepted_ids: ['message-1'], accepted_versions: [], total_count: 1 },
      { accepted_ids: [''], accepted_versions: ['v1'], total_count: 1 },
      { accepted_ids: ['message-1'], accepted_versions: [''], total_count: 1 },
      { accepted_ids: ['message-1'], accepted_versions: ['v1'], total_count: 2 },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data }), { status: 200 })))
      await expect(capture()).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    }
  })
})
