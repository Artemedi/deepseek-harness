import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenVikingHttpProvider from '../src/openviking-http.ts'

const request = (depth: 'L0' | 'L1' | 'L2' = 'L1', signal = new AbortController().signal) => ({
  workspace: '/workspace/a', query: 'retry', limit: 2, maxContentBytes: 100, depth, signal,
})

const response = (result: unknown) => new Response(JSON.stringify({ result }), {
  status: 200, headers: { 'content-type': 'application/json' },
})

function provider(resolveCredential: (ref: string) => Promise<string | undefined> = async ref => ref === 'OPENVIKING_KEY' ? 'secret-value' : undefined) {
  return new OpenVikingHttpProvider({ baseUrl: 'https://viking.example', credentialRef: 'OPENVIKING_KEY', targetUri: 'viking://workspace/a' }, resolveCredential)
}

describe('OpenVikingHttpProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects invalid origins and empty optional authority values', () => {
    expect(() => new OpenVikingHttpProvider({ baseUrl: 'viking://memory.example' }, async () => undefined))
      .toThrow('must be an HTTP(S) origin')
    expect(() => new OpenVikingHttpProvider({ baseUrl: 'https://memory.example/path' }, async () => undefined))
      .toThrow('must be an HTTP(S) origin')
    expect(() => new OpenVikingHttpProvider({ baseUrl: 'https://memory.example', credentialRef: ' ' }, async () => undefined))
      .toThrow('credentialRef must not be empty')
    expect(() => new OpenVikingHttpProvider({ baseUrl: 'https://memory.example', targetUri: ' ' }, async () => undefined))
      .toThrow('targetUri must not be empty')
  })

  it('sends the confirmed find envelope and maps bounded records at requested depth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://viking.example/api/v1/search/find')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-value', 'X-API-Key': 'secret-value' })
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'retry', limit: 2, target_uri: 'viking://workspace/a' })
      return response({ memories: [{ uri: 'viking://workspace/a/retry', abstract: 'retry evidence', title: 'Retry' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search(request())).resolves.toEqual([{
      id: 'openviking:viking://workspace/a/retry', kind: 'resource', title: 'Retry',
      source: 'viking://workspace/a/retry', content: 'retry evidence',
    }])
  })

  it('supports keyless deployments without sending auth headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      return response({ resources: [{ uri: 'viking://public/retry', abstract: 'public evidence' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const keyless = new OpenVikingHttpProvider({ baseUrl: 'https://viking.example' }, async () => undefined)
    await expect(keyless.search(request('L0'))).resolves.toMatchObject([{ source: 'viking://public/retry', content: 'public evidence' }])
  })

  it('fails closed for missing depth, credentials, malformed responses, HTTP failures, bounds, and cancellation', async () => {
    const fetchMock = vi.fn(async () => response({ memories: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const noDepth = { workspace: '/workspace/a', query: 'retry', limit: 2, maxContentBytes: 100, signal: new AbortController().signal }
    await expect(provider().search(noDepth)).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(provider().search({ ...request(), depth: 'L3' })).rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(provider(async () => undefined).search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    await expect(provider(async () => ' ').search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_RETRYABLE' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{oops', { status: 200 })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ memories: [{ uri: 'viking://x', abstract: 'x' }] })))
    const bounded = new OpenVikingHttpProvider({ baseUrl: 'https://viking.example', maxResponseBytes: 4 }, async () => undefined)
    await expect(bounded.search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(new OpenVikingHttpProvider({ baseUrl: 'https://viking.example' }, async () => undefined).search(request('L1', controller.signal))).rejects.toThrow('cancelled')
  })

  it('propagates active cancellation and maps an ordinary transport failure', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = provider().search(request('L1', controller.signal))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(new Error('active cancellation'))
    await expect(pending).rejects.toThrow('active cancellation')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset') }))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_UNAVAILABLE' })
  })

  it('maps timeout and rejects malformed records without exposing the secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => reject(new Error('network')), 30)
    })))
    const timed = new OpenVikingHttpProvider({ baseUrl: 'https://viking.example', credentialRef: 'OPENVIKING_KEY', timeoutMs: 1 }, async () => 'secret-value')
    const error = await timed.search(request()).catch(value => value as Error & { code?: string })
    expect(error).toMatchObject({ code: 'MEMORY_RETRYABLE' })
    expect(error instanceof Error).toBe(true)
    expect((error as Error).message).not.toContain('secret-value')

    vi.stubGlobal('fetch', vi.fn(async () => response({ memories: [{ uri: 'viking://bad' }] })))
    await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })

  it('rejects malformed result containers and collections', async () => {
    for (const raw of [
      'null',
      '[]',
      JSON.stringify({ result: null }),
      JSON.stringify({ result: [] }),
      JSON.stringify({ result: { memories: {} } }),
      JSON.stringify({ result: { memories: [null] } }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(raw, { status: 200 })))
      await expect(provider().search(request())).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    }
  })
})
