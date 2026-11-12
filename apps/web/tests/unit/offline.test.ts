// Offline switch: with AGORA_OFFLINE unset (the production default) the
// proxy never touches Supabase — pages rewrite to /offline, API routes
// answer 410 JSON. AGORA_OFFLINE=0 restores the online proxy.

import { afterEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ updateSession: vi.fn() }))
vi.mock('../../app/lib/supabase-middleware', () => session)

import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '../../proxy'
import { isOffline } from '../../app/lib/offline'

const saved = process.env.AGORA_OFFLINE
afterEach(() => {
  if (saved === undefined) delete process.env.AGORA_OFFLINE
  else process.env.AGORA_OFFLINE = saved
  session.updateSession.mockReset()
})

describe('isOffline', () => {
  it('is on unless explicitly turned off', () => {
    delete process.env.AGORA_OFFLINE
    expect(isOffline()).toBe(true)
    for (const v of ['1', 'true', '', 'yes']) {
      process.env.AGORA_OFFLINE = v
      expect(isOffline()).toBe(true)
    }
    for (const v of ['0', 'false', ' FALSE ']) {
      process.env.AGORA_OFFLINE = v
      expect(isOffline()).toBe(false)
    }
  })
})

describe('proxy while offline', () => {
  it('answers API routes with 410 JSON without touching the session', async () => {
    delete process.env.AGORA_OFFLINE
    for (const path of ['/api/agents', '/api/rooms/room-1/messages', '/api/rooms/tick-all']) {
      const res = await proxy(new NextRequest(`http://x${path}`, { method: 'POST' }))
      expect(res.status).toBe(410)
      expect(await res.json()).toMatchObject({ error: 'offline' })
    }
    expect(session.updateSession).not.toHaveBeenCalled()
  })

  it('rewrites every page to /offline', async () => {
    delete process.env.AGORA_OFFLINE
    for (const path of ['/', '/room/room-1', '/login?next=/rooms/new', '/admin/rooms/x']) {
      const res = await proxy(new NextRequest(`http://x${path}`))
      expect(res.headers.get('x-middleware-rewrite')).toBe('http://x/offline')
    }
    expect(session.updateSession).not.toHaveBeenCalled()
  })

  it('runs the online proxy when AGORA_OFFLINE=0', async () => {
    process.env.AGORA_OFFLINE = '0'
    session.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null })
    const res = await proxy(new NextRequest('http://x/api/agents'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(session.updateSession).toHaveBeenCalledOnce()
  })
})
