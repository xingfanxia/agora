// ============================================================
// Bubble — speech/thinking bubble above an agent on the table
// ============================================================
//
// Phase 5.2+. Simplified after feedback:
//   - Long content no longer expands in-place (the old "more" button
//     produced unreadable wall-of-text). Bubble is always clamped to
//     4 lines; clicking it triggers the parent's onClick handler
//     (AgentSeat forwards to AgentDetailModal which has scroll).
//   - Three modes: thinking (dashed + dots), speaking (solid + text),
//     idle (hidden).

'use client'

import type { AgentColor } from '../theme'

export type BubbleMode = 'thinking' | 'speaking' | 'idle'

export interface BubbleProps {
  mode: BubbleMode
  text?: string
  color: AgentColor
  /** Max width in pixels. Default 260. */
  maxWidth?: number
  /** Fires when the bubble is clicked. Parent typically opens the
   * AgentDetailModal so the user can read the full text + history. */
  onClick?: () => void
}

export function Bubble({ mode, text, color, maxWidth = 260, onClick }: BubbleProps) {
  if (mode === 'idle') return null

  const border = mode === 'thinking' ? `2px dashed ${color.name}` : `2px solid ${color.name}`

  return (
    <div
      className="agora-animated"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? 'Expand message' : undefined}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
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
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 150ms',
      }}
    >
      {mode === 'thinking' ? (
        <ThinkingDots color={color.name} />
      ) : (
        <ClampedText text={text ?? ''} hasClickAffordance={!!onClick} />
      )}

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
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 18 }}>
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

function ClampedText({ text, hasClickAffordance }: { text: string; hasClickAffordance: boolean }) {
  // Structured JSON decisions become a human-readable summary. Full JSON
  // is available in the modal via the agent's message history.
  const isDecision = text.trim().startsWith('{') && text.trim().endsWith('}')
  const display = isDecision ? summarizeDecision(text) : text
  const maybeTruncated = display.length > 180 || (display.match(/\n/g)?.length ?? 0) > 3

  return (
    <>
      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {display}
      </span>
      {maybeTruncated && hasClickAffordance && (
        <span
          aria-hidden
          style={{
            display: 'block',
            marginTop: 4,
            fontSize: 10,
            opacity: 0.55,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            fontWeight: 590,
          }}
        >
          click to read full →
        </span>
      )}
    </>
  )
}

/** Strip braces + quotes to produce a human-readable one-liner from a
 * JSON decision payload. Falls back to the raw text if parsing fails. */
function summarizeDecision(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
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
