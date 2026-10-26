// useRoomPoll scheduling rules: a transient failure must never stop
// polling (the room view would freeze); only 404/410 end it.

import { describe, expect, it } from 'vitest'
import {
  MAX_POLL_BACKOFF_MS,
  isTerminalPollStatus,
  nextPollDelay,
} from '../../app/room/[id]/hooks/poll-schedule'

describe('isTerminalPollStatus', () => {
  it('stops only for a missing or gone room', () => {
    expect(isTerminalPollStatus(404)).toBe(true)
    expect(isTerminalPollStatus(410)).toBe(true)
  })
  it('keeps polling on server errors, rate limits and other 4xx', () => {
    for (const status of [400, 401, 403, 408, 429, 500, 502, 503, 504]) {
      expect(isTerminalPollStatus(status)).toBe(false)
    }
  })
})

describe('nextPollDelay', () => {
  it('healthy cadence is unchanged: 1s live, 5s otherwise', () => {
    expect(nextPollDelay('running', 0)).toBe(1000)
    expect(nextPollDelay('waiting', 0)).toBe(1000)
    expect(nextPollDelay('completed', 0)).toBe(5000)
    expect(nextPollDelay('error', 0)).toBe(5000)
  })
  it('backs off exponentially after consecutive failures', () => {
    expect([1, 2, 3, 4, 5].map((n) => nextPollDelay('running', n))).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ])
  })
  it('backoff is bounded and always finite', () => {
    expect(nextPollDelay('running', 6)).toBe(MAX_POLL_BACKOFF_MS)
    expect(nextPollDelay('running', 1000)).toBe(MAX_POLL_BACKOFF_MS)
  })
})
