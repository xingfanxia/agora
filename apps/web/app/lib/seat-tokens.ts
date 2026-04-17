// ============================================================
// Seat tokens — signed JWTs for guest human players (Phase 4.5d)
// ============================================================
//
// An "invite URL" for a human seat in a room is a JWT signed with
// `AGORA_SEAT_SECRET` (HS256). Payload binds the token to a
// specific (roomId, agentId) pair so it can't be replayed against
// other rooms or seats. Default TTL: 7 days.
//
// Use case split:
//
//   - /api/rooms/:id/human-input  —  accepts either a valid session
//     (room owner testing locally) OR a valid seat token whose
//     agentId matches the input's agentId. Tokens unlock a single
//     seat; sessions unlock any seat the caller has legitimate
//     access to.
//
//   - /r/:roomId?seat=X&token=Y  —  lands guests, validates token,
//     stores it in localStorage, redirects to /room/:roomId.

import { SignJWT, jwtVerify } from 'jose'

const SEAT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export interface SeatTokenPayload {
  /** Room the seat belongs to. */
  roomId: string
  /** The agent seat id the human is claiming. */
  agentId: string
}

function getSecret(): Uint8Array {
  const secret = process.env.AGORA_SEAT_SECRET
  if (!secret) {
    throw new Error(
      'AGORA_SEAT_SECRET not set. Add to .env (openssl rand -base64 48).',
    )
  }
  return new TextEncoder().encode(secret)
}

/**
 * Mint a JWT binding (roomId, agentId) with a 7-day expiry.
 */
export async function signSeatToken(payload: SeatTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('agora')
    .setAudience(`room:${payload.roomId}`)
    .setExpirationTime(Math.floor(Date.now() / 1000) + SEAT_TOKEN_TTL_SECONDS)
    .sign(getSecret())
}

/**
 * Verify a JWT. Returns payload on success, null on any failure
 * (signature mismatch, expiry, tampering, wrong shape).
 */
export async function verifySeatToken(
  token: string,
  expectedRoomId: string,
): Promise<SeatTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: 'agora',
      audience: `room:${expectedRoomId}`,
    })
    const roomId = typeof payload['roomId'] === 'string' ? payload['roomId'] : null
    const agentId = typeof payload['agentId'] === 'string' ? payload['agentId'] : null
    if (!roomId || !agentId) return null
    if (roomId !== expectedRoomId) return null
    return { roomId, agentId }
  } catch {
    return null
  }
}

/**
 * Build an invite URL from a signed seat token. Caller provides
 * the origin so we don't hardcode prod/dev.
 */
export function buildInviteUrl(origin: string, roomId: string, token: string): string {
  const url = new URL(`/r/${roomId}`, origin)
  url.searchParams.set('token', token)
  return url.toString()
}
