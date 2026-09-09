import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic adapter that rejects unless automatic memory precedes the direct prompt. */
class AutomaticRecallAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const memoryIndex = options.messages.findIndex(message => message.role === 'user'
      && message.source.kind === 'plugin' && message.source.plugin === 'experimental-memory')
    const promptIndex = options.messages.findIndex(message => message.role === 'user'
      && message.source.kind === 'user'
      && message.content.some(block => block.type === 'text' && block.text === 'Use remembered package guidance.'))
    if (memoryIndex < 0 || promptIndex < 0 || memoryIndex >= promptIndex) {
      throw new Error('automatic TencentDB memory did not precede the direct user prompt')
    }
    const memoryText = options.messages[memoryIndex]!.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    if (!memoryText.includes('Use pnpm.')) throw new Error('automatic TencentDB memory content is missing')

    const reply = 'AUTOMATIC_RECALL_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'memory-automatic-recall-mock'
export const inject = ['llm']

/** Register the automatic-recall assertion adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['memory-automatic-recall-mock'], new AutomaticRecallAdapter())
}
