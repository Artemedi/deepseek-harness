import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-verifier-bundle'

/** Cordis companion plugin name. */
export const name = 'experimental-verifier-bundle-invariant'
/** Invariant runtime dependency. */
export const inject = ['invariants']
/** No runtime invariant: this bundle owns only a patch layer. */
const install: InvariantInstaller = Object.assign((_ctx: Context) => {}, { inject: [] })
/** Register the bundle invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
