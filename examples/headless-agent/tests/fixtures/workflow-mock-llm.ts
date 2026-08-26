import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Keyless adapter for the assembled coordinator/worker/review workflow snapshot. */
class WorkflowSnapshotAdapter extends LlmAdapter {
  private requestCount = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const request = this.requestCount++
    if (request === 0) {
      const argumentsJson = JSON.stringify({
        script: "phase('Workers')\nconst worker = await agent('collect the evidence')\nphase('Review')\nconst review = await agent('review: ' + worker)\nreturn { worker, review }",
        meta: { name: 'bounded-review', description: 'coordinator with one worker and one review' },
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('workflow-snapshot-call'), name: 'workflow', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('workflow-snapshot-call'), name: 'workflow', arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const lastMessage = options.messages.at(-1)
    const lastUserText = lastMessage?.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') ?? ''
    const lastToolText = lastMessage?.content
      .filter(block => block.type === 'tool-result')
      .flatMap(block => block.content)
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') ?? ''
    const reply = request === 1
      ? 'worker evidence: retry path is covered'
      : request === 2
        ? 'review approved: evidence is sufficient'
        : `Coordinator result received: ${lastUserText}${lastToolText}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'workflow-mock-llm'
export const inject = ['llm']

/** Register the deterministic workflow snapshot adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['workflow-mock'], new WorkflowSnapshotAdapter())
}
