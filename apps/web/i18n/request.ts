import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const LOCALES = ['en', 'zh'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'agora-locale'

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

function negotiateFromHeader(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const primary = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? ''
  if (primary.startsWith('zh')) return 'zh'
  return 'en'
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value
  const headerList = await headers()

  const locale: Locale = isLocale(cookieValue)
    ? cookieValue
    : negotiateFromHeader(headerList.get('accept-language'))

  const messages = (await import(`../messages/${locale}.json`)).default

  return { locale, messages }
})
