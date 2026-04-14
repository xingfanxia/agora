// ============================================================
// Seeded deterministic primitives
// ============================================================
//
// Used by mode factories (e.g. createWerewolf) so that given a
// seed, role assignment + generated agent IDs are identical across
// invocations. This is what lets `advanceRoom` rehydrate the in-
// memory runtime from DB state: re-call the factory with the room's
// id as seed and get the same roleMap.

/** FNV-1a 32-bit hash → seeds a mulberry32 PRNG */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — tiny deterministic 32-bit PRNG. Returns 0..1 floats. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Create a seeded PRNG from a string seed. Same seed → same sequence. */
export function createSeededPrng(seed: string): () => number {
  return mulberry32(fnv1a(seed))
}

/** Deterministic Fisher-Yates shuffle using the given PRNG. Non-mutating. */
export function seededShuffle<T>(prng: () => number, arr: readonly T[]): T[] {
  const result = arr.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

/**
 * Generate a deterministic UUID-v4-shaped id from a seed + salt.
 * Produces lowercase hex matching the canonical 8-4-4-4-12 format
 * with version nibble forced to 4 and variant nibble forced to 8..b.
 * Not cryptographically secure — for reproducible runtime ids only.
 */
export function seededUuid(seed: string, salt: string | number): string {
  const prng = createSeededPrng(`${seed}::${salt}`)
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(prng() * 256)
  }
  // Version 4, variant 1
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Generate N deterministic UUIDs from a seed. Same seed + N → same ids. */
export function seededUuidList(seed: string, count: number): string[] {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    ids.push(seededUuid(seed, `agent:${i}`))
  }
  return ids
}
