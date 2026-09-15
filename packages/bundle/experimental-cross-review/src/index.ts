import { Service } from '@deepseek-ai/cordis'

/** Empty bundle marker; the patch mounts the opt-in cross-review plugin. */
export default class ExperimentalCrossReviewBundle extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, 'experimentalCrossReviewBundle')
  }
}
