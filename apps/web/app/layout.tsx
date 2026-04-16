import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { AppShell } from './components/AppShell'
import './globals.css'

// Inter Variable per DESIGN.md §3 — weights 400 (read), 510 (UI), 590 (strong emphasis).
// OpenType features cv01 + ss03 are applied globally via body font-feature-settings.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  axes: ['opsz'],
})

// Geist Mono kept for code blocks / event timeline until Berkeley Mono is licensed.
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'Agora',
  description: 'Multi-agent collaboration platform where AI minds gather to debate, investigate, and play.',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale}>
      <body className={`${inter.variable} ${geistMono.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppShell>{children}</AppShell>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
