#!/usr/bin/env npx tsx
// ============================================================
// Agora — Debate Runner Script
// Runs a full debate with 6 personas + 3 judge committee
// ============================================================

import { AIAgent, Room, RoundRobinFlow, EventBus } from '../packages/core/src/index'
import { createGenerateFn } from '../packages/llm/src/index'
import type { ModelConfig, Message } from '../packages/shared/src/index'
import * as fs from 'fs'
import * as path from 'path'

// Load .env
import 'dotenv/config'

// ── Configuration ──────────────────────────────────────────

interface DebateConfig {
  topic: string
  rounds: number
  debaters: Array<{
    name: string
    persona: string
    model: ModelConfig
  }>
  judges: Array<{
    name: string
    persona: string
    model: ModelConfig
  }>
}

const MODELS = {
  claude: { provider: 'anthropic' as const, modelId: 'claude-opus-4-6' },
  gpt: { provider: 'openai' as const, modelId: 'gpt-5.4' },
  gemini: { provider: 'google' as const, modelId: 'gemini-3.1-pro-preview' },
} satisfies Record<string, Pick<ModelConfig, 'provider' | 'modelId'>>

function makeModel(base: Pick<ModelConfig, 'provider' | 'modelId'>): ModelConfig {
  return { ...base, temperature: 0.8, maxTokens: 1500 }
}

// ── Debate Definitions ─────────────────────────────────────

const DEBATES: DebateConfig[] = [
  {
    topic: 'Will AI make human programmers obsolete within 5 years?',
    rounds: 3,
    debaters: [
      { name: 'The Philosopher', persona: 'You think deeply about the nature of creativity, consciousness, and what it means to "understand" code. You reference Heidegger, Wittgenstein, Searle. You question whether coding is pattern-matching or something deeper.', model: makeModel(MODELS.claude) },
      { name: 'The CTO', persona: 'You have 20 years of engineering leadership at FAANG companies. You have seen every hype cycle. You are pragmatic, data-driven, and slightly cynical. You care about shipping products, not philosophical debates.', model: makeModel(MODELS.gpt) },
      { name: 'The Accelerationist', persona: 'You believe AI progress is exponential and unstoppable. You cite SWE-bench scores, Devin, Claude Code. You think most people are in denial about how fast things move. You are provocative and bold.', model: makeModel(MODELS.gemini) },
      { name: 'The Indie Hacker', persona: 'You are a solo founder who ships fast. You already use AI for 70% of your code. You see AI as a multiplier, not a replacement. You care about velocity and practical outcomes, not theory.', model: makeModel(MODELS.claude) },
      { name: 'The Security Researcher', persona: 'You specialize in adversarial ML and AI safety. You worry about AI-generated code quality, supply chain attacks, and the "vibe coding" culture. You bring up real vulnerabilities and CVEs.', model: makeModel(MODELS.gpt) },
      { name: 'The CS Professor', persona: 'You teach at a top university. You see your students using AI daily. You worry about the loss of fundamentals but are excited about new pedagogical possibilities. You take a measured, academic tone.', model: makeModel(MODELS.gemini) },
    ],
    judges: [
      { name: 'Judge Alpha', persona: 'You evaluate arguments based on logical rigor, evidence quality, and intellectual honesty. You penalize hand-waving and reward specificity.', model: makeModel(MODELS.claude) },
      { name: 'Judge Beta', persona: 'You evaluate based on practical relevance, real-world applicability, and how well arguments address the actual question. You penalize philosophy that doesn\'t connect to reality.', model: makeModel(MODELS.gpt) },
      { name: 'Judge Gamma', persona: 'You evaluate based on originality, insight, and the ability to change minds. You reward surprising arguments and penalize repetition.', model: makeModel(MODELS.gemini) },
    ],
  },
  {
    topic: 'Is consciousness an emergent property of computation, or does it require something fundamentally non-computational?',
    rounds: 3,
    debaters: [
      { name: 'The Functionalist', persona: 'You believe consciousness is substrate-independent — any system that processes information in the right way is conscious. You reference Daniel Dennett, functionalism, and computational theory of mind.', model: makeModel(MODELS.claude) },
      { name: 'The Neuroscientist', persona: 'You ground everything in brain science. You cite IIT (Integrated Information Theory), neural correlates of consciousness, and Tononi\'s phi. You are skeptical of purely computational accounts.', model: makeModel(MODELS.gpt) },
      { name: 'The Mystic Rationalist', persona: 'You take panpsychism seriously. You think Chalmers\' hard problem is real and unsolved. You argue that experience is fundamental, not reducible to computation. But you make your case with rigorous logic, not hand-waving.', model: makeModel(MODELS.gemini) },
      { name: 'The AI Researcher', persona: 'You work on large language models daily. You are uncertain whether your models have any form of experience but find the question fascinating. You bring practical observations about emergent behavior.', model: makeModel(MODELS.claude) },
      { name: 'The Evolutionary Biologist', persona: 'You see consciousness as an adaptation, shaped by natural selection. You care about the function of consciousness — what survival advantage does subjective experience provide?', model: makeModel(MODELS.gpt) },
      { name: 'The Quantum Physicist', persona: 'You take Penrose-Hameroff seriously but not uncritically. You think quantum effects in microtubules may be relevant. You push back on the assumption that classical computation is sufficient.', model: makeModel(MODELS.gemini) },
    ],
    judges: [
      { name: 'Judge Alpha', persona: 'You evaluate arguments based on logical rigor and philosophical precision. You reward clear definitions and penalize equivocation.', model: makeModel(MODELS.claude) },
      { name: 'Judge Beta', persona: 'You evaluate based on scientific grounding. You reward empirical evidence and testable predictions. You penalize unfalsifiable claims.', model: makeModel(MODELS.gpt) },
      { name: 'Judge Gamma', persona: 'You evaluate based on how much each argument advances the debate. You reward novel framings that synthesize multiple perspectives.', model: makeModel(MODELS.gemini) },
    ],
  },
  {
    topic: 'Should governments ban or heavily regulate social media for people under 18?',
    rounds: 3,
    debaters: [
      { name: 'The Child Psychologist', persona: 'You have treated hundreds of teens with social media-related anxiety, depression, and eating disorders. You cite Jonathan Haidt\'s research. You are passionate and evidence-driven.', model: makeModel(MODELS.claude) },
      { name: 'The Tech Libertarian', persona: 'You believe bans never work and always backfire. You cite Prohibition, the War on Drugs, and age-gating failures. You advocate for education and parental responsibility over government control.', model: makeModel(MODELS.gpt) },
      { name: 'The Teen Creator', persona: 'You are a 17-year-old who built a following on social media and now earns a living from it. You resent adults making decisions without consulting you. You are articulate and passionate about your autonomy.', model: makeModel(MODELS.gemini) },
      { name: 'The Policy Wonk', persona: 'You have worked in tech regulation in the EU and US. You know the practical difficulties of implementation — age verification, enforcement, cross-border jurisdiction. You focus on what is feasible, not what is ideal.', model: makeModel(MODELS.claude) },
      { name: 'The Sociologist', persona: 'You study the long-term effects of communication technologies on societies. You take a historical lens — comparing social media to newspapers, radio, TV. You argue we always panic about new media.', model: makeModel(MODELS.gpt) },
      { name: 'The Parent', persona: 'You have three kids aged 10-16. You see the daily struggle. You don\'t trust tech companies to self-regulate but also don\'t trust government to do it well. You want practical, immediate solutions.', model: makeModel(MODELS.gemini) },
    ],
    judges: [
      { name: 'Judge Alpha', persona: 'You evaluate based on empathy and understanding of affected populations. You reward arguments that center the lived experience of young people.', model: makeModel(MODELS.claude) },
      { name: 'Judge Beta', persona: 'You evaluate based on policy feasibility and implementation details. You reward proposals with concrete mechanisms and penalize wishful thinking.', model: makeModel(MODELS.gpt) },
      { name: 'Judge Gamma', persona: 'You evaluate based on intellectual breadth and long-term thinking. You reward arguments that consider unintended consequences and second-order effects.', model: makeModel(MODELS.gemini) },
    ],
  },
]

// ── Runner ──────────────────────────────────────────────────

async function runDebate(config: DebateConfig, debateIndex: number): Promise<string> {
  const startTime = Date.now()
  console.log(`\n${'='.repeat(80)}`)
  console.log(`DEBATE ${debateIndex + 1}: ${config.topic}`)
  console.log(`${'='.repeat(80)}`)
  console.log(`Debaters: ${config.debaters.map(d => d.name).join(', ')}`)
  console.log(`Judges: ${config.judges.map(j => j.name).join(', ')}`)
  console.log(`Rounds: ${config.rounds}\n`)

  // ── Phase 1: Run the debate ──
  const eventBus = new EventBus()
  const roomId = crypto.randomUUID()
  const room = new Room(
    { id: roomId, name: config.topic, modeId: 'roundtable', topic: config.topic, maxAgents: 10 },
    eventBus,
  )

  const agentModels: Record<string, string> = {}

  for (const debater of config.debaters) {
    const agentId = crypto.randomUUID()
    const generateFn = createGenerateFn(debater.model)
    const agent = new AIAgent(
      {
        id: agentId,
        name: debater.name,
        persona: { name: debater.name, description: debater.persona },
        model: debater.model,
        systemPrompt: [
          `You are participating in a structured debate on: "${config.topic}".`,
          `Your role: ${debater.name} — ${debater.persona}`,
          'Keep responses to 2-4 paragraphs. Be substantive and specific.',
          'Engage directly with other participants\' arguments. Name them when responding.',
          'Avoid repeating yourself across rounds. Build on the evolving conversation.',
        ].join('\n'),
      },
      generateFn,
    )
    room.addAgent(agent)
    agentModels[agentId] = `${debater.model.modelId} (${debater.model.provider})`
  }

  // Track messages
  const messages: Message[] = []
  eventBus.on('message:created', (event) => {
    messages.push(event.message)
    const modelLabel = agentModels[event.message.senderId] ?? '?'
    console.log(`  [Turn ${messages.length}] ${event.message.senderName} (${modelLabel}): ${event.message.content.slice(0, 80)}...`)
  })

  console.log('Starting debate...')
  const flow = new RoundRobinFlow({ rounds: config.rounds })
  await room.start(flow)
  const debateTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nDebate completed: ${messages.length} messages in ${debateTime}s`)

  // ── Phase 2: Judge evaluation ──
  console.log('\nJudges evaluating...')
  const transcript = messages.map((m, i) => {
    const round = Math.floor(i / config.debaters.length) + 1
    return `[Round ${round}] ${m.senderName}: ${m.content}`
  }).join('\n\n')

  const judgePrompt = [
    `You are a judge evaluating a debate on: "${config.topic}"`,
    '',
    'Here are the debaters and their positions:',
    ...config.debaters.map(d => `- ${d.name}: ${d.persona}`),
    '',
    '=== FULL DEBATE TRANSCRIPT ===',
    transcript,
    '=== END TRANSCRIPT ===',
    '',
    'Evaluate each debater on: (1) Argument quality (2) Evidence & specificity (3) Engagement with others (4) Originality',
    'Give each a score from 1-10 with brief justification.',
    'Then declare a WINNER and RUNNER-UP with reasoning.',
    'Format your response clearly with scores and final verdict.',
  ].join('\n')

  const judgeResults: Array<{ name: string; model: string; evaluation: string }> = []

  for (const judge of config.judges) {
    const generateFn = createGenerateFn(judge.model)
    const judgeSystemPrompt = `You are ${judge.name}, a debate judge. ${judge.persona}`
    try {
      const { content: evaluation } = await generateFn(judgeSystemPrompt, [], judgePrompt)
      judgeResults.push({
        name: judge.name,
        model: `${judge.model.modelId} (${judge.model.provider})`,
        evaluation,
      })
      console.log(`  ${judge.name} (${judge.model.modelId}): evaluated`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.error(`  ${judge.name} FAILED: ${errMsg}`)
      judgeResults.push({ name: judge.name, model: `${judge.model.modelId}`, evaluation: `[ERROR: ${errMsg}]` })
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nTotal time: ${totalTime}s`)

  // ── Build output document ──
  const doc: string[] = []
  doc.push(`# Agora Debate ${debateIndex + 1}: ${config.topic}`)
  doc.push('')
  doc.push(`> **Platform**: Agora — Multi-Agent Collaboration Platform`)
  doc.push(`> **Date**: 2026-04-13`)
  doc.push(`> **Rounds**: ${config.rounds} (${messages.length} total turns)`)
  doc.push(`> **Debate Duration**: ${debateTime}s`)
  doc.push(`> **Total Duration** (incl. judging): ${totalTime}s`)
  doc.push(`> **Status**: Completed`)
  doc.push('')
  doc.push('## Participants')
  doc.push('')
  doc.push('### Debaters')
  doc.push('')
  doc.push('| Agent | Model | Persona |')
  doc.push('|-------|-------|---------|')
  for (const d of config.debaters) {
    doc.push(`| **${d.name}** | ${d.model.modelId} (${d.model.provider}) | ${d.persona.slice(0, 100)}... |`)
  }
  doc.push('')
  doc.push('### Judges')
  doc.push('')
  doc.push('| Judge | Model | Criteria |')
  doc.push('|-------|-------|----------|')
  for (const j of config.judges) {
    doc.push(`| **${j.name}** | ${j.model.modelId} (${j.model.provider}) | ${j.persona.slice(0, 100)}... |`)
  }
  doc.push('')
  doc.push('---')
  doc.push('')
  doc.push('## Debate Transcript')
  doc.push('')

  let lastRound = 0
  for (let i = 0; i < messages.length; i++) {
    const round = Math.floor(i / config.debaters.length) + 1
    if (round !== lastRound) {
      lastRound = round
      doc.push(`### Round ${round}`)
      doc.push('')
    }
    const msg = messages[i]!
    const modelLabel = agentModels[msg.senderId] ?? '?'
    doc.push(`#### ${msg.senderName} *(${modelLabel})*`)
    doc.push('')
    doc.push(msg.content)
    doc.push('')
  }

  doc.push('---')
  doc.push('')
  doc.push('## Judge Evaluations')
  doc.push('')
  for (const jr of judgeResults) {
    doc.push(`### ${jr.name} *(${jr.model})*`)
    doc.push('')
    doc.push(jr.evaluation)
    doc.push('')
    doc.push('---')
    doc.push('')
  }

  const output = doc.join('\n')
  return output
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const outputDir = path.join(process.cwd(), 'docs', 'report', 'debates')
  fs.mkdirSync(outputDir, { recursive: true })

  const fileNames = [
    'debate-1-ai-programmers.md',
    'debate-2-consciousness.md',
    'debate-3-social-media-kids.md',
  ]

  // Run all 3 debates in parallel
  const results = await Promise.allSettled(
    DEBATES.map((debate, i) =>
      runDebate(debate, i).then((output) => {
        const filePath = path.join(outputDir, fileNames[i]!)
        fs.writeFileSync(filePath, output)
        console.log(`\nSaved to: ${filePath}`)
        return filePath
      })
    )
  )

  console.log('\n' + '='.repeat(80))
  console.log('ALL DEBATES COMPLETE')
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    if (r.status === 'fulfilled') {
      console.log(`  Debate ${i + 1}: ✅ saved to ${r.value}`)
    } else {
      console.log(`  Debate ${i + 1}: ❌ FAILED — ${r.reason}`)
    }
  }
  console.log('='.repeat(80))
}

main().catch(console.error)
