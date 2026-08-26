import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import VerifierService from '@deepseek-ai/dsh-experimental-verifier'
import * as ToolVerifier from '@deepseek-ai/dsh-experimental-tool-verifier'
import ToolRuntime from '@deepseek-ai/dsh-tools'

let ctx: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('explicit verifier tool', () => {
  it('executes through the real tool registry and returns canonical score JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ schema_version: 'score-v1', probability_left: 0.9, rationale: 'left test passes' }) } }],
    }), { status: 200 })))
    const context = new Context()
    ctx = context
    await context.plugin(AgentRegistry)
    await context.plugin(MemoryCredentials, { MISTRAL_API_KEY: 'test-key' })
    await context.plugin(VerifierService)
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    await context.plugin(ToolVerifier)
    const result = await context.tools.execute({
      callId: CallId('verify-pair'), signal: new AbortController().signal, name: 'verify_pair',
      arguments: { rubric: 'prefer passing tests', left_id: 'left', left_evidence: 'test exit 0', right_id: 'right', right_evidence: 'test exit 1' },
    })
    expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: JSON.stringify({ schema_version: 'score-v1', probability_left: 0.9, rationale: 'left test passes' }) }] })
  })

  it('returns a tool error when the verifier credential is unavailable', async () => {
    const context = new Context()
    ctx = context
    await context.plugin(AgentRegistry)
    await context.plugin(MemoryCredentials)
    await context.plugin(VerifierService)
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    await context.plugin(ToolVerifier)
    const result = await context.tools.execute({
      callId: CallId('verify-missing'), signal: new AbortController().signal, name: 'verify_pair',
      arguments: { rubric: 'x', left_id: 'left', left_evidence: 'x', right_id: 'right', right_evidence: 'y' },
    })
    expect(result).toMatchObject({ isError: true })
  })
})
