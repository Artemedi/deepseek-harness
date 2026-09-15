import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-cross-review-bundle'
export const name = 'experimental-cross-review-bundle-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = Object.assign((_ctx: Context) => {}, { inject: [] })
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
