import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
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
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('managed TencentDB MemoryCore real Loader composition', () => {
  it('waits for a local child health endpoint and kills the process tree on disposal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-runtime-loader-'))
    const port = await reservePort()
    const childPath = join(root, 'memory-core-fixture.mjs')
    await writeFile(childPath, [
      "import { createServer } from 'node:http'",
      "const server = createServer((request, response) => {",
      "  if (request.url === '/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{\"status\":\"ok\"}'); return }",
      "  response.writeHead(404); response.end()",
      '})',
      "server.listen(Number(process.env.TDAI_GATEWAY_PORT), process.env.TDAI_GATEWAY_HOST)",
      "process.on('SIGTERM', () => server.close())",
      '',
    ].join('\n'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: 'test-query'",
      "- name: '@deepseek-ai/dsh-experimental-memory'",
      '  config:',
      "    providers: [local, tencentdb]",
      '    tencentdb:',
      `      baseUrl: http://127.0.0.1:${String(port)}`,
      '      serviceId: default',
      '      teamId: default',
      '      agentId: default',
      '      userId: default',
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
      "  config: { DEEPSEEK_API_KEY: local-test-key }",
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-session', SessionStore],
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

    await expect(fetch(`http://127.0.0.1:${String(port)}/health`)).resolves.toMatchObject({ status: 200 })
    await ctx.fiber.dispose()
    context = undefined
    await expect(fetch(`http://127.0.0.1:${String(port)}/health`)).rejects.toThrow()
  }, 30_000)
})

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test port allocation failed')
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  return address.port
}
