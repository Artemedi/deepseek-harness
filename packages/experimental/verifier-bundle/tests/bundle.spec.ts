import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

describe('experimental verifier bundle patch', () => {
  it('mounts exactly the explicit verifier service and tool', async () => {
    const patch = await readFile(patchPath, 'utf8')
    expect(patch).toContain("- id: experimental-verifier\n      name: '@deepseek-ai/dsh-experimental-verifier'")
    expect(patch).toContain("- id: experimental-tool-verifier\n      name: '@deepseek-ai/dsh-experimental-tool-verifier'")
    expect(patch).toContain('model: mistral-small-2603')
    expect(patch).toContain('maxTokens: 64')
  })
})
