/** Runtime invariant companion for the verifier service. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-verifier'

/** Cordis companion plugin name. */
export const name = 'verifier-invariant'
/** Invariant runtime dependency. */
export const inject = ['invariants']

/** No runtime invariant: this service owns no durable event stream; core tools retain explicit results. */
const install: InvariantInstaller = Object.assign((_ctx: Context) => {}, { inject: [] })

/** Register the verifier invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
