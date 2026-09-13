import { describe, expect, it, vi } from 'vitest'
import { parseRemoteMemoryOrigin, readBoundedResponseText, resolveRemoteMemoryLimit } from '../src/http-response.ts'

describe('bounded remote memory responses', () => {
  it('accepts only a bare HTTP(S) origin', () => {
    expect(parseRemoteMemoryOrigin('https://memory.example/', 'TencentDB').origin).toBe('https://memory.example')
    for (const value of ['not a URL', 'file:///tmp/memory', 'https://user@memory.example', 'https://memory.example/v1', 'https://memory.example?q=1']) {
      expect(() => parseRemoteMemoryOrigin(value, 'TencentDB')).toThrow('must be an HTTP(S) origin')
    }
  })

  it('validates direct-constructor HTTP limits against the composition bounds', () => {
    expect(resolveRemoteMemoryLimit(undefined, 30_000, 300_000, 'TencentDB', 'timeoutMs')).toBe(30_000)
    for (const value of [0, 1.5, Number.NaN, 300_001]) {
      expect(() => resolveRemoteMemoryLimit(value, 30_000, 300_000, 'TencentDB', 'timeoutMs'))
        .toThrow('must be a positive integer no greater than 300000')
    }
  })

  it('cancels a streaming body as soon as decoded bytes exceed the limit', async () => {
    const cancel = vi.fn(() => { throw new Error('transport cancel failed') })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('123'))
        controller.enqueue(new TextEncoder().encode('456'))
      },
      cancel,
    })

    await expect(readBoundedResponseText(new Response(body), 4, 'TencentDB'))
      .rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('decodes a response whose aggregate UTF-8 byte length is exactly the limit', async () => {
    await expect(readBoundedResponseText(new Response('éa', {
      headers: { 'content-length': '3' },
    }), 3, 'OpenViking')).resolves.toBe('éa')
  })

  it('rejects declared overflow before reading and accepts an absent body', async () => {
    const cancel = vi.fn(() => { throw new Error('transport cancel failed') })
    const oversized = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-length': '5' },
    })
    await expect(readBoundedResponseText(oversized, 4, 'TencentDB'))
      .rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
    expect(cancel).toHaveBeenCalledOnce()

    await expect(readBoundedResponseText(new Response(null), 4, 'TencentDB')).resolves.toBe('')
    await expect(readBoundedResponseText(new Response(null, {
      headers: { 'content-length': '5' },
    }), 4, 'TencentDB')).rejects.toMatchObject({ code: 'MEMORY_PROVIDER_ERROR' })
  })
})
