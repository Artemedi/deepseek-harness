/** Bounded HTTP response reads shared by remote memory providers. */

import { Buffer } from 'node:buffer'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Parse one configuration value as an HTTP(S) origin without embedded authority or path state.
 *
 * @param raw - Configuration value to parse.
 * @param provider - Provider name used in validation errors.
 * @returns The validated HTTP(S) origin.
 */
export function parseRemoteMemoryOrigin(raw: string, provider: 'OpenViking' | 'TencentDB'): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalidOrigin(provider)
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw invalidOrigin(provider)
  }
  return url
}

/**
 * Resolve one public HTTP limit consistently with the composition schema.
 *
 * @param value - Direct-constructor override, when supplied.
 * @param fallback - Default applied when the override is absent.
 * @param maximum - Largest accepted value.
 * @param provider - Provider name used in validation errors.
 * @param field - Configuration field name used in validation errors.
 * @returns The validated limit.
 */
export function resolveRemoteMemoryLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  provider: 'OpenViking' | 'TencentDB',
  field: 'timeoutMs' | 'maxResponseBytes',
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new HarnessError(`${provider} ${field} must be a positive integer no greater than ${String(maximum)}`, 'MEMORY_INVALID_REQUEST')
  }
  return resolved
}

/**
 * Read decoded response bytes without buffering past the configured limit.
 *
 * @param response - HTTP response whose body is consumed.
 * @param maxBytes - Maximum decoded byte count to buffer.
 * @param provider - Provider name used in overflow errors.
 * @returns The UTF-8 response text.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  provider: 'OpenViking' | 'TencentDB',
): Promise<string> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge(provider)
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (total + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {})
        throw tooLarge(provider)
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function tooLarge(provider: 'OpenViking' | 'TencentDB'): HarnessError {
  return new HarnessError(`${provider} response exceeds configured byte limit`, 'MEMORY_PROVIDER_ERROR')
}

function invalidOrigin(provider: 'OpenViking' | 'TencentDB'): HarnessError {
  return new HarnessError(`${provider} baseUrl must be an HTTP(S) origin`, 'MEMORY_INVALID_REQUEST')
}
