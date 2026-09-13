import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionEventSearchDocument, SessionRecord } from '@deepseek-ai/dsh-session-query'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** Deterministic query provider for the experimental memory keyless snapshot. */
export default class MemorySnapshotQuery extends SessionQueryEngine {
  override async searchSessions(): Promise<never> { throw new Error('memory snapshot does not use semantic session search') }
  override async searchEvents(): Promise<never> { throw new Error('memory snapshot does not use semantic event search') }

  override async filterSessions(): Promise<SessionRecord[]> {
    return [{
      header: { version: SESSION_FORMAT_VERSION, id: SessionId('memory-prior'), createdAt: 1, cwd: process.cwd(), isSeeded: false },
      live: false,
      persisted: true,
    }]
  }

  override async filterEvents(): Promise<SessionEventSearchDocument[]> {
    return [{
      sessionId: SessionId('memory-prior'),
      seq: SessionSeq(2),
      type: 'user/message',
      time: 1,
      surface: 'current',
      text: 'gateway retry evidence is recorded in the prior workspace session',
    }]
  }
}
