'use client'

import type {
  PlaybackControls as Controls,
  PlaybackSpeed,
  PlaybackState,
} from '../hooks/useReplayPlayback'

interface Props {
  state: PlaybackState
  controls: Controls
}

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5, 10, 'instant']

export function PlaybackControls({ state, controls }: Props) {
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientX - rect.left) / rect.width
    controls.seekFraction(fraction)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        padding: '0.875rem 1rem',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Scrubber */}
      <div
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(state.progress * 100)}
        tabIndex={0}
        onMouseDown={onScrub}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') controls.seekFraction(Math.max(0, state.progress - 0.05))
          if (e.key === 'ArrowRight') controls.seekFraction(Math.min(1, state.progress + 0.05))
        }}
        style={{
          position: 'relative',
          height: '8px',
          borderRadius: '999px',
          background: 'var(--border)',
          cursor: 'pointer',
          userSelect: 'none',
          outline: 'none',
        }}
      >
        <div
          style={{
            width: `${state.progress * 100}%`,
            height: '100%',
            borderRadius: '999px',
            background: 'var(--accent)',
            transition: 'width 0.08s linear',
          }}
        />
        {/* Playhead dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${state.progress * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 0 2px var(--background)',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          fontSize: '0.8rem',
          color: 'var(--muted)',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={controls.toggle}
          style={{
            padding: '0.375rem 0.875rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--foreground)',
            color: 'var(--background)',
            cursor: 'pointer',
            minWidth: '90px',
          }}
        >
          {state.playing ? '⏸ Pause' : state.progress >= 1 ? '↺ Replay' : '▶ Play'}
        </button>

        <button
          type="button"
          onClick={controls.restart}
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: '0.8rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--background)',
            color: 'var(--foreground)',
            cursor: 'pointer',
          }}
        >
          ⏮
        </button>

        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {SPEEDS.map((s) => (
            <button
              key={String(s)}
              type="button"
              onClick={() => controls.setSpeed(s)}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.7rem',
                fontWeight: state.speed === s ? 600 : 500,
                borderRadius: '999px',
                border: `1px solid ${state.speed === s ? 'var(--accent)' : 'var(--border)'}`,
                background: state.speed === s ? 'var(--accent)' : 'transparent',
                color: state.speed === s ? '#fff' : 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              {s === 'instant' ? 'max' : `${s}x`}
            </button>
          ))}
        </div>

        <span
          style={{
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: '0.75rem',
          }}
        >
          {state.eventIndex} / {state.totalEvents} · {formatDuration(state.virtualMs)} /{' '}
          {formatDuration(state.totalMs)}
        </span>
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}
