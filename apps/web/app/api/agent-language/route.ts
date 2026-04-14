import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LOCALES } from '../../../i18n/request'
import { AGENT_LANG_COOKIE } from '../../lib/language'

export const dynamic = 'force-dynamic'

type Pref = 'auto' | 'en' | 'zh'

function isPref(value: unknown): value is Pref {
  if (value === 'auto') return true
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { language?: unknown } | null
  const pref = body?.language
  if (!isPref(pref)) {
    return NextResponse.json({ error: 'invalid language' }, { status: 400 })
  }
  const store = await cookies()
  if (pref === 'auto') {
    store.delete(AGENT_LANG_COOKIE)
  } else {
    store.set(AGENT_LANG_COOKIE, pref, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }
  return NextResponse.json({ language: pref })
}
