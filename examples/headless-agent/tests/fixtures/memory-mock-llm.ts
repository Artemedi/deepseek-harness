import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Keyless adapter that performs one explicit memory search, then answers from its result. */
class MemorySnapshotAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const argumentsJson = JSON.stringify({ query: 'retry', limit: 1 })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('memory-snapshot-call'), name: 'memory_search', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('memory-snapshot-call'), name: 'memory_search', arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = toolResult.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const reply = `Memory citation: ${text}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'memory-mock-llm'
export const inject = ['llm']

/** Register the deterministic memory snapshot adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['memory-mock'], new MemorySnapshotAdapter())
}
