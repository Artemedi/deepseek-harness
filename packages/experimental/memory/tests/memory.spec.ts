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

  override async filterEvents(sessionId: SessionId, filters: readonly { kind: string; text?: string }[]): Promise<SessionEventSearchDocument[]> {
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

async function setup(cwd?: string): Promise<{ ctx: Context; agent: Agent; service: MemoryService; disposeAgent: () => void }> {
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
        text: 'gateway retry evidence',
      }])
    }
  })
  await ctx.plugin(MemoryService)
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
})
