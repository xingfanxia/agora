// ============================================================
// /agents/[id]/edit — edit wizard (reuses AgentWizard)
// ============================================================

'use client'

import { use, useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AgentWizard, type AgentWizardInitial } from '../../../components/AgentWizard'

interface AgentRow {
  id: string
  createdBy: string | null
  name: string
  persona: string
  systemPrompt: string | null
  modelProvider: string
  modelId: string
  style: Record<string, unknown>
  avatarSeed: string
  isTemplate: boolean
}

function toInitial(agent: AgentRow): AgentWizardInitial {
  const style = agent.style ?? {}
  const maxTokens =
    typeof style['maxTokens'] === 'number' ? (style['maxTokens'] as number) : 1024
  const language = (style['language'] === 'en' ? 'en' : 'zh') as 'zh' | 'en'
  return {
    id: agent.id,
    name: agent.name,
    persona: agent.persona,
    systemPrompt: agent.systemPrompt,
    modelProvider: agent.modelProvider as AgentWizardInitial['modelProvider'],
    modelId: agent.modelId,
    maxTokens,
    language,
    avatarSeed: agent.avatarSeed,
  }
}

export default function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const tCommon = useTranslations('common')
  const [initial, setInitial] = useState<AgentWizardInitial | null>(null)
  const [notFoundFlag, setNotFoundFlag] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/agents/${id}`)
      if (res.status === 404) {
        if (!cancelled) setNotFoundFlag(true)
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as { agent: AgentRow }
      if (data.agent.isTemplate) {
        if (!cancelled) setNotFoundFlag(true)
        return
      }
      if (!cancelled) setInitial(toInitial(data.agent))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFoundFlag) notFound()
  if (!initial) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        {tCommon('loading')}
      </div>
    )
  }
  return <AgentWizard initial={initial} onCancelHref={`/agents/${id}`} />
}
