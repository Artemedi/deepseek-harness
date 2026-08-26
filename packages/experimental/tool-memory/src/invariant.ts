/** Invariant companion for the explicit memory tool consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-tool-memory'

/** Cordis companion plugin name. */
export const name = 'tool-memory-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: the memory service owns durable event relations. */
const install: InvariantInstaller = () => {}

/** Register the consumer package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
