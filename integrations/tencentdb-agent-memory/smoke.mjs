#!/usr/bin/env node

/** Live, content-safe verification of a running TencentDB MemoryCore v3 Gateway. */

import { randomUUID } from 'node:crypto'

const baseUrl = (process.env.TDAI_MEMORY_ENDPOINT ?? 'http://127.0.0.1:8420').replace(/\/$/, '')
const serviceId = process.env.TDAI_MEMORY_INSTANCE_ID ?? 'default'
const bearer = process.env.TDAI_MEMORY_API_KEY ?? 'dsh-local-loopback'
const teamId = process.env.TDAI_MEMORY_TEAM_ID ?? 'dsh-smoke'
const agentId = process.env.TDAI_MEMORY_AGENT_ID ?? 'dsh'
const userId = process.env.TDAI_MEMORY_USER_ID ?? 'local-user'
const sessionId = `dsh-smoke-${randomUUID()}`

const isolation = { team_id: teamId, agent_id: agentId, user_id: userId }
const headers = {
  Authorization: `Bearer ${bearer}`,
  'Content-Type': 'application/json',
  'x-tdai-service-id': serviceId,
}

const health = await boundedJson(`${baseUrl}/health`, { method: 'GET' })
if (health.status !== 'ok') throw new Error('MemoryCore health response is not ready')

const capture = await post('/v3/conversation/add', {
  ...isolation,
  session_id: sessionId,
  messages: [
    { role: 'user', content: 'TencentDB MemoryCore live smoke marker.' },
    { role: 'assistant', content: 'Smoke marker accepted.' },
  ],
})
const accepted = capture.data?.accepted_ids
if (!Array.isArray(accepted) || accepted.length !== 2) throw new Error('MemoryCore did not accept both L0 messages')

const stored = await post('/v3/conversation/query', { ...isolation, session_id: sessionId, limit: 10 })
if (!Array.isArray(stored.data?.messages) || stored.data.messages.length !== 2) {
  throw new Error('MemoryCore did not return the captured L0 messages')
}

const search = await post('/v3/atomic/search', { ...isolation, query: 'live smoke marker', limit: 5 })
if (!Array.isArray(search.data?.items)) throw new Error('MemoryCore L1 search response has no items array')
const scenarios = await post('/v3/scenario/ls', isolation)
if (!Array.isArray(scenarios.data?.entries)) throw new Error('MemoryCore L2 list response has no entries array')
const core = await post('/v3/core/read', isolation)
if (core.data?.content !== null && typeof core.data?.content !== 'string') {
  throw new Error('MemoryCore L3 read response has malformed content')
}
await post('/v3/conversation/delete', { ...isolation, session_ids: [sessionId] })

console.log(JSON.stringify({
  health: 'ok', capture: 'ok', l0Count: stored.data.messages.length,
  l1SearchEnvelope: 'ok', l1Count: search.data.items.length,
  l2ListEnvelope: 'ok', l2Count: scenarios.data.entries.length,
  l3ReadEnvelope: 'ok', l3Present: typeof core.data.content === 'string', cleanup: 'ok',
}))

async function post(path, body) {
  const result = await boundedJson(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (result.code !== 0) throw new Error(`MemoryCore operation failed at ${path}`)
  return result
}

async function boundedJson(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 1_048_576) throw new Error('MemoryCore smoke response exceeds 1 MiB')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 1_048_576) throw new Error('MemoryCore smoke response exceeds 1 MiB')
  if (!response.ok) throw new Error(`MemoryCore HTTP ${String(response.status)} at ${new URL(url).pathname}`)
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new Error(`MemoryCore returned invalid JSON at ${new URL(url).pathname}`)
  }
}
