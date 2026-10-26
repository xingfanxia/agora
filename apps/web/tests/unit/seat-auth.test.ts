// Guest seat token is attached to client calls that need seat proof
// (/human-input, /messages); owner seats (no token) send nothing.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { seatAuthHeaders } from '../../app/room/[id]/hooks/seat-auth'

function stubStorage(entries: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in entries ? entries[k] : null),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('seatAuthHeaders', () => {
  it('guest seat with token → Bearer header', () => {
    stubStorage({ 'agora-seat-r1': JSON.stringify({ roomId: 'r1', agentId: 'a', token: 'tok' }) })
    expect(seatAuthHeaders('r1')).toEqual({ Authorization: 'Bearer tok' })
  })
  it('owner seat without token → no header (session proves it)', () => {
    stubStorage({ 'agora-seat-r1': JSON.stringify({ roomId: 'r1', agentId: 'a' }) })
    expect(seatAuthHeaders('r1')).toEqual({})
  })
  it('other room, corrupt entry or no storage → no header', () => {
    stubStorage({ 'agora-seat-r2': JSON.stringify({ token: 'tok' }), 'agora-seat-r3': '{bad' })
    expect(seatAuthHeaders('r1')).toEqual({})
    expect(seatAuthHeaders('r3')).toEqual({})
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', undefined)
    expect(seatAuthHeaders('r1')).toEqual({})
  })
})
