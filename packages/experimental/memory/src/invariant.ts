/** Append-time validation for durable experimental memory observations. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Services required to inspect owned session events. */
export const inject = ['invariants']

/** Reject observations whose claimed workspace differs from the owning session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'memory/search') return
    if (session.header.cwd === undefined || event.data.workspace !== session.header.cwd) {
      fail(`memory search event ${event.seq} must retain the owning session workspace`)
    }
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the experimental memory invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
