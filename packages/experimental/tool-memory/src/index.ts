/** Model-facing explicit memory search consumer. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-experimental-memory'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Cordis plugin name. */
export const name = 'tool-memory'
/** Service and registry dependencies. */
export const inject = ['memory', 'tools']

const HIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    seq: { type: 'integer', required: true },
    eventType: { type: 'string', required: true },
    content: { type: 'string', required: true },
  },
} as const

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true, const: 'local-session-query' },
    workspace: { type: 'string', required: true },
    hits: { type: 'array', required: true, items: HIT_SCHEMA },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('memory_search requires a calling Agent')
  return agent
}

/** Register the explicit memory_search tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search prior workspace session history for explicit, cited memory. Results are recorded for replay before they are returned.',
    parameters: {
      query: { type: 'string', required: true, description: 'Literal search text.' },
      limit: { type: 'integer', description: 'Maximum citations, from 1 through 20.' },
      max_content_bytes: { type: 'integer', description: 'Maximum UTF-8 bytes across returned citation text.' },
    },
    output: jsonOutput(SEARCH_OUTPUT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent)
      const result = await ctx.memory.search(agent, {
        query: args.query,
        ...args.limit === undefined ? {} : { limit: args.limit },
        ...args.max_content_bytes === undefined ? {} : { maxContentBytes: args.max_content_bytes },
        signal: exec.signal,
      })
      agent.session.append('memory/search', {
        version: 1,
        provider: result.provider,
        workspace: result.workspace,
        query: args.query,
        hits: result.hits,
      })
      return {
        provider: result.provider,
        workspace: result.workspace,
        hits: result.hits.map(hit => ({ ...hit, id: String(hit.id), sessionId: String(hit.sessionId) })),
      }
    },
  }))
}
