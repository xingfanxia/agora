'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface AgentFormData {
  id: string
  name: string
  persona: string
  model: string
}

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' },
] as const

const DEFAULT_AGENTS: AgentFormData[] = [
  {
    id: crypto.randomUUID(),
    name: 'The Optimist',
    persona: 'You see the bright side of every argument. You believe in progress, human potential, and positive outcomes. You back up your optimism with concrete examples and evidence.',
    model: 'claude-opus-4-6',
  },
  {
    id: crypto.randomUUID(),
    name: 'The Skeptic',
    persona: 'You question assumptions and challenge conventional wisdom. You play devil\'s advocate and demand evidence. You\'re not negative — you\'re rigorous and intellectually honest.',
    model: 'gpt-5.4',
  },
  {
    id: crypto.randomUUID(),
    name: 'The Pragmatist',
    persona: 'You focus on practical implications and real-world constraints. You bridge idealism and realism by asking "how would this actually work?" You draw on historical precedents.',
    model: 'gemini-3.1-pro-preview',
  },
]

export default function CreateRoom() {
  const router = useRouter()
  const [topic, setTopic] = useState('')
  const [rounds, setRounds] = useState(3)
  const [agents, setAgents] = useState<AgentFormData[]>(DEFAULT_AGENTS)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addAgent() {
    if (agents.length >= 8) return
    setAgents([
      ...agents,
      {
        id: crypto.randomUUID(),
        name: '',
        persona: '',
        model: 'claude-sonnet-4-20250514',
      },
    ])
  }

  function removeAgent(id: string) {
    if (agents.length <= 2) return
    setAgents(agents.filter((a) => a.id !== id))
  }

  function updateAgent(id: string, field: keyof AgentFormData, value: string) {
    setAgents(agents.map((a) => (a.id === id ? { ...a, [field]: value } : a)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!topic.trim()) {
      setError('Please enter a debate topic.')
      return
    }

    for (const agent of agents) {
      if (!agent.name.trim() || !agent.persona.trim()) {
        setError('All agents must have a name and persona description.')
        return
      }
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          rounds,
          agents: agents.map((a) => {
            const modelOption = MODEL_OPTIONS.find((m) => m.value === a.model)
            return {
              name: a.name.trim(),
              persona: a.persona.trim(),
              model: a.model,
              provider: modelOption?.provider,
            }
          }),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create room')
      }

      const data = await response.json()
      router.push(`/room/${data.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      padding: '2rem',
      maxWidth: '720px',
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '2.5rem',
        paddingTop: '1rem',
      }}>
        <Link href="/" style={{
          color: 'var(--muted)',
          fontSize: '0.875rem',
          transition: 'color 0.15s',
        }}>
          Agora
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Create Debate</span>
      </div>

      <h1 style={{
        fontSize: '2rem',
        fontWeight: 700,
        letterSpacing: '-0.03em',
        marginBottom: '2rem',
      }}>
        Set up your debate
      </h1>

      <form onSubmit={handleSubmit}>
        {/* Topic */}
        <div style={{ marginBottom: '2rem' }}>
          <label
            htmlFor="topic"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)',
              marginBottom: '0.5rem',
            }}
          >
            Topic
          </label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., Should AI be open-sourced?"
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
        </div>

        {/* Rounds */}
        <div style={{ marginBottom: '2rem' }}>
          <label
            htmlFor="rounds"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)',
              marginBottom: '0.5rem',
            }}
          >
            Rounds
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRounds(n)}
                style={{
                  width: '3rem',
                  height: '3rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid',
                  borderColor: rounds === n ? 'var(--accent)' : 'var(--border)',
                  background: rounds === n ? 'var(--accent)' : 'var(--surface)',
                  color: rounds === n ? '#ffffff' : 'var(--foreground)',
                  fontSize: '1rem',
                  fontWeight: 500,
                  transition: 'all 0.15s',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Agents */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}>
            <label style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)',
            }}>
              Agents ({agents.length})
            </label>
            {agents.length < 8 && (
              <button
                type="button"
                onClick={addAgent}
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  color: 'var(--foreground)',
                  transition: 'all 0.15s',
                }}
              >
                + Add Agent
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {agents.map((agent, index) => (
              <div
                key={agent.id}
                style={{
                  padding: '1.25rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--surface)',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1rem',
                }}>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    Agent {index + 1}
                  </span>
                  {agents.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeAgent(agent.id)}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.75rem',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: 'transparent',
                        color: 'var(--danger)',
                        transition: 'all 0.15s',
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    value={agent.name}
                    onChange={(e) => updateAgent(agent.id, 'name', e.target.value)}
                    placeholder="Agent name"
                    style={{
                      flex: 1,
                      padding: '0.625rem 0.75rem',
                      fontSize: '0.875rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      outline: 'none',
                    }}
                  />
                  <select
                    value={agent.model}
                    onChange={(e) => updateAgent(agent.id, 'model', e.target.value)}
                    style={{
                      padding: '0.625rem 0.75rem',
                      fontSize: '0.875rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      outline: 'none',
                      minWidth: '180px',
                    }}
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <textarea
                  value={agent.persona}
                  onChange={(e) => updateAgent(agent.id, 'persona', e.target.value)}
                  placeholder="Describe this agent's personality, perspective, and debate style..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--background)',
                    color: 'var(--foreground)',
                    outline: 'none',
                    resize: 'vertical',
                    lineHeight: 1.5,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            color: 'var(--danger)',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: '100%',
            padding: '0.875rem',
            fontSize: '1rem',
            fontWeight: 600,
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: isSubmitting ? 'var(--muted)' : 'var(--foreground)',
            color: 'var(--background)',
            transition: 'all 0.15s',
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? 'Starting...' : 'Start Debate'}
        </button>
      </form>
    </div>
  )
}
