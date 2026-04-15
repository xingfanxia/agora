// ============================================================
// ViewToggle — chat ↔ table switcher
// ============================================================

'use client'

export type ViewMode = 'chat' | 'table'

export interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  chatLabel?: string
  tableLabel?: string
}

export function ViewToggle({
  mode,
  onChange,
  chatLabel = 'Chat',
  tableLabel = 'Table',
}: ViewToggleProps) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'inline-flex',
        borderRadius: 8,
        background: 'var(--surface-hover)',
        padding: 2,
        border: '1px solid var(--border)',
      }}
    >
      <Tab active={mode === 'chat'} onClick={() => onChange('chat')}>
        <span aria-hidden>💬</span> {chatLabel}
      </Tab>
      <Tab active={mode === 'table'} onClick={() => onChange('table')}>
        <span aria-hidden>⭕</span> {tableLabel}
      </Tab>
    </div>
  )
}

function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--foreground)' : 'var(--muted)',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 150ms, color 150ms',
      }}
    >
      {children}
    </button>
  )
}
