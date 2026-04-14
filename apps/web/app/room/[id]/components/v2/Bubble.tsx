// ============================================================
// Bubble — speech/thinking bubble above an agent on the table
// ============================================================
//
// Phase 5.2 primitive. Three visual states:
//   - thinking: dashed border, animated dots, no content
//   - speaking: solid border, content shown (clamped to 4 lines)
//   - idle: hidden (no bubble rendered)
//
// Crossfade between consecutive speaking bubbles is handled by the
// parent (AgentSeat) by unmounting the old Bubble + mounting the new
// one via React `key={lastMessageId}`. The globals.css animations
// `agora-bubble-in` / `agora-bubble-out` provide the visual.

'use client'

import { useState } from 'react'
import type { AgentColor } from '../theme'

export type BubbleMode = 'thinking' | 'speaking' | 'idle'

export interface BubbleProps {
  mode: BubbleMode
  text?: string
  color: AgentColor
  /** Max width in pixels. Default 260. */
  maxWidth?: number
}

export function Bubble({ mode, text, color, maxWidth = 260 }: BubbleProps) {
  const [expanded, setExpanded] = useState(false)

  if (mode === 'idle') return null

  const border =
    mode === 'thinking'
      ? `2px dashed ${color.name}`
      : `2px solid ${color.name}`

  const content =
    mode === 'thinking' ? (
      <ThinkingDots color={color.name} />
    ) : (
      <BubbleText text={text ?? ''} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    )

  return (
    <div
      className="agora-animated"
      style={{
        position: 'relative',
        maxWidth,
        background: color.bg,
        border,
        borderRadius: 12,
        padding: '10px 14px',
        color: color.name,
        fontSize: 13,
        lineHeight: 1.5,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        animation: 'agora-bubble-in 200ms ease-out',
      }}
    >
      {content}
      {/* Tail pointing down */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -8,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: `8px solid ${color.name}`,
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -5,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: `7px solid ${color.bg}`,
        }}
      />
    </div>
  )
}

// ── Inner pieces ──────────────────────────────────────────

function ThinkingDots({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        height: 18,
      }}
    >
      <Dot color={color} delay={0} />
      <Dot color={color} delay={150} />
      <Dot color={color} delay={300} />
    </span>
  )
}

function Dot({ color, delay }: { color: string; delay: number }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        animation: 'agora-pulse 1.2s ease-in-out infinite',
        animationDelay: `${delay}ms`,
        display: 'inline-block',
      }}
    />
  )
}

function BubbleText({
  text,
  expanded,
  onToggle,
}: {
  text: string
  expanded: boolean
  onToggle: () => void
}) {
  // Decision messages are structured JSON — show a short summary instead
  // of the raw blob to keep the round-table readable.
  const isDecision = text.trim().startsWith('{') && text.trim().endsWith('}')
  const displayText = isDecision ? summarizeDecision(text) : text
  const needsClamp = !expanded && (displayText.length > 180 || countLines(displayText) > 4)

  return (
    <>
      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: needsClamp ? 4 : 'unset',
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {displayText}
      </span>
      {needsClamp && (
        <button
          onClick={onToggle}
          style={{
            marginTop: 6,
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            fontSize: 11,
            opacity: 0.7,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          more
        </button>
      )}
      {expanded && displayText.length > 180 && (
        <button
          onClick={onToggle}
          style={{
            marginTop: 6,
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            fontSize: 11,
            opacity: 0.7,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            display: 'block',
          }}
        >
          less
        </button>
      )}
    </>
  )
}

function countLines(s: string): number {
  return s.split('\n').length
}

/** Strip braces + quotes to produce a human-readable one-liner from a
 * JSON decision payload. Falls back to the raw text if parsing fails. */
function summarizeDecision(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    // Prefer common fields in order of descriptiveness.
    if (typeof obj['target'] === 'string') {
      const reason = typeof obj['reason'] === 'string' ? ` — ${obj['reason']}` : ''
      return `→ ${String(obj['target'])}${reason}`
    }
    if (typeof obj['action'] === 'string') {
      const reason = typeof obj['reason'] === 'string' ? ` — ${obj['reason']}` : ''
      return `${String(obj['action'])}${reason}`
    }
    if (typeof obj['speech'] === 'string') {
      return String(obj['speech'])
    }
    return raw
  } catch {
    return raw
  }
}
