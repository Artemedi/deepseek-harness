import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionEventSearchDocument, SessionRecord } from '@deepseek-ai/dsh-session-query'
import MemoryService from '@deepseek-ai/dsh-experimental-memory'

class TestQuery extends SessionQueryEngine {
  private readonly records: SessionRecord[]
  private readonly documents: Map<string, SessionEventSearchDocument[]>

  constructor(ctx: Context, records: readonly SessionRecord[], documents: readonly SessionEventSearchDocument[]) {
    super(ctx)
    this.records = [...records]
    this.documents = new Map<string, SessionEventSearchDocument[]>()
    for (const document of documents) {
      const current = this.documents.get(String(document.sessionId)) ?? []
      current.push(document)
      this.documents.set(String(document.sessionId), current)
    }
  }

  override async searchSessions(): Promise<never> { throw new Error('not used') }
  override async searchEvents(): Promise<never> { throw new Error('not used') }

  override async filterSessions(): Promise<SessionRecord[]> {
    return this.records.map(record => structuredClone(record))
  }

  override async filterEvents(
    sessionId: SessionId,
    filters: readonly { kind: string; text?: string }[],
  ): Promise<SessionEventSearchDocument[]> {
    const query = filters.find(filter => filter.kind === 'text')?.text?.toLocaleLowerCase() ?? ''
    return (this.documents.get(String(sessionId)) ?? []).filter(document => document.text.toLocaleLowerCase().includes(query))
  }
}

function header(id: string, cwd?: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, ...(cwd === undefined ? {} : { cwd }) }
}

function agentFor(ctx: Context, session: Session): { agent: Agent; dispose: () => void } {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: ctx.extend({ agent: undefined }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return { agent, dispose: ctx.agents.register(agent) }
}

async function setup(cwd?: string, documentText = 'gateway retry evidence', config?: { providers?: string[] }): Promise<{ ctx: Context; agent: Agent; service: MemoryService; disposeAgent: () => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const session = Session.create(SessionId('memory-owner'), [], header('memory-owner', cwd))
  const owned = agentFor(ctx, session)
  const agent = owned.agent
  const source = SessionId('memory-source')
  await ctx.plugin(class QueryPlugin extends TestQuery {
    constructor(owner: Context) {
      super(owner, [{ header: header(String(source), cwd), live: false, persisted: true }], [{
        sessionId: source,
        seq: 1,
        type: 'user/message',
        time: 1,
        surface: 'current',
        text: documentText,
      }])
    }
  })
  await ctx.plugin(MemoryService, config)
  return { ctx, agent, service: ctx.memory, disposeAgent: owned.dispose }
}

describe('MemoryService', () => {
  it('returns same-workspace bounded citations with stable ids', async () => {
    const { ctx, agent, service } = await setup('/workspace/a')
    const result = await service.search(agent, { query: 'RETRY', limit: 1, signal: new AbortController().signal })
    expect(result).toMatchObject({ provider: 'local-session-query', workspace: '/workspace/a' })
    expect(result.hits).toEqual([{
      id: 'local:memory-source:1', sessionId: 'memory-source', seq: 1,
      eventType: 'user/message', content: 'gateway retry evidence',
    }])
    await ctx.fiber.dispose()
  })

  it('rejects missing workspace and invalid bounds before querying', async () => {
    const missing = await setup()
    await expect(missing.service.search(missing.agent, { query: 'x', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    await missing.ctx.fiber.dispose()

    const bounded = await setup('/workspace/a')
    await expect(bounded.service.search(bounded.agent, { query: '', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await expect(bounded.service.search(bounded.agent, { query: 'x', limit: 21, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await bounded.ctx.fiber.dispose()
  })

  it('rejects an agent that is no longer live', async () => {
    const { ctx, agent, service, disposeAgent } = await setup('/workspace/a')
    disposeAgent()
    await expect(service.search(agent, { query: 'x', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MEMORY_STALE_AGENT' })
    await ctx.fiber.dispose()
  })

  it('serves enabled TencentDB and OpenViking stubs without session ids', async () => {
    const { ctx, agent, service } = await setup('/workspace/stub', 'unused', { providers: ['local', 'tencentdb', 'openviking'] })
    await expect(service.search(agent, { provider: 'tencentdb', query: 'retry', signal: new AbortController().signal }))
      .resolves.toMatchObject({ provider: 'tencentdb', hits: [{ id: 'tencentdb:stub-chat-1', kind: 'memory', source: 'chat-memory', title: 'Gateway retry', content: 'TencentDB stub retry evidence' }] })
    await expect(service.search(agent, { provider: 'openviking', depth: 'L1', query: 'retry', signal: new AbortController().signal }))
      .resolves.toMatchObject({ provider: 'openviking', hits: [{ id: 'openviking:viking://loader/retry', title: 'Loader retry detail', content: 'OpenViking Loader stub retry detail' }, { id: 'openviking:viking://stub/retry', title: 'Retry detail', content: 'OpenViking stub retry detail' }] })
    await ctx.fiber.dispose()
  })

  it('requires explicit OpenViking depth', async () => {
    const { ctx, agent, service } = await setup('/workspace/stub', 'unused', { providers: ['local', 'openviking'] })
    await expect(service.search(agent, { provider: 'openviking', query: 'retry', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    await ctx.fiber.dispose()
  })

  it('resolves defaults and canonical query without optional undefined fields', async () => {
    const { ctx, agent, service } = await setup('/workspace/a')
    const resolved = service.resolve(agent, { query: '  retry  ', signal: new AbortController().signal })
    expect(resolved).toMatchObject({ provider: { id: 'local-session-query' }, workspace: '/workspace/a', query: 'retry', limit: 5, maxContentBytes: 8_192 })
    expect(Object.hasOwn(resolved, 'depth')).toBe(false)
    await ctx.fiber.dispose()
  })

  it.each([
    [['local', 'local'], 'configured more than once'],
    [['local', ''], 'must not be empty'],
    [['local', 'unknown'], 'is unavailable'],
    [['openviking'], 'must include local'],
  ])('fails fast for invalid provider configuration %j', async (providers, message) => {
    await expect(setup('/workspace/a', 'unused', { providers })).rejects.toThrow(message)
  })

  it('stops before querying when the request is already cancelled', async () => {
    const { ctx, agent, service } = await setup('/workspace/a')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(service.search(agent, { query: 'x', signal: controller.signal }))
      .rejects.toThrow('cancelled')
    await ctx.fiber.dispose()
  })

  it('enforces the aggregate citation cap in UTF-8 bytes', async () => {
    const text = 'retry восстановлен'
    const bytes = Buffer.byteLength(text, 'utf8')
    const bounded = await setup('/workspace/a', text)
    await expect(bounded.service.search(bounded.agent, {
      query: 'retry', maxContentBytes: bytes - 1, signal: new AbortController().signal,
    })).resolves.toMatchObject({ hits: [] })
    await bounded.ctx.fiber.dispose()

    const exact = await setup('/workspace/a', text)
    await expect(exact.service.search(exact.agent, {
      query: 'retry', maxContentBytes: bytes, signal: new AbortController().signal,
    })).resolves.toMatchObject({ hits: [{ content: text }] })
    await exact.ctx.fiber.dispose()
  })
})
