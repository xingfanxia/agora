// ============================================================
// Shared theme primitives for room UI components
// Palette, model labels, wire types.
// ============================================================

export interface AgentColor {
  bg: string
  border: string
  name: string
}

export const AGENT_COLORS_LIGHT: AgentColor[] = [
  { bg: '#f0f4ff', border: '#c7d6f7', name: '#2952a3' },
  { bg: '#fdf2f0', border: '#f5c6bc', name: '#a33929' },
  { bg: '#f0faf4', border: '#b8e6c9', name: '#29734a' },
  { bg: '#faf5f0', border: '#e8d5b8', name: '#8c6a3a' },
  { bg: '#f5f0fa', border: '#d3c1e6', name: '#5e3a8c' },
  { bg: '#f0f9fa', border: '#b8dee6', name: '#2a6b7a' },
  { bg: '#faf0f5', border: '#e6b8d3', name: '#8c3a5e' },
  { bg: '#f9faf0', border: '#dee6b8', name: '#6b7a2a' },
]

export const AGENT_COLORS_DARK: AgentColor[] = [
  { bg: '#111827', border: '#1e3a5f', name: '#6b9eff' },
  { bg: '#1c1210', border: '#5f1e1e', name: '#ff7b6b' },
  { bg: '#101c14', border: '#1e5f2e', name: '#6bff8a' },
  { bg: '#1c1810', border: '#5f4a1e', name: '#ffcc6b' },
  { bg: '#18101c', border: '#3e1e5f', name: '#c06bff' },
  { bg: '#101a1c', border: '#1e4a5f', name: '#6be5ff' },
  { bg: '#1c1018', border: '#5f1e4a', name: '#ff6bc0' },
  { bg: '#1a1c10', border: '#4a5f1e', name: '#c0ff6b' },
]

export const FALLBACK_COLOR: AgentColor = {
  bg: '#f0f4ff',
  border: '#c7d6f7',
  name: '#2952a3',
}

export const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
  'gpt-5.4': 'GPT-5.4',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'deepseek-chat': 'DeepSeek Chat',
}

export function modelLabel(modelId: string): string {
  return MODEL_LABELS[modelId] ?? modelId
}

// ── Wire types ─────────────────────────────────────────────

export interface MessageData {
  id: string
  roomId: string
  senderId: string
  senderName: string
  content: string
  channelId: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface AgentData {
  id: string
  name: string
  model: string
  provider: string
}

export interface AgentTotals {
  agentId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

export interface ModelTotals {
  provider: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

export interface TokenSummary {
  totalCost: number
  totalTokens: number
  callCount: number
  byAgent: AgentTotals[]
  byModel: ModelTotals[]
}

export interface PollResponse {
  messages: MessageData[]
  status: 'running' | 'waiting' | 'completed' | 'error'
  currentRound: number
  totalRounds: number
  currentPhase: string | null
  modeId: string
  thinkingAgentId: string | null
  agents: AgentData[]
  topic: string
  tokenSummary: TokenSummary | null
  /** Werewolf-only: agentId → role */
  roleAssignments: Record<string, string> | null
  /** Werewolf-only */
  advancedRules: Record<string, boolean> | null
  /** Werewolf-only: snapshot of custom game state (eliminated, winResult, etc.) */
  gameState: Record<string, unknown> | null
  error?: string
}

// ── Utilities ───────────────────────────────────────────────

export function fmtUSD(n: number, precision = 4): string {
  return `$${n.toFixed(precision)}`
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Build a stable agentId -> AgentColor resolver for the given palette. */
export function createAgentColorMap(
  agents: readonly AgentData[],
  isDark: boolean,
): (agentId: string) => AgentColor {
  const palette = isDark ? AGENT_COLORS_DARK : AGENT_COLORS_LIGHT
  return (agentId: string) => {
    const index = agents.findIndex((a) => a.id === agentId)
    if (index < 0) return FALLBACK_COLOR
    return palette[index % palette.length] ?? FALLBACK_COLOR
  }
}

/** Track dark-mode preference with matchMedia. */
export function prefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
