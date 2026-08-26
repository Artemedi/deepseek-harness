/** Explicit model-facing pairwise verifier consumer. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-experimental-verifier'

/** Cordis plugin name. */
export const name = 'tool-verifier'
/** Required capability seams. */
export const inject = ['tools', 'verifier']

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schema_version: { type: 'string', required: true },
    probability_left: { type: 'number', required: true },
    rationale: { type: 'string', required: true },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): { schema: S; render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }] } {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Register the explicit JSON-only pairwise verifier tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'verify_pair',
    description: 'Compare two candidate evidence records against an explicit rubric through the opt-in JSON verifier. Use only after deterministic checks; a score is not correctness proof.',
    parameters: {
      rubric: { type: 'string', required: true, description: 'Concrete criteria used for the comparison.' },
      left_id: { type: 'string', required: true, description: 'Stable id of the left candidate.' },
      left_evidence: { type: 'string', required: true, description: 'Bounded deterministic evidence for the left candidate.' },
      right_id: { type: 'string', required: true, description: 'Stable id of the right candidate.' },
      right_evidence: { type: 'string', required: true, description: 'Bounded deterministic evidence for the right candidate.' },
    },
    output: jsonOutput(OUTPUT_SCHEMA),
    timeoutMs: 35_000,
    async execute(args, exec) {
      const result = await ctx.verifier.compare({
        rubric: args.rubric,
        left: { id: args.left_id, evidence: args.left_evidence },
        right: { id: args.right_id, evidence: args.right_evidence },
        signal: exec.signal,
      })
      return { schema_version: result.schemaVersion, probability_left: result.probabilityLeft, rationale: result.rationale }
    },
  }))
}
