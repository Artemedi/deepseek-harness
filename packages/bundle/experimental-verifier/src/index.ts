import { Service } from '@deepseek-ai/cordis'

/** Empty bundle marker: its Cordis patch mounts the verifier packages. */
export default class ExperimentalVerifierBundle extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'experimentalVerifierBundle')
  }
}
