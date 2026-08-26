/** Public vocabulary for opt-in pairwise verification. */

/** One candidate whose id and evidence are compared by a verifier provider. */
export interface VerifierCandidate {
  /** Stable caller-selected candidate id. */
  readonly id: string
  /** Bounded candidate evidence supplied by the caller. */
  readonly evidence: string
}

/** Input for one explicit pairwise comparison. */
export interface VerifierCompareRequest {
  /** Task-specific evaluation rubric. */
  readonly rubric: string
  /** Evidence for the left candidate. */
  readonly left: VerifierCandidate
  /** Evidence for the right candidate. */
  readonly right: VerifierCandidate
  /** Cancels only this provider request. */
  readonly signal: AbortSignal
}

/** A schema-valid pairwise preference returned by the provider. */
export interface VerifierCompareResult {
  /** Fixed provider result protocol version. */
  readonly schemaVersion: 'score-v1'
  /** Probability that the left candidate is preferred. */
  readonly probabilityLeft: number
  /** Bounded provider rationale; not correctness evidence. */
  readonly rationale: string
}

/** Provider implementation behind the verifier seam. */
export interface VerifierProvider {
  /** Run one explicit comparison. */
  compare(request: VerifierCompareRequest): Promise<VerifierCompareResult>
}
