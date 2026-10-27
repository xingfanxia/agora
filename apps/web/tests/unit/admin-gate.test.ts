// Operator entry points fail closed: /admin/rooms/[id] (live roles +
// full game state) and /api/rooms/tick-all reject every caller when
// their secret env var is unset, and compare secrets in constant time.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const db = vi.hoisted(() => ({ getDb: vi.fn(), getStuckRooms: vi.fn(async () => []) }))
vi.mock('@agora/db', () => ({ getDb: db.getDb, events: {}, rooms: {} }))
vi.mock('../../app/lib/room-store', () => ({ getStuckRooms: db.getStuckRooms }))

import AdminRoomPage from '../../app/admin/rooms/[id]/page'
import { GET as tickAllGet, POST as tickAll } from '../../app/api/rooms/tick-all/route'
import { secretMatches } from '../../app/lib/secret-match'

const saved = { admin: process.env.AGORA_ADMIN_SECRET, cron: process.env.CRON_SECRET }
afterEach(() => {
  process.env.AGORA_ADMIN_SECRET = saved.admin
  process.env.CRON_SECRET = saved.cron
  if (saved.admin === undefined) delete process.env.AGORA_ADMIN_SECRET
  if (saved.cron === undefined) delete process.env.CRON_SECRET
  db.getDb.mockReset()
  db.getStuckRooms.mockClear()
})

describe('secretMatches', () => {
  it('never matches when the expected secret is unset or empty', () => {
    expect(secretMatches('', undefined)).toBe(false)
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches(undefined, undefined)).toBe(false)
  })
  it('matches only the exact value', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true)
    expect(secretMatches('s3cre', 's3cret')).toBe(false)
    expect(secretMatches('s3cret-longer', 's3cret')).toBe(false)
    expect(secretMatches(null, 's3cret')).toBe(false)
  })
})

describe('/admin/rooms/[id]', () => {
  const render = async (search: Record<string, unknown>) => {
    // Authorized requests reach the DB; the mock throws there so the
    // test only observes whether the gate let the request through.
    db.getDb.mockImplementation(() => {
      throw new Error('DB_REACHED')
    })
    try {
      const el = await AdminRoomPage({
        params: Promise.resolve({ id: 'room-1' }),
        searchParams: Promise.resolve(search as never),
      })
      return renderToStaticMarkup(el)
    } catch (e) {
      return (e as Error).message
    }
  }

  it('is closed when AGORA_ADMIN_SECRET is unset (was: fully public)', async () => {
    delete process.env.AGORA_ADMIN_SECRET
    expect(await render({})).toContain('Unauthorized')
    expect(await render({ secret: '' })).toContain('Unauthorized')
    expect(db.getDb).not.toHaveBeenCalled()
  })

  it('rejects a wrong or repeated secret and admits the right one', async () => {
    process.env.AGORA_ADMIN_SECRET = 'admin-secret'
    expect(await render({ secret: 'nope' })).toContain('Unauthorized')
    expect(await render({ secret: ['admin-secret', 'x'] })).toContain('Unauthorized')
    expect(await render({ secret: 'admin-secret' })).toBe('DB_REACHED')
  })
})

describe('POST /api/rooms/tick-all', () => {
  const call = (auth?: string) =>
    tickAll(new Request('http://x/api/rooms/tick-all', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

  it('refuses to run without CRON_SECRET', async () => {
    delete process.env.CRON_SECRET
    expect((await call('Bearer ')).status).toBe(503)
  })

  it('requires the exact bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await call()).status).toBe(401)
    expect((await call('Bearer cron')).status).toBe(401)
    expect((await call('cron-secret')).status).toBe(401)
    expect((await call('Bearer cron-secret')).status).toBe(200)
    expect(db.getStuckRooms).toHaveBeenCalledTimes(1)
  })

  it('GET (how Vercel Cron calls it) uses the same bearer check', async () => {
    const get = (auth?: string) =>
      tickAllGet(new Request('http://x/api/rooms/tick-all', { headers: auth ? { authorization: auth } : {} }))
    delete process.env.CRON_SECRET
    expect((await get('Bearer ')).status).toBe(503)
    process.env.CRON_SECRET = 'cron-secret'
    expect((await get()).status).toBe(401)
    expect((await get('Bearer wrong')).status).toBe(401)
    expect((await get('Bearer cron-secret')).status).toBe(200)
    expect(db.getStuckRooms).toHaveBeenCalledTimes(1)
  })
})
