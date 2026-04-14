// ============================================================
// /_v2-preview — scratch route for visual QA of Phase 5.2 components
// ============================================================
//
// Renders RoundTable with mock agents at 6 / 9 / 12 count. Toggle via
// ?n=6 (default 9). Toggle thinking/speaking via ?animate=1. Not linked
// from anywhere; hit directly while developing.

'use client'

import { useEffect, useState } from 'react'
import {
  AGENT_COLORS_DARK,
  AGENT_COLORS_LIGHT,
  prefersDark,
  type AgentColor,
} from '../room/[id]/components/theme'
import { RoundTable, type RoundTableAgent } from '../room/[id]/components/v2/RoundTable'
import { PhaseBadge } from '../room/[id]/components/v2/PhaseBadge'
import { AgentAvatar } from '../room/[id]/components/v2/AgentAvatar'
import { Bubble } from '../room/[id]/components/v2/Bubble'

const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hugo', 'Ivy', 'Jules', 'Kai', 'Luna']
const PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek'] as const
const ROLES = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard']
const SAMPLE_MESSAGES = [
  'I think Bob has been very quiet — that feels suspicious to me.',
  '{"target":"Charlie","reason":"Eliminating the loud one first, village can regroup"}',
  'No way. If I were a wolf, why would I even bring it up? That is the oldest trick in the book.',
  'Let me be clear: I am a villager. Vote for Diana — she has been protecting Eve all game.',
  '{"action":"save","poisonTarget":"none","reason":"Eve is our best reasoner, keep her alive"}',
]

function mkAgents(n: number, isDark: boolean, animate: boolean): RoundTableAgent[] {
  const palette = isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT
  const fallback = palette[0]!
  return Array.from({ length: n }, (_, i) => {
    const color = palette[i % palette.length] ?? fallback
    const showBubble = animate ? i % 2 === 0 : i === 0
    const thinking = animate && i % 3 === 0 && !showBubble
    return {
      agentId: `mock-${i}`,
      name: NAMES[i] ?? `P${i}`,
      provider: PROVIDERS[i % PROVIDERS.length],
      color,
      latestMessage: showBubble
        ? { id: `msg-${i}`, content: SAMPLE_MESSAGES[i % SAMPLE_MESSAGES.length]! }
        : undefined,
      thinking,
      speaking: !thinking && showBubble,
      role: i === 0 || i === 3 ? ROLES[i % ROLES.length] : undefined,
      eliminated: i === n - 1, // last one dead
    }
  })
}

export default function V2Preview() {
  const [isDark, setIsDark] = useState(false)
  const [n, setN] = useState(9)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    setIsDark(prefersDark())
    const url = new URL(window.location.href)
    const qN = parseInt(url.searchParams.get('n') ?? '', 10)
    if (!isNaN(qN) && qN >= 2 && qN <= 12) setN(qN)
    const qAnim = url.searchParams.get('animate')
    if (qAnim === '0') setAnimate(false)
  }, [])

  const agents = mkAgents(n, isDark, animate)

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '24px 16px',
        background: 'var(--background)',
        color: 'var(--foreground)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          padding: '0 16px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>Phase 5.2 preview</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13 }}>
            agents{' '}
            <select value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[2, 4, 6, 8, 9, 10, 12].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={animate}
              onChange={(e) => setAnimate(e.target.checked)}
            />{' '}
            animate
          </label>
        </div>
      </header>

      {/* Round table */}
      <section
        style={{
          height: '72vh',
          minHeight: 520,
          background: 'var(--surface)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          marginBottom: 32,
        }}
      >
        <RoundTable agents={agents}>
          <PhaseBadge phase="dayDiscuss" label="Day Discussion" round={2} />
        </RoundTable>
      </section>

      {/* Sub-previews */}
      <section style={{ padding: '0 16px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <Subpreview title="AgentAvatar sizes">
          <div style={{ display: 'flex', gap: 16, alignItems: 'end' }}>
            {[24, 36, 48, 72].map((s) => (
              <AgentAvatar
                key={s}
                name="Alice"
                provider="anthropic"
                color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[0] as AgentColor}
                size={s}
              />
            ))}
          </div>
        </Subpreview>

        <Subpreview title="Avatar states">
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <AgentAvatar
                name="B"
                provider="openai"
                color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[1] as AgentColor}
              />
              <div style={{ fontSize: 11, marginTop: 4 }}>idle</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <AgentAvatar
                name="C"
                provider="google"
                color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[2] as AgentColor}
                speaking
              />
              <div style={{ fontSize: 11, marginTop: 4 }}>speaking</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <AgentAvatar
                name="D"
                provider="deepseek"
                color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[3] as AgentColor}
                thinking
              />
              <div style={{ fontSize: 11, marginTop: 4 }}>thinking</div>
            </div>
          </div>
        </Subpreview>

        <Subpreview title="Bubble modes">
          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
            <Bubble
              mode="thinking"
              color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[0] as AgentColor}
            />
            <Bubble
              mode="speaking"
              color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[1] as AgentColor}
              text="Short message, one line."
            />
            <Bubble
              mode="speaking"
              color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[2] as AgentColor}
              text={SAMPLE_MESSAGES[3] + ' ' + SAMPLE_MESSAGES[3] + ' ' + SAMPLE_MESSAGES[3]}
            />
            <Bubble
              mode="speaking"
              color={(isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT)[3] as AgentColor}
              text={SAMPLE_MESSAGES[1]}
            />
          </div>
        </Subpreview>
      </section>
    </main>
  )
}

function Subpreview({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        background: 'var(--surface)',
        borderRadius: 12,
        border: '1px solid var(--border)',
      }}
    >
      <h3 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--muted)' }}>{title}</h3>
      {children}
    </div>
  )
}
