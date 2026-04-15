// ============================================================
// AgentAvatarPixel — DiceBear pixel-art avatar
// ============================================================
//
// Renders the SVG as a data URI via `<img src={toDataUri()}>`. We
// deliberately avoid the raw-HTML inject React prop (§5.5) —
// `toDataUri()` is pixel-perfect and doesn't need string-to-DOM
// injection.
//
// `seed` is stable (agent id, team id, or any string). Same seed →
// identical avatar across all renders/sessions.

'use client'

import { useMemo } from 'react'
import { createAvatar } from '@dicebear/core'
import * as pixelArt from '@dicebear/pixel-art'

export interface AgentAvatarPixelProps {
  seed: string
  size?: number
  className?: string
  style?: React.CSSProperties
}

export function AgentAvatarPixel({
  seed,
  size = 48,
  className,
  style,
}: AgentAvatarPixelProps) {
  const dataUri = useMemo(
    () => createAvatar(pixelArt, { seed, size }).toDataUri(),
    [seed, size],
  )
  return (
    <img
      src={dataUri}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        background: 'var(--surface-hover)',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  )
}
