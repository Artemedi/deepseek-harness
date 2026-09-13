/** Opt-in OpenAI-compatible JSON-only pairwise verifier service. */

import { Buffer } from 'node:buffer'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { VerifierCompareRequest, VerifierCompareResult, VerifierProvider } from './types.ts'

export type * from './types.ts'

const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schema_version: { type: 'string' },
    probability_left: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['schema_version', 'probability_left', 'rationale'],
} as const

/** Loader configuration for the Mistral-first verifier provider. */
export interface Config {
  /** OpenAI-compatible endpoint, with or without a trailing `/v1`. */
  baseUrl?: string
  /** Model pinned for comparison. */
  model?: string
  /** Credential reference resolved through `ctx.credentials` for every request. */
  apiKeyEnv?: string
  /** Fixed output budget for equal-budget comparisons. */
  maxTokens?: number
  /** Per-request network deadline. */
  timeoutMs?: number
  /** Maximum evidence bytes accepted for each candidate. */
  maxEvidenceBytes?: number
  /** Maximum UTF-8 rationale bytes retained in the result. */
  maxRationaleBytes?: number
}

/** Validated scorer configuration. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default('https://api.mistral.ai/v1'),
  model: z.string().default('mistral-small-2603'),
  apiKeyEnv: z.string().default('MISTRAL_API_KEY'),
  maxTokens: z.number().step(1).min(1).max(4096).default(64),
  timeoutMs: z.number().step(1).min(1).max(300_000).default(30_000),
  maxEvidenceBytes: z.number().step(1).min(1).max(65_536).default(16_384),
  maxRationaleBytes: z.number().step(1).min(1).max(8_192).default(1_024),
})

type ResolvedConfig = Required<Config>

/** A verifier request failed before a schema-valid result was available. */
export class VerifierError extends Error {
  constructor(message: string, readonly code: 'UNCONFIGURED' | 'REQUEST_FAILED' | 'INVALID_RESPONSE' | 'INVALID_REQUEST') {
    super(message)
    this.name = 'VerifierError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { verifier: VerifierService }
}

function boundedText(value: string, maxBytes: number, field: string): string {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes > maxBytes) throw new VerifierError(`${field} exceeds ${String(maxBytes)} UTF-8 bytes`, 'INVALID_REQUEST')
  return value
}

function responseValue(value: unknown, maxRationaleBytes: number): VerifierCompareResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new VerifierError('verifier response must be an object', 'INVALID_RESPONSE')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 3 || keys.some(key => !['schema_version', 'probability_left', 'rationale'].includes(key))) {
    throw new VerifierError('verifier response has unexpected fields', 'INVALID_RESPONSE')
  }
  if (record.schema_version !== 'score-v1' || typeof record.probability_left !== 'number' || !Number.isFinite(record.probability_left)
    || record.probability_left < 0 || record.probability_left > 1 || typeof record.rationale !== 'string') {
    throw new VerifierError('verifier response does not satisfy score-v1', 'INVALID_RESPONSE')
  }
  return { schemaVersion: 'score-v1', probabilityLeft: record.probability_left, rationale: boundedText(record.rationale, maxRationaleBytes, 'verifier rationale') }
}

/** One opt-in explicit verifier provider. */
export default class VerifierService extends Service implements VerifierProvider {
  static inject = ['credentials']
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'verifier')
    this.config = {
      baseUrl: config.baseUrl ?? 'https://api.mistral.ai/v1',
      model: config.model ?? 'mistral-small-2603',
      apiKeyEnv: config.apiKeyEnv ?? 'MISTRAL_API_KEY',
      maxTokens: config.maxTokens ?? 64,
      timeoutMs: config.timeoutMs ?? 30_000,
      maxEvidenceBytes: config.maxEvidenceBytes ?? 16_384,
      maxRationaleBytes: config.maxRationaleBytes ?? 1_024,
    }
  }

  /**
   * Compare two bounded evidence records through the configured JSON-only provider.
   *
   * @param request - Pairwise evidence and cancellation signal.
   * @returns The validated provider preference.
   */
  async compare(request: VerifierCompareRequest): Promise<VerifierCompareResult> {
    if (request.signal.aborted) throw request.signal.reason
    const rubric = boundedText(request.rubric, this.config.maxEvidenceBytes, 'verifier rubric')
    const left = { id: boundedText(request.left.id, 512, 'left candidate id'), evidence: boundedText(request.left.evidence, this.config.maxEvidenceBytes, 'left evidence') }
    const right = { id: boundedText(request.right.id, 512, 'right candidate id'), evidence: boundedText(request.right.evidence, this.config.maxEvidenceBytes, 'right evidence') }
    if (left.id === right.id) throw new VerifierError('verifier candidates must have distinct ids', 'INVALID_REQUEST')
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.apiKeyEnv))
    if (credential === undefined) throw new VerifierError(`verifier credential ${this.config.apiKeyEnv} is not configured`, 'UNCONFIGURED')
    const controller = new AbortController()
    const deadline = setTimeout(() => {
      controller.abort(new Error('verifier request timed out'))
    }, this.config.timeoutMs)
    const abort = () => {
      controller.abort(request.signal.reason)
    }
    request.signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${credential.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, temperature: 0, max_tokens: this.config.maxTokens, response_format: { type: 'json_schema', json_schema: { name: 'score_v1', strict: true, schema: RESPONSE_SCHEMA } }, messages: [{ role: 'user', content: JSON.stringify({ rubric, left, right }) }] }),
      })
      if (!response.ok) throw new VerifierError(`verifier provider returned HTTP ${String(response.status)}`, 'REQUEST_FAILED')
      const envelope: unknown = await response.json()
      const content = (envelope as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
      let value: unknown
      try { value = typeof content === 'string' ? JSON.parse(content) : content } catch { throw new VerifierError('verifier response content is not JSON', 'INVALID_RESPONSE') }
      return responseValue(value, this.config.maxRationaleBytes)
    } catch (error: unknown) {
      if (error instanceof VerifierError) throw error
      request.signal.throwIfAborted()
      throw new VerifierError('verifier provider request failed', 'REQUEST_FAILED')
    } finally {
      clearTimeout(deadline)
      request.signal.removeEventListener('abort', abort)
    }
  }
}
