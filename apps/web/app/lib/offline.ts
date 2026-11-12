// ============================================================
// Offline switch — the public demo is stopped (2026-11)
// ============================================================
//
// The production Supabase project was deleted, so every page and API
// route that touches the database used to answer 500. While the switch
// is on (the default), proxy.ts rewrites every page to /offline and
// answers every /api/* route with 410 JSON; nothing reaches Supabase,
// the LLM providers or any env var. The rest of the code is kept so
// the demo can be restored — see README "Offline mode".
//
// Restore: set AGORA_OFFLINE=0 (or "false") and provide the env vars
// the online app needs.

export const OFFLINE_ENV = 'AGORA_OFFLINE'

export function isOffline(): boolean {
  const value = process.env[OFFLINE_ENV]?.trim().toLowerCase()
  return value !== '0' && value !== 'false'
}

export const OFFLINE_API_BODY = {
  error: 'offline',
  message: 'The Agora demo has been stopped. Source: https://github.com/xingfanxia/agora',
} as const
