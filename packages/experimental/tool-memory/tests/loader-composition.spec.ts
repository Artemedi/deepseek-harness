import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { SessionEventSearchDocument, SessionRecord } from '@deepseek-ai/dsh-session-query'
import MemoryService from '@deepseek-ai/dsh-experimental-memory'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMemory from '@deepseek-ai/dsh-experimental-tool-memory'

class TestQuery extends SessionQueryEngine {
  override async searchSessions(): Promise<never> { throw new Error('not used') }
  override async searchEvents(): Promise<never> { throw new Error('not used') }

  override async filterSessions(): Promise<SessionRecord[]> {
    return [{
      header: { version: SESSION_FORMAT_VERSION, id: SessionId('prior'), createdAt: 1, cwd: '/workspace/a', isSeeded: false },
      live: false,
      persisted: true,
    }]
  }

  override async filterEvents(): Promise<SessionEventSearchDocument[]> {
    return [{
      sessionId: SessionId('prior'), seq: SessionSeq(4), type: 'user/message', time: 1,
      surface: 'current', text: 'gateway retry guidance',
    }]
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const session = Session.create(SessionId('memory-loader-agent'), [], {
    version: SESSION_FORMAT_VERSION, id: SessionId('memory-loader-agent'), createdAt: 1, cwd: '/workspace/a', isSeeded: false,
  })
  const inbox = createInboxStub()
  const value: Agent = {
    id: session.id, options: {}, session, inbox, ctx: scope.ctx, status: 'idle',
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: 'test-query'",
    "- name: '@deepseek-ai/dsh-experimental-memory'",
    "  config: { providers: ['local', 'openviking'] }",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    `  config: { root: ${JSON.stringify(join(root, 'sessions'))}, compression: none }`,
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-experimental-tool-memory'",
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['test-query', TestQuery],
    ['@deepseek-ai/dsh-experimental-memory', MemoryService],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-experimental-tool-memory', ToolMemory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('experimental memory real Loader composition', () => {
  it('records exact citations before returning the model-visible tool result', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('memory-search'),
      name: 'memory_search',
      arguments: { query: 'retry', limit: 1 },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{
      type: 'text',
      text: JSON.stringify({
        provider: 'local-session-query', workspace: '/workspace/a', hits: [{
          id: 'local:prior:4', sessionId: 'prior', seq: 4, eventType: 'user/message', content: 'gateway retry guidance',
        }],
      }),
    }])
    expect(owner.session.snapshotEvents().findLast(event => event.type === 'memory/search')?.data).toEqual({
      version: 1, provider: 'local-session-query', workspace: '/workspace/a', query: 'retry', hits: [{
        id: 'local:prior:4', sessionId: 'prior', seq: 4, eventType: 'user/message', content: 'gateway retry guidance',
      }],
    })

    const viking = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('memory-viking'), name: 'memory_search', arguments: { provider: 'openviking', depth: 'L1', query: 'retry' }, agent: owner })
    expect(viking.isError).toBe(false)
    expect(viking.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('openviking:viking://stub/retry') })
    expect(owner.session.snapshotEvents().filter(event => event.type === 'memory/search')).toHaveLength(2)
    const memoryEvent = owner.session.snapshotEvents().find(event => event.type === 'memory/search')
    expect(memoryEvent).toBeDefined()
    const writer = await ctx.sessionPersistence.create(owner.session.header)
    await writer.append(owner.session.snapshotEvents())
    await writer.flush()
    await writer.close()
    const reader = await ctx.sessionPersistence.open(owner.session.id, 'read')
    const loaded = await reader.read()
    await reader.close()
    expect(loaded.events.find(event => event.type === 'memory/search')?.data).toEqual(memoryEvent!.data)
    expect(loaded.events.filter(event => event.type === 'memory/search')).toHaveLength(2)
  }, 30_000)
})
