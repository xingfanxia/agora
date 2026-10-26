// Pure scheduling rules for useRoomPoll (kept separate so they can be
// unit-tested without a DOM).

/** Upper bound for the retry delay after consecutive failed polls. */
export const MAX_POLL_BACKOFF_MS = 30_000

/**
 * HTTP statuses after which polling stops for good: the room does not
 * exist (404) or is gone (410). Everything else — 5xx, 429, other 4xx,
 * network errors — is treated as transient and retried.
 */
export function isTerminalPollStatus(status: number): boolean {
  return status === 404 || status === 410
}

/**
 * Delay before the next poll. With no failures: 1s while the room is
 * live (a human may submit any moment), 5s otherwise. After failures:
 * exponential backoff from 1s, capped at MAX_POLL_BACKOFF_MS.
 */
export function nextPollDelay(roomStatus: string, consecutiveFailures: number): number {
  if (consecutiveFailures > 0) {
    return Math.min(1000 * 2 ** (consecutiveFailures - 1), MAX_POLL_BACKOFF_MS)
  }
  return roomStatus === 'running' || roomStatus === 'waiting' ? 1000 : 5000
}
