// ============================================================
// RoundTable — ellipse layout for N agents
// ============================================================
//
// Phase 5.2. Positions N AgentSeats around an ellipse so the table
// visually represents the group. Handles 2-12 agents; scales radii
// based on container width. Below 640px viewport, falls back to a
// compact two-column grid (handled in RoundtableView/WerewolfView
// wrappers, not here — this component assumes it has room).

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentSeat, type AgentSeatProps } from './AgentSeat'

export interface RoundTableAgent extends Omit<AgentSeatProps, 'onClick'> {
  agentId: string
}

export interface RoundTableProps {
  agents: readonly RoundTableAgent[]
  /** Called when an agent seat is clicked. */
  onAgentClick?: (agentId: string) => void
  /** Optional center content (e.g., phase banner, topic). */
  children?: React.ReactNode
  /** Minimum height the table will render at. Default 460px. */
  minHeight?: number
}

/**
 * Position on an ellipse. index=0 starts at the top and walks clockwise.
 * rx/ry are the ellipse radii in pixels relative to the container center.
 */
function ellipsePosition(
  index: number,
  total: number,
  rx: number,
  ry: number,
): { x: number; y: number } {
  if (total === 1) return { x: 0, y: 0 }
  const angle = (2 * Math.PI * index) / total - Math.PI / 2
  return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) }
}

export function RoundTable({
  agents,
  onAgentClick,
  children,
  minHeight = 460,
}: RoundTableProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: minHeight })

  // Observe container size so ellipse scales with viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ w: width, h: Math.max(minHeight, height) })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [minHeight])

  // Ellipse radii scale with container, leaving room for bubbles above
  // and labels below each seat (~100px padding vertical, ~80px horiz).
  const { rx, ry } = useMemo(() => {
    const rx = Math.max(160, (size.w - 180) / 2)
    const ry = Math.max(120, (size.h - 220) / 2)
    return { rx, ry }
  }, [size])

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        minHeight,
        height: '100%',
      }}
    >
      {/* Center area for phase banner, topic, etc. */}
      {children && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          {children}
        </div>
      )}

      {/* Seats */}
      {agents.map((agent, i) => {
        const { x, y } = ellipsePosition(i, agents.length, rx, ry)
        return (
          <div
            key={agent.agentId}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              // Z-index by index so most recent speakers tend to render atop.
              zIndex: i + 1,
            }}
          >
            <AgentSeat {...agent} onClick={onAgentClick} />
          </div>
        )
      })}
    </div>
  )
}
