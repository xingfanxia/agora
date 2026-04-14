import { cookies } from 'next/headers'
import { LOCALES, LOCALE_COOKIE, type Locale } from '../../i18n/request'

const AGENT_LANG_COOKIE = 'agora-agent-lang'

export type AgentLanguage = Locale

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Resolve the agent language preference.
 * Order: explicit argument → agent-language cookie → UI locale cookie → 'en'.
 */
export async function resolveAgentLanguage(explicit?: string | null): Promise<AgentLanguage> {
  if (isLocale(explicit)) return explicit
  const store = await cookies()
  const agentLang = store.get(AGENT_LANG_COOKIE)?.value
  if (isLocale(agentLang)) return agentLang
  const uiLocale = store.get(LOCALE_COOKIE)?.value
  if (isLocale(uiLocale)) return uiLocale
  return 'en'
}

/** Build a directive instructing an agent to respond in a given language. */
export function buildLanguageDirective(lang: AgentLanguage): string {
  if (lang === 'zh') {
    return [
      '语言要求:请始终使用简体中文进行所有交流、推理、投票理由与角色扮演,无论题目、名字或规则的原始语言为何。',
      '保持原汁原味的中式表达,避免生硬直译。人名可使用拼音或原名。',
    ].join('\n')
  }
  return 'LANGUAGE: Always respond in English for all dialogue, reasoning, and decisions.'
}

export { AGENT_LANG_COOKIE }
