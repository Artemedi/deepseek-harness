/** Opt-in risk-based independent review policy for tool execution. */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { CrossReviewConfig, CrossReviewRecord, RiskClass, ReviewDecision } from './types.ts'

export type * from './types.ts'

export const name = 'cross-review'
export const inject = ['tools', 'subagents', 'sessions']

export const Config: z<CrossReviewConfig> = z.object({
  rules: z.dict(z.union(['code-change', 'security', 'sensitive-data', 'infrastructure', 'cost', 'production'])).default({}),
  requireReviewFor: z.array(z.union(['code-change', 'security', 'sensitive-data', 'infrastructure', 'cost', 'production'])).default([
    'code-change', 'security', 'sensitive-data', 'infrastructure', 'cost', 'production',
  ]),
  reviewerSubagentProvider: z.string().default('spawn'),
  reviewerProvider: z.string().required(),
  reviewerModel: z.string().required(),
  reviewerPersona: z.string().default('You are an independent adversarial reviewer. Return only the requested JSON verdict.'),
  reviewerAllowedTools: z.array(z.string()).default([]),
  maxEvidenceBytes: z.number().step(1).min(1).max(65_536).default(16_384),
  maxReasonBytes: z.number().step(1).min(1).max(8_192).default(1_024),
  failClosedOnUnavailable: z.boolean().default(true),
})

type ResolvedConfig = Required<CrossReviewConfig>

const REVIEW_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['approved', 'rejected', 'needs-review'] },
    reason: { type: 'string' },
  },
  required: ['decision', 'reason'],
}

const DECISIONS = new Set<ReviewDecision>(['approved', 'rejected', 'needs-review', 'unavailable'])

function classify(config: ResolvedConfig, name: string): RiskClass | undefined {
  return config.rules[name]
}

function recordFor(session: { events: readonly SessionEvent[] }, callId: string): CrossReviewRecord | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === undefined || event.type !== 'cross-review/evaluated') continue
    if (event.data.callId === callId) return event.data
  }
  return undefined
}

function evidence(exec: ToolExecution, maxBytes: number): string | undefined {
  const value = JSON.stringify({ tool: exec.name, call_id: String(exec.callId), arguments: exec.arguments })
  return Buffer.byteLength(value, 'utf8') <= maxBytes ? value : undefined
}

function boundedReason(value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined) return undefined
  return Buffer.byteLength(value, 'utf8') <= maxBytes ? value : 'reviewer reason exceeds configured byte limit'
}

function reviewPrompt(evidenceJson: string, risk: RiskClass): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify({
    task: 'Review whether this tool action is safe and justified before execution.',
    risk,
    evidence: JSON.parse(evidenceJson),
    output: { decision: 'approved|rejected|needs-review', reason: 'bounded explanation' },
  }) }]
}

function decisionFrom(result: SubagentResult): { decision: ReviewDecision; reason?: string } {
  if (result.stopReason !== 'completed') return { decision: 'unavailable', reason: result.diagnostic ?? `reviewer stopped: ${result.stopReason}` }
  const value = result.structured
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { decision: 'unavailable', reason: 'reviewer returned no structured verdict' }
  const candidate = value as Record<string, unknown>
  const decision = candidate.decision
  const reason = candidate.reason
  if ((decision !== 'approved' && decision !== 'rejected' && decision !== 'needs-review') || typeof reason !== 'string') {
    return { decision: 'unavailable', reason: 'reviewer returned an invalid verdict' }
  }
  return { decision, reason }
}

function denied(reason: string): string {
  return `cross-review denied tool execution: ${reason}`
}

/** Register risk classification, independent review, durable evidence, and fail-closed guard. */
export function apply(ctx: Context, input: CrossReviewConfig = {}): void {
  const config: ResolvedConfig = {
    rules: input.rules ?? {},
    requireReviewFor: input.requireReviewFor ?? ['code-change', 'security', 'sensitive-data', 'infrastructure', 'cost', 'production'],
    reviewerSubagentProvider: input.reviewerSubagentProvider ?? 'spawn',
    reviewerProvider: input.reviewerProvider as string,
    reviewerModel: input.reviewerModel as string,
    reviewerPersona: input.reviewerPersona ?? 'You are an independent adversarial reviewer. Return only the requested JSON verdict.',
    reviewerAllowedTools: input.reviewerAllowedTools ?? [],
    maxEvidenceBytes: input.maxEvidenceBytes ?? 16_384,
    maxReasonBytes: input.maxReasonBytes ?? 1_024,
    failClosedOnUnavailable: input.failClosedOnUnavailable ?? true,
  }
  if (config.reviewerProvider.length === 0 || config.reviewerModel.length === 0) {
    throw new Error('cross-review reviewerProvider and reviewerModel are required')
  }
  const requires = new Set(config.requireReviewFor)

  ctx.on('tools/pre-execute', async (exec, next) => {
    const risk = classify(config, exec.name)
    if (risk === undefined || !requires.has(risk) || exec.agent === undefined) return next()
    if (recordFor(exec.agent.session, String(exec.callId)) !== undefined) return next()
    const evidenceJson = evidence(exec, config.maxEvidenceBytes)
    let result: { decision: ReviewDecision; reason?: string }
    let reviewerRunId: string | undefined
    if (evidenceJson === undefined) {
      result = { decision: 'unavailable', reason: 'tool evidence exceeds configured byte limit' }
    } else if (exec.agent.options.provider === config.reviewerProvider && exec.agent.options.model === config.reviewerModel) {
      result = { decision: 'unavailable', reason: 'reviewer route matches executor route' }
    } else try {
      const run = await ctx.subagents.start(config.reviewerSubagentProvider, {
        label: `cross-review:${exec.name}`,
        parent: exec.agent,
        prompt: reviewPrompt(evidenceJson, risk),
        signal: exec.signal,
        agentOptions: { provider: config.reviewerProvider, model: config.reviewerModel } satisfies AgentOptions,
        outputSchema: REVIEW_SCHEMA,
        persona: config.reviewerPersona,
        toolFilter: { allow: [...config.reviewerAllowedTools] },
      })
      reviewerRunId = String(run.id)
      try {
        result = decisionFrom(await run.result)
      } finally {
        await run.dispose()
      }
    } catch (error: unknown) {
      result = { decision: 'unavailable', reason: error instanceof Error ? error.message : 'reviewer unavailable' }
    }
    const reason = boundedReason(result.reason, config.maxReasonBytes)
    exec.agent.session.append('cross-review/evaluated', {
      version: 1,
      callId: String(exec.callId),
      toolName: exec.name,
      risk,
      decision: result.decision,
      ...(reviewerRunId === undefined ? {} : { reviewerRunId }),
      ...(reason === undefined ? {} : { reason }),
    })
    await ctx.sessions.flush(exec.agent.session)
    return next()
  })

  const guard: ToolGuard = exec => {
    const risk = classify(config, exec.name)
    if (risk === undefined || !requires.has(risk)) return undefined
    if (exec.agent === undefined) return denied('no owning agent is available for review')
    const record = recordFor(exec.agent.session, String(exec.callId))
    if (record === undefined) return denied('review record is missing')
    if (record.decision === 'approved') return undefined
    if (record.decision === 'unavailable' && !config.failClosedOnUnavailable) return undefined
    return denied(record.reason ?? `review decision is ${record.decision}`)
  }
  ctx.tools.guard(guard)
}

export { DECISIONS }
