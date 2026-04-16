'use client'

interface ChannelTabsProps {
  channels: readonly { id: string; label: string; hidden?: boolean }[]
  activeChannelId: string
  onChange: (channelId: string) => void
}

/**
 * Horizontal tab strip for switching between channels.
 * Used in modes with multiple channels (werewolf: main, wolf chat, seer).
 * Single-channel modes can skip rendering it.
 */
export function ChannelTabs({ channels, activeChannelId, onChange }: ChannelTabsProps) {
  const visible = channels.filter((c) => !c.hidden)
  if (visible.length <= 1) return null

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}
    >
      {visible.map((channel) => {
        const active = channel.id === activeChannelId
        return (
          <button
            key={channel.id}
            type="button"
            onClick={() => onChange(channel.id)}
            style={{
              padding: '0.375rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: active ? 590 : 510,
              border: 'none',
              borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              background: 'transparent',
              color: active ? 'var(--foreground)' : 'var(--muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {channel.label}
          </button>
        )
      })}
    </div>
  )
}
