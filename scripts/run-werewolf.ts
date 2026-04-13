#!/usr/bin/env npx tsx
// ============================================================
// Agora — Werewolf Game Runner Script
// Runs a full werewolf game with 6 agents + channel isolation
// ============================================================

import { createGenerateFn, createGenerateObjectFn } from '../packages/llm/src/index'
import { createWerewolf, type WerewolfRole, type WerewolfAdvancedRules } from '../packages/modes/src/werewolf/index'
import type { ModelConfig, Message } from '../packages/shared/src/index'
import * as fs from 'fs'
import * as path from 'path'

import 'dotenv/config'

// ── Configuration ──────────────────────────────────────────

const MODELS = {
  claude: { provider: 'anthropic' as const, modelId: 'claude-opus-4-6' },
  gpt: { provider: 'openai' as const, modelId: 'gpt-5.4' },
  gemini: { provider: 'google' as const, modelId: 'gemini-3.1-pro-preview' },
} satisfies Record<string, Pick<ModelConfig, 'provider' | 'modelId'>>

function makeModel(base: Pick<ModelConfig, 'provider' | 'modelId'>): ModelConfig {
  return { ...base, temperature: 0.7, maxTokens: 1500 }
}

// ── Agent Setup ────────────────────────────────────────────

// All available agents (pick N based on --players flag)
const ALL_AGENTS = [
  { name: 'Elena', model: makeModel(MODELS.claude) },
  { name: 'Marcus', model: makeModel(MODELS.gpt) },
  { name: 'Yuki', model: makeModel(MODELS.gemini) },
  { name: 'Dmitri', model: makeModel(MODELS.claude) },
  { name: 'Zara', model: makeModel(MODELS.gpt) },
  { name: 'Kai', model: makeModel(MODELS.gemini) },
  { name: 'Luna', model: makeModel(MODELS.claude) },
  { name: 'Felix', model: makeModel(MODELS.gpt) },
  { name: 'Nora', model: makeModel(MODELS.gemini) },
  { name: 'Oscar', model: makeModel(MODELS.claude) },
  { name: 'Ivy', model: makeModel(MODELS.gpt) },
  { name: 'Ravi', model: makeModel(MODELS.gemini) },
]

const playerCountArg = process.argv.find((a) => a.startsWith('--players='))
const playerCount = playerCountArg ? parseInt(playerCountArg.split('=')[1]!, 10) : 9
const AGENTS = ALL_AGENTS.slice(0, Math.min(playerCount, 12))

// ── Runner ──────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log('='.repeat(80))
  console.log('AGORA WEREWOLF GAME')
  console.log('='.repeat(80))
  console.log(`Players: ${AGENTS.map((a) => a.name).join(', ')}`)
  console.log(`Models: Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro`)
  console.log('')

  // Advanced rules toggle — set via CLI args or defaults
  const advancedRules: WerewolfAdvancedRules = {
    guard: process.argv.includes('--guard'),
    idiot: process.argv.includes('--idiot'),
    sheriff: process.argv.includes('--sheriff'),
    lastWords: process.argv.includes('--last-words'),
  }

  const enabledRules = Object.entries(advancedRules).filter(([, v]) => v).map(([k]) => k)
  if (enabledRules.length > 0) {
    console.log(`Advanced Rules: ${enabledRules.join(', ')}`)
  } else {
    console.log('Advanced Rules: none (base game)')
  }
  console.log('')

  // Create the game
  const result = createWerewolf(
    { agents: AGENTS, advancedRules },
    createGenerateFn,
    createGenerateObjectFn,
  )

  // Print role assignments
  console.log('ROLE ASSIGNMENTS:')
  const roleEmoji: Record<WerewolfRole, string> = {
    werewolf: '🐺',
    villager: '👤',
    seer: '🔮',
    witch: '🧪',
    hunter: '🏹',
    guard: '🛡️',
    idiot: '🃏',
  }
  for (const [agentId, role] of Object.entries(result.roleAssignments)) {
    const name = result.agentNames[agentId]
    console.log(`  ${roleEmoji[role]} ${name} — ${role}`)
  }
  console.log('')

  // Track messages
  let messageCount = 0
  let lastPhase = ''

  result.eventBus.on('phase:changed', (event) => {
    console.log(`\n--- Phase: ${event.phase} ${event.previousPhase ? `(from ${event.previousPhase})` : ''} ---`)
    lastPhase = event.phase
  })

  result.eventBus.on('message:created', (event) => {
    messageCount++
    const msg = event.message
    const channelLabel = msg.channelId === 'main' ? '' : ` [#${msg.channelId}]`
    const isDecision = msg.metadata?.['decision'] !== undefined
    const prefix = msg.senderId === 'system' ? '📢' : isDecision ? '🗳️' : '💬'

    // Truncate long messages
    const preview = msg.content.length > 120
      ? msg.content.slice(0, 120) + '...'
      : msg.content
    console.log(`  ${prefix} [${messageCount}]${channelLabel} ${msg.senderName}: ${preview}`)
  })

  result.eventBus.on('room:ended', () => {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    const gameState = result.flow.getGameState()
    const winResult = gameState.custom['winResult'] as string | undefined
    const winner = winResult === 'village_wins' ? 'VILLAGE WINS' : winResult === 'werewolves_win' ? 'WEREWOLVES WIN' : 'UNKNOWN'
    console.log(`\n${'='.repeat(80)}`)
    console.log(`GAME OVER — ${winner} — ${messageCount} messages in ${totalTime}s`)
    console.log('='.repeat(80))
  })

  // Run the game
  console.log('Starting game...\n')
  await result.room.start(result.flow)

  // Build output document
  const messages = result.room.getMessages()
  const doc = buildTranscript(result, messages, startTime)

  // Save to file
  const outputDir = path.join(process.cwd(), 'docs', 'report', 'werewolf')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `werewolf-game-${Date.now()}.md`)
  fs.writeFileSync(outputPath, doc)
  console.log(`\nTranscript saved to: ${outputPath}`)
}

// ── Transcript Builder ──────────────────────────────────────

function buildTranscript(
  result: Awaited<ReturnType<typeof createWerewolf>>,
  messages: readonly Message[],
  startTime: number,
): string {
  const lines: string[] = []
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

  lines.push('# Agora Werewolf Game Transcript')
  lines.push('')
  lines.push(`> **Date**: ${new Date().toISOString().split('T')[0]}`)
  lines.push(`> **Players**: ${Object.values(result.agentNames).join(', ')}`)
  lines.push(`> **Messages**: ${messages.length}`)
  lines.push(`> **Duration**: ${totalTime}s`)
  lines.push('')

  // Role table
  lines.push('## Role Assignments')
  lines.push('')
  lines.push('| Player | Role | Model |')
  lines.push('|--------|------|-------|')
  for (const [agentId, role] of Object.entries(result.roleAssignments)) {
    const name = result.agentNames[agentId]
    const agent = AGENTS.find((a) => a.name === name)
    const model = agent ? `${agent.model.modelId}` : '?'
    lines.push(`| **${name}** | ${role} | ${model} |`)
  }
  lines.push('')

  // Messages grouped by channel activity
  lines.push('## Game Transcript')
  lines.push('')

  let currentPhase = ''
  for (const msg of messages) {
    // Detect phase from metadata or channel
    const phaseLabel = msg.channelId === 'werewolf' ? 'Night (Wolf Channel)'
      : msg.channelId === 'seer-result' ? 'Night (Seer)'
      : msg.channelId === 'witch-action' ? 'Night (Witch)'
      : 'Day'

    if (phaseLabel !== currentPhase) {
      currentPhase = phaseLabel
      lines.push(`### ${phaseLabel}`)
      lines.push('')
    }

    const isSystem = msg.senderId === 'system'
    const isDecision = msg.metadata?.['decision'] !== undefined

    if (isSystem) {
      lines.push(`> **${msg.senderName}**: ${msg.content}`)
    } else if (isDecision) {
      const decision = msg.metadata!['decision'] as Record<string, unknown>
      lines.push(`**${msg.senderName}** (decision):`)
      lines.push('```json')
      lines.push(JSON.stringify(decision, null, 2))
      lines.push('```')
    } else {
      lines.push(`**${msg.senderName}**:`)
      lines.push(msg.content)
    }
    lines.push('')
  }

  // Final state
  lines.push('## Game Result')
  lines.push('')
  const gameState = result.flow.getGameState()
  const winResult = gameState.custom['winResult']
  if (winResult === 'werewolves_win') {
    lines.push('**The Werewolves Win!** The wolves have overrun the village.')
  } else if (winResult === 'village_wins') {
    lines.push('**The Village Wins!** All werewolves have been eliminated.')
  } else {
    lines.push('Game ended without a clear winner.')
  }
  lines.push('')

  // Elimination timeline
  const ws = gameState.custom as unknown as { eliminatedIds: string[]; agentNames: Record<string, string>; roleMap: Record<string, string> }
  if (ws.eliminatedIds?.length > 0) {
    lines.push('### Elimination Timeline')
    lines.push('')
    for (const id of ws.eliminatedIds) {
      const name = ws.agentNames[id] ?? id
      const role = ws.roleMap[id] ?? '?'
      lines.push(`- **${name}** (${role})`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

main().catch(console.error)
