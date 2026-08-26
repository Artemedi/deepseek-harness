import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as MemoryInvariant from '../src/invariant.ts'
import type {} from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(MemoryInvariant)
  return ctx
}

function session(ctx: Context, id: string, cwd?: string): Session {
  return ctx.sessions.create(SessionId(id), {
    meta: {
      createdAt: 1,
      ...(cwd === undefined ? {} : { cwd }),
    },
  })
}

describe('memory event invariant', () => {
  it('accepts a same-workspace observation', async () => {
    const ctx = await setup()
    const owner = session(ctx, 'memory-valid', '/workspace/a')
    expect(() => owner.append('memory/search', {
      version: 1,
      provider: 'local-session-query',
      workspace: '/workspace/a',
      query: 'retry',
      hits: [],
    })).not.toThrow()
    expect(owner.events.at(-1)?.type).toBe('memory/search')
    await ctx.fiber.dispose()
  })

  it('rejects observations without matching workspace ownership', async () => {
    const ctx = await setup()
    const owner = session(ctx, 'memory-invalid', '/workspace/a')
    expect(() => owner.append('memory/search', {
      version: 1,
      provider: 'local-session-query',
      workspace: '/workspace/b',
      query: 'retry',
      hits: [],
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-experimental-memory',
    }))
    expect(owner.events).toEqual([])
    await ctx.fiber.dispose()
  })
})
