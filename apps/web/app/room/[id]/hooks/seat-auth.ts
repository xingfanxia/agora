// Client-only: Authorization header for the viewer's claimed seat.
//
// Guests who joined via an /r/ invite have a signed seat token stored at
// `agora-seat-<roomId>` (see app/r/[roomId]/ClaimSeat.tsx). Server routes
// (/messages, /human-input) accept that token as proof of the seat; the
// room owner's own seat entry has no token and is proven by their session.

export function seatAuthHeaders(roomId: string): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(`agora-seat-${roomId}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { token?: unknown }
    return typeof parsed.token === 'string' && parsed.token
      ? { Authorization: `Bearer ${parsed.token}` }
      : {}
  } catch {
    return {}
  }
}
