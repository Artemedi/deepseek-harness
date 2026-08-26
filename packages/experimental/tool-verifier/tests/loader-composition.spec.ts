import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import VerifierService from '@deepseek-ai/dsh-experimental-verifier'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolVerifier from '@deepseek-ai/dsh-experimental-tool-verifier'
import ToolRuntime from '@deepseek-ai/dsh-tools'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('experimental verifier real Loader composition', () => {
  it('loads the opt-in config and exposes verify_pair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ schema_version: 'score-v1', probability_left: 0.7, rationale: 'left evidence passes' }) } }],
    }), { status: 200 })))
    root = await mkdtemp(join(tmpdir(), 'dsh-verifier-loader-'))
    const configPath = join(root, 'cordis.yml')
    const credentialPath = join(root, '.credentials.yaml')
    await writeFile(credentialPath, 'version: 1\nrefs:\n  MISTRAL_API_KEY: fixture-key\n', { mode: 0o600 })
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-credentials-local'", `  config: { path: ${JSON.stringify(credentialPath)}, watch: false }`,
      "- name: '@deepseek-ai/dsh-experimental-verifier'", "- name: '@deepseek-ai/dsh-system-prompt'", "- name: '@deepseek-ai/dsh-tools'", "- name: '@deepseek-ai/dsh-experimental-tool-verifier'", '',
    ].join('\n'))
    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
      ['@deepseek-ai/dsh-experimental-verifier', VerifierService],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-experimental-tool-verifier', ToolVerifier],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      const value = modules.get(specifier)
      if (value === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return value
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.tools.schemas().find(tool => tool.name === 'verify_pair')).toMatchObject({ name: 'verify_pair' })
  })
})
