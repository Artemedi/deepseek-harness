/** Model-facing explicit memory search consumer. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-experimental-memory'

/** Cordis plugin name. */
export const name = 'tool-memory'
/** Service and registry dependencies. */
export const inject = ['memory', 'tools']

const HIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    sessionId: { type: 'string' },
    seq: { type: 'integer' },
    eventType: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    source: { type: 'string' },
    content: { type: 'string', required: true },
  },
} as const

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    workspace: { type: 'string', required: true },
    hits: { type: 'array', required: true, items: HIT_SCHEMA },
  },
} as const

/** Register the explicit memory_search tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search prior workspace session history for explicit, cited memory. Results are recorded for replay before they are returned.',
    parameters: {
      query: { type: 'string', required: true, description: 'Literal search text.' },
      limit: { type: 'integer', description: 'Maximum citations, from 1 through 20.' },
      max_content_bytes: { type: 'integer', description: 'Maximum UTF-8 bytes across returned citation text.' },
      provider: { type: 'string', description: 'Explicit provider: local, tencentdb, or openviking.' },
      depth: { type: 'string', description: 'Memory layer: OpenViking requires L0-L2; TencentDB accepts L1-L3.' },
    },
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('memory_search requires a calling Agent')
      const provider = args.provider
      if (provider !== undefined && provider !== 'local' && provider !== 'tencentdb' && provider !== 'openviking') {
        throw new Error('memory_search provider must be local, tencentdb, or openviking')
      }
      const depth = args.depth
      if (depth !== undefined && depth !== 'L0' && depth !== 'L1' && depth !== 'L2' && depth !== 'L3') {
        throw new Error('memory_search depth must be L0, L1, L2, or L3')
      }
      const result = await ctx.memory.search(agent, {
        query: args.query.trim(),
        ...args.limit === undefined ? {} : { limit: args.limit },
        ...args.max_content_bytes === undefined ? {} : { maxContentBytes: args.max_content_bytes },
        ...provider === undefined ? {} : { provider },
        ...depth === undefined ? {} : { depth },
        signal: exec.signal,
      })
      agent.session.append('memory/search', {
        version: 1,
        provider: result.provider,
        workspace: result.workspace,
        query: args.query.trim(),
        hits: result.hits,
      })
      return {
        provider: result.provider,
        workspace: result.workspace,
        hits: result.hits.map(hit => ({
          ...hit,
          id: String(hit.id),
          ...hit.sessionId === undefined ? {} : { sessionId: String(hit.sessionId) },
        })),
      }
    },
  }))
}
