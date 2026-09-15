/** Package-owned relational checks for durable cross-review records. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { RiskClass, ReviewDecision } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-cross-review'
export const name = 'cross-review-invariant'
export const inject = ['invariants']

const RISKS = new Set<RiskClass>(['code-change', 'security', 'sensitive-data', 'infrastructure', 'cost', 'production'])
const DECISIONS = new Set<ReviewDecision>(['approved', 'rejected', 'needs-review', 'unavailable'])

/** Validate review records against the committed session prefix. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'cross-review/evaluated') return
    if (event.data.version !== 1 || event.data.callId.length === 0 || event.data.toolName.length === 0
      || !RISKS.has(event.data.risk) || !DECISIONS.has(event.data.decision)) {
      fail(`cross-review event ${event.seq} has invalid record fields`)
      return
    }
    const prior = session.events.some(candidate => candidate.type === 'cross-review/evaluated'
      && candidate.data.callId === event.data.callId)
    if (prior) fail(`cross-review call ${event.data.callId} was evaluated more than once`)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register cross-review event checks. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
