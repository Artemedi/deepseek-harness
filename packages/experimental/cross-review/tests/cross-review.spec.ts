import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type ResolvedSubagentStartRequest, type SubagentCapabilities, type SubagentProvider, type SubagentResult, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as CrossReview from '../src/index.ts'

const ALL_CAPS: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }

class ReviewerProvider implements SubagentProvider {
  readonly name = 'reviewer-transport'
  readonly inheritsParentContext = false
  readonly capabilities = ALL_CAPS
  lastRequest: ResolvedSubagentStartRequest | undefined

  constructor(private readonly outcome: SubagentResult) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.lastRequest = request
    return { id: SessionId('reviewer-child'), localAgent: undefined, result: Promise.resolve(this.outcome), async dispose() {} }
  }
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function setup(outcome: SubagentResult) {
  const context = new Context()
  ctx = context
  await context.plugin(SessionStore)
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(SubagentRuntime)
  const reviewer = new ReviewerProvider(outcome)
  context.subagents.registerProvider(reviewer)
  await context.plugin(CrossReview, {
    reviewerSubagentProvider: reviewer.name,
    reviewerProvider: 'independent-route',
    reviewerModel: 'review-model',
    rules: { change: 'code-change' },
    reviewerAllowedTools: [],
  })
  const session = context.sessions.create(SessionId('parent'))
  const agent = { id: session.id, session, options: { provider: 'executor-route', model: 'executor-model' } } as unknown as Agent
  return { context, reviewer, session, agent }
}

function execute(context: Context, agent: Agent) {
  return context.tools.execute({ callId: CallId('change-1'), signal: new AbortController().signal, name: 'change', arguments: { path: 'a.ts' }, agent })
}

describe('cross-review', () => {
  it('runs an independent reviewer, records approval, and dispatches the tool body', async () => {
    const { context, reviewer, session, agent } = await setup({ output: [], structured: { decision: 'approved', reason: 'tests pass' }, stopReason: 'completed' })
    const body = vi.fn(async () => 'changed')
    context.tools.register(defineTool({
      name: 'change', description: 'change a source file', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: body,
    }))

    const result = await execute(context, agent)

    expect(result).toMatchObject({ isError: false, value: 'changed' })
    expect(body).toHaveBeenCalledOnce()
    expect(reviewer.lastRequest).toMatchObject({ agentOptions: { provider: 'independent-route', model: 'review-model' }, toolFilter: { allow: [] } })
    expect(session.events).toContainEqual(expect.objectContaining({ type: 'cross-review/evaluated', data: expect.objectContaining({ callId: 'change-1', decision: 'approved', risk: 'code-change' }) }))
  })

  it('fails closed and prevents the tool body when the reviewer rejects', async () => {
    const { context, session, agent } = await setup({ output: [], structured: { decision: 'rejected', reason: 'missing rollback plan' }, stopReason: 'completed' })
    const body = vi.fn(async () => 'changed')
    context.tools.register(defineTool({
      name: 'change', description: 'change a source file', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: body,
    }))

    const result = await execute(context, agent)

    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([{ type: 'text', text: 'Error: cross-review denied tool execution: missing rollback plan' }])
    expect(body).not.toHaveBeenCalled()
    expect(session.events).toContainEqual(expect.objectContaining({ type: 'cross-review/evaluated', data: expect.objectContaining({ callId: 'change-1', decision: 'rejected' }) }))
  })
})
