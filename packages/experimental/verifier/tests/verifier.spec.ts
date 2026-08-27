import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import VerifierService from '../src/index.ts'

const response = (value: unknown, status = 200): Response => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(value) } }],
}), { status, headers: { 'content-type': 'application/json' } })

async function setup(seed: Record<string, string> = { MISTRAL_API_KEY: 'test-key' }): Promise<{ ctx: Context; service: VerifierService }> {
  const ctx = new Context()
  const agents = ctx.plugin(AgentRegistry)
  await agents.await()
  const credentials = ctx.plugin(MemoryCredentials, seed)
  await credentials.await()
  const verifier = ctx.plugin(VerifierService)
  await verifier.await()
  return { ctx, service: ctx.get('verifier')! }
}

const request = (overrides: Partial<Parameters<VerifierService['compare']>[0]> = {}) => ({
  rubric: 'prefer the candidate with passing tests',
  left: { id: 'left', evidence: 'tests pass' },
  right: { id: 'right', evidence: 'tests fail' },
  signal: new AbortController().signal,
  ...overrides,
})

describe('VerifierService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends strict JSON schema and returns a validated score', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; response_format: unknown }
      expect(body.model).toBe('mistral-small-2603')
      expect(body.max_tokens).toBe(64)
      expect(body.response_format).toMatchObject({ type: 'json_schema' })
      return response({ schema_version: 'score-v1', probability_left: 0.85, rationale: 'tests pass' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, service } = await setup()
    await expect(service.compare(request())).resolves.toEqual({ schemaVersion: 'score-v1', probabilityLeft: 0.85, rationale: 'tests pass' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('fails closed for missing credentials, invalid responses, and oversized evidence', async () => {
    const missing = await setup({})
    await expect(missing.service.compare(request())).rejects.toMatchObject({ code: 'UNCONFIGURED' })
    await missing.ctx.fiber.dispose()

    vi.stubGlobal('fetch', vi.fn(async () => response({ schema_version: 'wrong', probability_left: 0.5, rationale: 'x' })))
    const invalid = await setup()
    await expect(invalid.service.compare(request())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await invalid.ctx.fiber.dispose()

    const bounded = await setup()
    await expect(bounded.service.compare(request({ left: { id: 'left', evidence: 'x'.repeat(20_000) } })))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await bounded.ctx.fiber.dispose()
  })

  it('rejects duplicate candidates and provider failures without exposing response bodies', async () => {
    const { ctx, service } = await setup()
    await expect(service.compare(request({ right: { id: 'left', evidence: 'same' } })))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ secret: 'never include this' }, 502)))
    await expect(service.compare(request())).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
    await ctx.fiber.dispose()
  })

  it('rejects redirects before contacting another origin', async () => {
    const { ctx, service } = await setup()
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(service.compare(request())).rejects.toMatchObject({ code: 'REQUEST_FAILED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })
})
