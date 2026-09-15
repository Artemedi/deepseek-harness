/** Public vocabulary for the opt-in cross-review policy. */

/** Risk level assigned to a configured tool action. */
export type RiskClass = 'code-change' | 'security' | 'sensitive-data' | 'infrastructure' | 'cost' | 'production'

/** Structured conclusion returned by the independent reviewer. */
export type ReviewDecision = 'approved' | 'rejected' | 'needs-review' | 'unavailable'

/** Immutable evidence recorded for one reviewed tool call. */
export interface CrossReviewRecord {
  readonly version: 1
  readonly callId: string
  readonly toolName: string
  readonly risk: RiskClass
  readonly decision: ReviewDecision
  readonly reviewerRunId?: string
  readonly reason?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only review result; never enters derived model history. */
    'cross-review/evaluated': CrossReviewRecord
  }
}

/** Loader configuration for risk classification and independent review. */
export interface CrossReviewConfig {
  /** Exact tool names and their risk classes. */
  rules?: Record<string, RiskClass>
  /** Risk classes that require a completed independent review. */
  requireReviewFor?: RiskClass[]
  /** Provider used to create the reviewer child run. */
  reviewerSubagentProvider?: string
  /** LLM provider route used inside the reviewer child. */
  reviewerProvider?: string
  /** Model used for the reviewer child run. */
  reviewerModel?: string
  /** Persona shown only to the reviewer child. */
  reviewerPersona?: string
  /** Tools visible to the reviewer; write and rollout tools should be omitted. */
  reviewerAllowedTools?: string[]
  /** Maximum UTF-8 bytes sent to the reviewer as tool evidence. */
  maxEvidenceBytes?: number
  /** Maximum UTF-8 bytes persisted from a reviewer reason. */
  maxReasonBytes?: number
  /** Fail closed when reviewer startup or completion is unavailable. */
  failClosedOnUnavailable?: boolean
}
