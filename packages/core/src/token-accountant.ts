// ============================================================
// Agora Platform — Token Accountant
// ============================================================
//
// Subscribes to message:created events, reads tokenUsage + model
// from metadata, computes cost via an injected calculator, and
// emits token:recorded events.
//
// Core stays LLM-agnostic — the cost calculator is wired from
// the outside (usually the app/script using @agora/llm).

import type { Id, LLMProvider, Message, TokenUsage, TokenUsageRecord } from '@agora/shared'
import type { EventBus } from './events.js'

type MessageCreatedEvent = { type: 'message:created'; message: Message }

export type CalculateCostFn = (
  provider: LLMProvider,
  modelId: string,
  usage: TokenUsage,
) => number

/** Per-agent aggregated totals. */
export interface AgentTokenTotals {
  agentId: Id
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

/** Per-model aggregated totals. */
export interface ModelTokenTotals {
  provider: LLMProvider
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

/** Aggregated view for a single room. */
export interface RoomTokenSummary {
  roomId: Id
  totalCost: number
  totalTokens: number
  callCount: number
  records: readonly TokenUsageRecord[]
  byAgent: ReadonlyMap<Id, AgentTokenTotals>
  byModel: ReadonlyMap<string, ModelTokenTotals>
}

// ── Implementation ──────────────────────────────────────────

function emptyAgentTotals(agentId: Id): AgentTokenTotals {
  return {
    agentId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    callCount: 0,
  }
}

function emptyModelTotals(provider: LLMProvider, modelId: string): ModelTokenTotals {
  return {
    provider,
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    callCount: 0,
  }
}

function accumulate<T extends AgentTokenTotals | ModelTokenTotals>(
  target: T,
  usage: TokenUsage,
  cost: number,
): void {
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  target.cachedInputTokens += usage.cachedInputTokens
  target.cacheCreationTokens += usage.cacheCreationTokens
  target.reasoningTokens += usage.reasoningTokens
  target.totalTokens += usage.totalTokens
  target.cost += cost
  target.callCount += 1
}

/**
 * Tracks token usage + USD cost across agents, models, and rooms.
 * Subscribes to `message:created` at construction — remember to
 * dispose() if the EventBus outlives the accountant.
 */
export class TokenAccountant {
  private readonly eventBus: EventBus
  private readonly calculateCost: CalculateCostFn
  private readonly records: TokenUsageRecord[] = []
  private readonly listener: (event: MessageCreatedEvent) => void

  constructor(eventBus: EventBus, calculateCost: CalculateCostFn) {
    this.eventBus = eventBus
    this.calculateCost = calculateCost

    this.listener = (event) => this.onMessage(event.message)
    this.eventBus.on('message:created', this.listener)
  }

  /** Unsubscribe from the EventBus. */
  dispose(): void {
    this.eventBus.off('message:created', this.listener)
  }

  /** All records captured so far (optionally filtered by room). */
  getRecords(roomId?: Id): readonly TokenUsageRecord[] {
    if (!roomId) return this.records
    return this.records.filter((r) => r.roomId === roomId)
  }

  /** Aggregated totals for a single room. */
  getSummary(roomId: Id): RoomTokenSummary {
    const records = this.records.filter((r) => r.roomId === roomId)
    const byAgent = new Map<Id, AgentTokenTotals>()
    const byModel = new Map<string, ModelTokenTotals>()

    let totalCost = 0
    let totalTokens = 0

    for (const record of records) {
      let agentTotals = byAgent.get(record.agentId)
      if (!agentTotals) {
        agentTotals = emptyAgentTotals(record.agentId)
        byAgent.set(record.agentId, agentTotals)
      }
      accumulate(agentTotals, record.usage, record.cost)

      const modelKey = `${record.provider}:${record.modelId}`
      let modelTotals = byModel.get(modelKey)
      if (!modelTotals) {
        modelTotals = emptyModelTotals(record.provider, record.modelId)
        byModel.set(modelKey, modelTotals)
      }
      accumulate(modelTotals, record.usage, record.cost)

      totalCost += record.cost
      totalTokens += record.usage.totalTokens
    }

    return {
      roomId,
      totalCost,
      totalTokens,
      callCount: records.length,
      records,
      byAgent,
      byModel,
    }
  }

  // ── Private ───────────────────────────────────────────────

  private onMessage(message: Message): void {
    const meta = message.metadata
    if (!meta) return

    const usage = meta['tokenUsage'] as TokenUsage | undefined
    const provider = meta['provider'] as LLMProvider | undefined
    const modelId = meta['modelId'] as string | undefined

    if (!usage || !provider || !modelId) return

    const cost = this.calculateCost(provider, modelId, usage)

    const record: TokenUsageRecord = {
      roomId: message.roomId,
      agentId: message.senderId,
      messageId: message.id,
      provider,
      modelId,
      usage,
      cost,
      timestamp: Date.now(),
    }

    this.records.push(record)

    this.eventBus.emit({
      type: 'token:recorded',
      roomId: record.roomId,
      agentId: record.agentId,
      messageId: record.messageId,
      provider: record.provider,
      modelId: record.modelId,
      usage: record.usage,
      cost: record.cost,
    })
  }
}

// ── Formatting helpers ───────────────────────────────────────

function fmtUSD(n: number): string {
  return `$${n.toFixed(4)}`
}

function fmtK(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

/**
 * Render a plain-text summary suitable for console output or
 * markdown-embedded reports.
 */
export function formatSummary(
  summary: RoomTokenSummary,
  agentNames: Record<Id, string> = {},
): string {
  const lines: string[] = []
  lines.push(`Room ${summary.roomId} — ${summary.callCount} LLM calls`)
  lines.push(`Total tokens: ${fmtK(summary.totalTokens)}   Total cost: ${fmtUSD(summary.totalCost)}`)
  lines.push('')

  if (summary.byModel.size > 0) {
    lines.push('By model:')
    for (const model of summary.byModel.values()) {
      lines.push(
        `  ${model.provider}/${model.modelId}: ` +
          `${model.callCount} calls, ` +
          `in ${fmtK(model.inputTokens)} / out ${fmtK(model.outputTokens)}` +
          (model.cachedInputTokens ? ` / cached ${fmtK(model.cachedInputTokens)}` : '') +
          (model.cacheCreationTokens ? ` / cache-write ${fmtK(model.cacheCreationTokens)}` : '') +
          ` — ${fmtUSD(model.cost)}`,
      )
    }
    lines.push('')
  }

  if (summary.byAgent.size > 0) {
    lines.push('By agent:')
    const agentRows = [...summary.byAgent.values()].sort((a, b) => b.cost - a.cost)
    for (const agent of agentRows) {
      const name = agentNames[agent.agentId] ?? agent.agentId
      lines.push(
        `  ${name}: ${agent.callCount} calls, ` +
          `${fmtK(agent.totalTokens)} tokens, ${fmtUSD(agent.cost)}`,
      )
    }
  }

  return lines.join('\n')
}
