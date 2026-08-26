/** Runtime invariant companion for the explicit verifier tool. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-tool-verifier'

/** Cordis companion plugin name. */
export const name = 'tool-verifier-invariant'
/** Invariant runtime dependency. */
export const inject = ['invariants']

/** No runtime invariant: core tools owns explicit tool-call and result relations. */
const install: InvariantInstaller = Object.assign((_ctx: Context) => {}, { inject: [] })

/** Register the tool verifier invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
