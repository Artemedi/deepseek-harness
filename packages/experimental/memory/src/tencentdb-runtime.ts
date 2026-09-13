/** Managed lifecycle for an operator-installed TencentDB MemoryCore Gateway.
 * @module @deepseek-ai/dsh-experimental-memory/tencentdb-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { TencentDbHttpConfig } from './tencentdb-http.ts'

/** Explicit local MemoryCore process and LLM configuration. */
export interface TencentDbManagedRuntimeConfig {
  /** Executable used to start the pinned MemoryCore checkout. */
  readonly command: string
  /** Arguments passed without shell interpretation. */
  readonly args?: string[]
  /** MemoryCore checkout directory. */
  readonly cwd: string
  /** Standalone Gateway YAML or JSON path, interpreted by MemoryCore. */
  readonly gatewayConfig?: string
  /** Local SQLite and file storage directory. */
  readonly dataDir: string
  /** Existing DSH credential supplied to MemoryCore for extraction and aggregation. */
  readonly llmCredentialRef: string
  /** OpenAI-compatible LLM base URL supplied to MemoryCore. */
  readonly llmBaseUrl: string
  /** Model name supplied to MemoryCore. */
  readonly llmModel: string
  /** Maximum time to wait for `/health`. */
  readonly startupTimeoutMs?: number
  /** Delay between failed readiness probes. */
  readonly healthPollMs?: number
  /** TERM-to-KILL process-tree grace period. */
  readonly killGraceMs?: number
  /** Retained tail cap for each process output stream. */
  readonly maxOutputBytes?: number
}

type ResolvedRuntimeConfig = Required<TencentDbManagedRuntimeConfig>

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
const DEFAULT_HEALTH_POLL_MS = 100
const DEFAULT_KILL_GRACE_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 65_536
const MAX_STARTUP_TIMEOUT_MS = 300_000
const MAX_HEALTH_POLL_MS = 10_000
const MAX_KILL_GRACE_MS = 60_000
const MAX_OUTPUT_BYTES = 16_777_216

/**
 * Start one co-located MemoryCore process, wait for readiness, and bind its lifetime to the plugin fiber.
 * @param ctx - owning plugin context with an available subprocess provider.
 * @param provider - HTTP endpoint, isolation, and optional Gateway credential configuration.
 * @param config - pinned executable, storage, readiness, and LLM configuration.
 * @param resolveCredential - resolves explicit DSH credential references without ambient inheritance.
 * @returns after the child health endpoint becomes ready; plugin disposal terminates and joins its process tree.
 */
export async function startTencentDbManagedRuntime(
  ctx: Context,
  provider: TencentDbHttpConfig,
  config: TencentDbManagedRuntimeConfig,
  resolveCredential: (ref: string) => Promise<string | undefined>,
): Promise<void> {
  const endpoint = managedEndpoint(provider.baseUrl)
  const resolved = resolveRuntimeConfig(config)
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new HarnessError('managed TencentDB MemoryCore requires a subprocess provider', 'MEMORY_INVALID_REQUEST')
  }
  if (subprocess.executionWorld !== 'local-host') {
    throw new HarnessError('managed TencentDB MemoryCore requires the local-host subprocess provider', 'MEMORY_INVALID_REQUEST')
  }

  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) setupAbort.abort(new Error('managed TencentDB MemoryCore setup disposed'))
  })
  let handle: SubprocessHandle | undefined
  let closing = false
  try {
    if (await probeHealth(endpoint.healthUrl, setupAbort.signal, Math.min(1_000, resolved.startupTimeoutMs)) !== 'unreachable') {
      throw new HarnessError('managed TencentDB MemoryCore endpoint is already in use', 'MEMORY_INVALID_REQUEST')
    }
    const llmKey = await resolveCredential(resolved.llmCredentialRef)
    if (llmKey === undefined) {
      throw new HarnessError('managed TencentDB MemoryCore LLM credential is not configured', 'MEMORY_UNAUTHORIZED')
    }
    const gatewayKey = provider.credentialRef === undefined
      ? undefined
      : await resolveCredential(provider.credentialRef)
    if (provider.credentialRef !== undefined && gatewayKey === undefined) {
      throw new HarnessError('TencentDB credential is not configured', 'MEMORY_UNAUTHORIZED')
    }
    setupAbort.signal.throwIfAborted()
    const executable = await subprocess.resolveExecutable(resolved.command, undefined, setupAbort.signal)
    setupAbort.signal.throwIfAborted()
    handle = subprocess.spawn({
      argv: [executable, ...resolved.args],
      cwd: resolved.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: resolved.maxOutputBytes },
        stderr: { maxBytes: resolved.maxOutputBytes },
      },
      graceMs: resolved.killGraceMs,
      signal: setupAbort.signal,
      env: {
        TDAI_GATEWAY_CONFIG: resolved.gatewayConfig,
        TDAI_GATEWAY_HOST: endpoint.hostname,
        TDAI_GATEWAY_PORT: endpoint.port,
        TDAI_DATA_DIR: resolved.dataDir,
        TDAI_LLM_API_KEY: llmKey,
        TDAI_LLM_BASE_URL: resolved.llmBaseUrl,
        TDAI_LLM_MODEL: resolved.llmModel,
        ...(gatewayKey === undefined ? {} : { TDAI_GATEWAY_API_KEY: gatewayKey }),
      },
    })
    const owned = handle
    ctx.effect(() => async () => {
      closing = true
      owned.terminate()
      await owned.done.catch(() => undefined)
      await owned.waitForExit()
    }, 'memory.tencentdbManagedRuntime')

    await waitForHealth(endpoint.healthUrl, owned, resolved, setupAbort.signal)
    void owned.done.then((outcome) => {
      if (!closing) ctx.logger.error(`managed TencentDB MemoryCore exited: code=${String(outcome.exitCode)} signal=${String(outcome.signal)}`)
    }, (error: unknown) => {
      if (!closing) ctx.logger.error(new Error('managed TencentDB MemoryCore process failed', { cause: error }))
    })
  } catch (error: unknown) {
    if (handle !== undefined) {
      closing = true
      handle.terminate()
      await handle.done.catch(() => undefined)
      await handle.waitForExit().catch(() => undefined)
    }
    throw error
  } finally {
    stopSetupCancellation()
  }
}

function managedEndpoint(baseUrl: string): { healthUrl: string; hostname: string; port: string } {
  let endpoint: URL
  try {
    endpoint = new URL(baseUrl)
  } catch {
    throw new HarnessError('managed TencentDB MemoryCore baseUrl must be an absolute URL', 'MEMORY_INVALID_REQUEST')
  }
  if (endpoint.protocol !== 'http:' || endpoint.username !== '' || endpoint.password !== ''
    || (endpoint.pathname !== '' && endpoint.pathname !== '/') || endpoint.search !== '' || endpoint.hash !== '') {
    throw new HarnessError('managed TencentDB MemoryCore requires a plain loopback HTTP origin', 'MEMORY_INVALID_REQUEST')
  }
  const hostname = endpoint.hostname.replace(/^\[(.*)\]$/, '$1')
  if (hostname !== '::1' && !isIpv4Loopback(hostname)) {
    throw new HarnessError('managed TencentDB MemoryCore requires a loopback baseUrl', 'MEMORY_INVALID_REQUEST')
  }
  if (endpoint.port === '') {
    throw new HarnessError('managed TencentDB MemoryCore baseUrl must include its port', 'MEMORY_INVALID_REQUEST')
  }
  return { healthUrl: new URL('/health', endpoint).href, hostname, port: endpoint.port }
}

function resolveRuntimeConfig(config: TencentDbManagedRuntimeConfig): ResolvedRuntimeConfig {
  const resolved = {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    gatewayConfig: config.gatewayConfig ?? 'tdai-gateway.standalone.yaml',
    dataDir: config.dataDir,
    llmCredentialRef: config.llmCredentialRef,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    startupTimeoutMs: config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    healthPollMs: config.healthPollMs ?? DEFAULT_HEALTH_POLL_MS,
    killGraceMs: config.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value.trim() === '') {
      throw new HarnessError(`managed TencentDB MemoryCore ${name} must not be empty`, 'MEMORY_INVALID_REQUEST')
    }
  }
  const maxima = {
    startupTimeoutMs: MAX_STARTUP_TIMEOUT_MS,
    healthPollMs: MAX_HEALTH_POLL_MS,
    killGraceMs: MAX_KILL_GRACE_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  }
  for (const name of Object.keys(maxima) as Array<keyof typeof maxima>) {
    const value = resolved[name]
    if (!Number.isSafeInteger(value) || value < 1 || value > maxima[name]) {
      throw new HarnessError(`managed TencentDB MemoryCore ${name} is outside its supported range`, 'MEMORY_INVALID_REQUEST')
    }
  }
  return resolved
}

function isIpv4Loopback(hostname: string): boolean {
  const segments = hostname.split('.')
  return segments.length === 4
    && segments[0] === '127'
    && segments.every(segment => /^\d{1,3}$/.test(segment) && Number(segment) <= 255)
}

async function waitForHealth(
  healthUrl: string,
  handle: SubprocessHandle,
  config: ResolvedRuntimeConfig,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + config.startupTimeoutMs
  const exit = handle.done.then(
    outcome => ({ kind: 'exit' as const, outcome }),
    (error: unknown) => ({ kind: 'failure' as const, error }),
  )
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    const ready = await Promise.race([
      probeHealth(healthUrl, signal, Math.min(1_000, remaining)).then(value => ({ kind: 'health' as const, value })),
      exit,
    ])
    if (ready.kind === 'exit') {
      throw new HarnessError(
        `managed TencentDB MemoryCore exited before readiness: code=${String(ready.outcome.exitCode)} signal=${String(ready.outcome.signal)}`,
        'MEMORY_PROVIDER_UNAVAILABLE',
      )
    }
    if (ready.kind === 'failure') {
      throw new HarnessError('managed TencentDB MemoryCore failed before readiness', 'MEMORY_PROVIDER_UNAVAILABLE', { cause: ready.error })
    }
    if (ready.value === 'ready') return
    await abortableDelay(Math.min(config.healthPollMs, Math.max(1, deadline - Date.now())), signal)
  }
  throw new HarnessError('managed TencentDB MemoryCore readiness timed out', 'MEMORY_PROVIDER_UNAVAILABLE')
}

async function probeHealth(url: string, signal: AbortSignal, timeoutMs: number): Promise<'unreachable' | 'reachable' | 'ready'> {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs))
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, timeout]) })
    const length = Number(response.headers.get('content-length') ?? 0)
    if (!response.ok || length > 4_096) {
      await response.body?.cancel()
      return 'reachable'
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 4_096) return 'reachable'
    try {
      const body = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
      return typeof body === 'object' && body !== null && Reflect.get(body, 'status') === 'ok' ? 'ready' : 'reachable'
    } catch {
      return 'reachable'
    }
  } catch {
    if (signal.aborted) throw signal.reason
    return 'unreachable'
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('managed TencentDB MemoryCore setup aborted', { cause: reason }))
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}
