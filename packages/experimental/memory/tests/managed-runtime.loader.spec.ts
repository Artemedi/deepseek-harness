import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import MemoryService from '@deepseek-ai/dsh-experimental-memory'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

class EmptyQuery extends SessionQueryEngine {
  override async searchSessions(): Promise<never> { throw new Error('not used') }
  override async searchEvents(): Promise<never> { throw new Error('not used') }
  override async filterSessions(): Promise<[]> { return [] }
  override async filterEvents(): Promise<[]> { return [] }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllGlobals()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('managed TencentDB MemoryCore real Loader composition', () => {
  it('waits for a local child health endpoint and kills the process tree on disposal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-loader-'))
    const portFile = join(root, 'data', 'port')
    const childPath = join(root, 'memory-core-fixture.mjs')
    await writeFile(childPath, [
      "import { mkdir, writeFile } from 'node:fs/promises'",
      "import { createServer } from 'node:http'",
      "import { join } from 'node:path'",
      'const server = createServer((request, response) => {',
      "  if (request.url === '/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{\"status\":\"ok\"}'); return }",
      '  response.writeHead(404); response.end()',
      '})',
      "await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })",
      'const address = server.address()',
      "if (address === null || typeof address === 'string') throw new Error('fixture server has no TCP port')",
      'await mkdir(process.env.TDAI_DATA_DIR, { recursive: true })',
      "await writeFile(join(process.env.TDAI_DATA_DIR, 'port'), String(address.port))",
      "process.on('SIGTERM', () => server.close())",
      '',
    ].join('\n'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: 'test-query'",
      "- name: '@deepseek-ai/dsh-experimental-memory'",
      '  config:',
      '    providers: [local, tencentdb]',
      '    tencentdb:',
      '      baseUrl: http://127.0.0.1:1',
      '      serviceId: default',
      '      isolationBindings:',
      `        - workspace: ${JSON.stringify(root)}`,
      '          teamId: default',
      '          agentId: default',
      '          userId: default',
      '    tencentdbRuntime:',
      `      command: ${JSON.stringify(process.execPath)}`,
      `      args: [${JSON.stringify(childPath)}]`,
      `      cwd: ${JSON.stringify(root)}`,
      `      dataDir: ${JSON.stringify(join(root, 'data'))}`,
      '      llmCredentialRef: DEEPSEEK_API_KEY',
      '      llmBaseUrl: https://api.deepseek.com/v1',
      '      llmModel: deepseek-chat',
      '      startupTimeoutMs: 5000',
      '      healthPollMs: 10',
      "- name: 'test-credentials'",
      '  config: { DEEPSEEK_API_KEY: local-test-key }',
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== 'http://127.0.0.1:1/health') return realFetch(input, init)
      await readFile(portFile, 'utf8')
      return new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['test-query', EmptyQuery],
      ['test-credentials', MemoryCredentials],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-experimental-memory', MemoryService],
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

    const port = Number(await readFile(portFile, 'utf8'))
    expect(Number.isSafeInteger(port) && port > 0).toBe(true)
    await expect(realFetch(`http://127.0.0.1:${String(port)}/health`)).resolves.toMatchObject({ status: 200 })
    await ctx.fiber.dispose()
    context = undefined
    await expect(realFetch(`http://127.0.0.1:${String(port)}/health`)).rejects.toThrow()
  }, 30_000)
})
