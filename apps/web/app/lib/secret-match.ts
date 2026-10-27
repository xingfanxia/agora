// ============================================================
// Shared-secret check for operator entry points
// ============================================================
//
// Fail-closed: an unset/empty expected secret matches nothing, so a
// missing env var disables the entry point instead of opening it.
// Both sides are hashed before timingSafeEqual so the comparison is
// constant-time regardless of the provided value's length.

import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function secretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || provided == null) return false
  return timingSafeEqual(digest(provided), digest(expected))
}
