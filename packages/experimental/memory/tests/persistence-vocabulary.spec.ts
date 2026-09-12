import { describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

describe('memory persistence vocabulary', () => {
  it('keeps every durable memory event resumable', () => {
    expect(KNOWN_SESSION_EVENT_TYPES).toEqual(expect.objectContaining({
      size: expect.any(Number),
    }))
    for (const type of [
      'memory/search',
      'memory/capture-requested',
      'memory/capture-succeeded',
      'memory/capture-failed',
      'memory/recall-failed',
    ]) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(type), type).toBe(true)
    }
  })
})
