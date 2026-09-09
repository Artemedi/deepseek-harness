import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { startTencentDbManagedRuntime } from '../src/tencentdb-runtime.ts'

class FakeHandle implements SubprocessHandle {
  readonly pid = 42
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected = {}
  readonly done: Promise<SubprocessOutcome>
  terminated = false
  private settle!: (outcome: SubprocessOutcome) => void

  constructor(outcome?: SubprocessOutcome) {
    this.done = new Promise((resolve) => { this.settle = resolve })
    if (outcome !== undefined) this.settle(outcome)
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  async waitForExit(): Promise<boolean> {
    await this.done
    return true
  }
}

class FakeSubprocess extends SubprocessRuntime {
  override readonly executionWorld: SubprocessRuntime['executionWorld'] = 'local-host'
  readonly specs: SubprocessSpawnSpec[] = []
  handle = new FakeHandle()

  override async resolveExecutable(command: string): Promise<string> {
    return `/resolved/${command}`
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    return this.handle
  }

  override async spawnTerminal(): Promise<never> { throw new Error('not used') }
}

class RemoteFakeSubprocess extends FakeSubprocess {
  override readonly executionWorld = 'remote' as const
}

const provider = {
  baseUrl: 'http://127.0.0.1:8420', serviceId: 'default',
  teamId: 'default', agentId: 'default', userId: 'default',
}

const runtime = {
  command: 'node', args: ['--import', 'tsx', 'src/gateway/server.ts'], cwd: '/opt/memory-core',
  dataDir: '/data/memory-core', llmCredentialRef: 'DEEPSEEK_API_KEY',
  llmBaseUrl: 'https://api.deepseek.com/v1', llmModel: 'deepseek-chat',
  startupTimeoutMs: 30, healthPollMs: 1, killGraceMs: 5, maxOutputBytes: 100,
}

async function setup(): Promise<{ ctx: Context; subprocess: FakeSubprocess }> {
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess)
  return { ctx, subprocess: ctx.subprocess as FakeSubprocess }
}

describe('managed TencentDB MemoryCore runtime', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts after an empty preflight, forwards the explicit LLM credential, and stops on disposal', async () => {
    let probes = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      probes += 1
      if (probes === 1) throw new Error('connection refused')
      return new Response('{"status":"ok"}', { status: 200 })
    }))
    const { ctx, subprocess } = await setup()
    await startTencentDbManagedRuntime(ctx, provider, runtime, async ref => ref === 'DEEPSEEK_API_KEY' ? 'llm-secret' : undefined)

    expect(subprocess.specs).toHaveLength(1)
    expect(subprocess.specs[0]).toMatchObject({
      argv: ['/resolved/node', '--import', 'tsx', 'src/gateway/server.ts'],
      cwd: '/opt/memory-core', graceMs: 5,
      env: {
        TDAI_GATEWAY_CONFIG: 'tdai-gateway.standalone.yaml',
        TDAI_GATEWAY_HOST: '127.0.0.1', TDAI_GATEWAY_PORT: '8420',
        TDAI_DATA_DIR: '/data/memory-core', TDAI_LLM_API_KEY: 'llm-secret',
        TDAI_LLM_BASE_URL: 'https://api.deepseek.com/v1', TDAI_LLM_MODEL: 'deepseek-chat',
      },
    })
    expect(Object.hasOwn(subprocess.specs[0]?.env ?? {}, 'TDAI_GATEWAY_API_KEY')).toBe(false)
    await ctx.fiber.dispose()
    expect(subprocess.handle.terminated).toBe(true)
  })

  it('refuses to adopt a process already listening on the configured endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"ok"}', { status: 200 })))
    const { ctx, subprocess } = await setup()
    await expect(startTencentDbManagedRuntime(ctx, provider, runtime, async () => 'secret'))
      .rejects.toMatchObject({ code: 'MEMORY_INVALID_REQUEST' })
    expect(subprocess.specs).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('fails when the child exits before readiness and terminates a timed-out child', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const early = await setup()
    early.subprocess.handle = new FakeHandle({ exitCode: 1, signal: null })
    await expect(startTencentDbManagedRuntime(early.ctx, provider, runtime, async () => 'secret'))
      .rejects.toThrow('exited before readiness')
    await early.ctx.fiber.dispose()

    const timed = await setup()
    await expect(startTencentDbManagedRuntime(timed.ctx, provider, { ...runtime, startupTimeoutMs: 3 }, async () => 'secret'))
      .rejects.toThrow('readiness timed out')
    expect(timed.subprocess.handle.terminated).toBe(true)
    await timed.ctx.fiber.dispose()
  })

  it('requires an existing LLM credential and a plain loopback origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const missing = await setup()
    await expect(startTencentDbManagedRuntime(missing.ctx, provider, runtime, async () => undefined))
      .rejects.toMatchObject({ code: 'MEMORY_UNAUTHORIZED' })
    expect(missing.subprocess.specs).toHaveLength(0)
    await missing.ctx.fiber.dispose()

    const remote = await setup()
    await expect(startTencentDbManagedRuntime(remote.ctx, { ...provider, baseUrl: 'https://memory.example:8420', credentialRef: 'KEY' }, runtime, async () => 'secret'))
      .rejects.toThrow('plain loopback HTTP origin')
    await remote.ctx.fiber.dispose()
  })

  it('refuses a remote subprocess execution world before resolving credentials', async () => {
    const ctx = new Context()
    await ctx.plugin(RemoteFakeSubprocess)
    const resolveCredential = vi.fn(async () => 'secret')
    await expect(startTencentDbManagedRuntime(ctx, provider, runtime, resolveCredential))
      .rejects.toThrow('local-host subprocess provider')
    expect(resolveCredential).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
