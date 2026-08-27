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
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(provider(async () => undefined).search(request())).rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })

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
})
