import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LOCALES, LOCALE_COOKIE, type Locale } from '../../../i18n/request'

export const dynamic = 'force-dynamic'

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null
  const locale = body?.locale
  if (!isLocale(locale)) {
    return NextResponse.json({ error: 'invalid locale' }, { status: 400 })
  }
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  return NextResponse.json({ locale })
}
