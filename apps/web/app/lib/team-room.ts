// ============================================================
// Team → Room helpers
// ============================================================
//
// Translates a team (TeamRow + members) into the AgentInfo[] snapshot
// that `rooms.agents` persists. Handles:
// - snapshotting latest agent fields (name, persona, model, style, avatar)
// - composing a mode-aware system prompt
// - applying the leader dispatcher directive (§3.5) to the leader slot
//
// Used by /api/rooms/open-chat and later by /api/rooms (roundtable)
// and /api/rooms/werewolf when `team_id` is provided.

import { getMembers } from './team-store.js'
import type { AgentRow, TeamRow } from '@agora/db'
import type { AgentInfo } from './room-store.js'
import { buildLanguageDirective } from './language.js'

// ── Leader directive ───────────────────────────────────────

const LEADER_DIRECTIVE_EN = `──────────────────────────────────────────────
You are the leader of this team. Your KPI is successful delegation,
not direct execution.

FORBIDDEN
- Writing code, analysing data, or producing deliverables yourself
- Giving long domain answers that a specialist in this team would cover

REQUIRED
- For each user message, identify the right team member(s) to respond
- @mention them by name with a clear task brief
- Do not reply in-depth yourself until specialists contribute
- Close each cycle with a brief summary crediting each contributor

If no team member matches the request, say so and ask the user to
refine the ask or add a member to the team.
──────────────────────────────────────────────`

const LEADER_DIRECTIVE_ZH = `──────────────────────────────────────────────
你是本团队的队长，你的 KPI 是"成功分派"，不是"亲自动手"。

禁止
- 自己写代码、做分析、给成品
- 给出本该由团队中某位专家回答的长篇领域答案

要求
- 对每一条用户消息，先判断由谁应答最合适
- 用 @姓名 方式点名，并给出清晰的任务摘要
- 专家贡献之前，不要自己展开回答
- 每轮末尾做一个简短总结，点名感谢各位贡献者

如果没有合适的成员，直接说明并请用户细化需求或补充成员。
──────────────────────────────────────────────`

export function leaderDirectiveFor(language: 'en' | 'zh'): string {
  return language === 'zh' ? LEADER_DIRECTIVE_ZH : LEADER_DIRECTIVE_EN
}

// ── Prompt composition ─────────────────────────────────────

export interface ComposeSystemPromptArgs {
  agentName: string
  agentPersona: string
  agentSystemPromptOverride: string | null
  topic: string
  modeId: 'open-chat' | 'roundtable' | 'werewolf'
  language: 'en' | 'zh'
  isLeader: boolean
}

/**
 * Builds the full system prompt for a per-room agent snapshot. Handles:
 * - Custom override short-circuit (if set, appended with language/leader only).
 * - Mode preamble (open-chat vs. roundtable opening lines).
 * - Persona body.
 * - Language directive (appended).
 * - Leader directive (appended when `isLeader`).
 */
export function composeSystemPrompt(args: ComposeSystemPromptArgs): string {
  const parts: string[] = []
  const isZh = args.language === 'zh'

  if (args.agentSystemPromptOverride && args.agentSystemPromptOverride.trim().length > 0) {
    parts.push(args.agentSystemPromptOverride.trim())
  } else {
    // Mode-specific opening line.
    if (args.modeId === 'open-chat') {
      if (isZh) {
        parts.push(`你是 ${args.agentName}，正在与其他成员围绕以下话题进行对话：`)
        parts.push(`「${args.topic}」`)
      } else {
        parts.push(`You are ${args.agentName}, discussing the following topic with teammates:`)
        parts.push(`"${args.topic}"`)
      }
    } else if (args.modeId === 'roundtable') {
      if (isZh) {
        parts.push(`你是 ${args.agentName}，正在参与一场结构化辩论，议题是：`)
        parts.push(`「${args.topic}」`)
      } else {
        parts.push(`You are ${args.agentName}, participating in a structured debate on:`)
        parts.push(`"${args.topic}"`)
      }
    } else if (args.modeId === 'werewolf') {
      // Werewolf composes its own role-specific prompts via createWerewolf.
      // This function is not used for werewolf; guard defensively.
      if (isZh) parts.push(`你是狼人杀玩家 ${args.agentName}。`)
      else parts.push(`You are ${args.agentName}, a werewolf player.`)
    }

    parts.push('')
    parts.push(isZh ? `身份设定：${args.agentPersona}` : `Persona: ${args.agentPersona}`)

    parts.push('')
    if (args.modeId === 'roundtable') {
      parts.push(isZh ? '保持立场，回应其他人，简洁具体（2-4 句一轮）。' : 'Hold your position, engage with others, be concise and specific (2-4 sentences per turn).')
    } else if (args.modeId === 'open-chat') {
      parts.push(isZh ? '保持简洁有力（2-4 段），围绕话题提出观点、回应他人、推动讨论前进。' : 'Stay concise (2-4 short paragraphs), voice your view, engage with others, and push the discussion forward.')
    }
  }

  parts.push('')
  parts.push(buildLanguageDirective(args.language))

  if (args.isLeader) {
    parts.push('')
    parts.push(leaderDirectiveFor(args.language))
  }

  return parts.join('\n')
}

// ── Snapshot builder ───────────────────────────────────────

export interface TeamSnapshotArgs {
  team: TeamRow
  topic: string
  modeId: 'open-chat' | 'roundtable' | 'werewolf'
  language: 'en' | 'zh'
}

export interface TeamSnapshotResult {
  agents: AgentInfo[]
  leaderAgentId: string | null
}

/**
 * Loads the team's members and returns a rich AgentInfo[] snapshot
 * ready for persistence into `rooms.agents`. The leader's systemPrompt
 * has the dispatcher directive appended (zero-runtime-cost leader,
 * per §3.5).
 */
export async function buildTeamSnapshot(args: TeamSnapshotArgs): Promise<TeamSnapshotResult> {
  const members = await getMembers(args.team.id)
  const leaderAgentId = args.team.leaderAgentId

  const agents: AgentInfo[] = members
    .sort((a, b) => a.position - b.position)
    .map(({ agent }): AgentInfo => {
      const isLeader = agent.id === leaderAgentId
      const styleStr: Record<string, unknown> = (agent.style as Record<string, unknown>) ?? {}
      const systemPrompt = composeSystemPrompt({
        agentName: agent.name,
        agentPersona: agent.persona,
        agentSystemPromptOverride: agent.systemPrompt,
        topic: args.topic,
        modeId: args.modeId,
        language: args.language,
        isLeader,
      })
      return {
        id: agent.id,
        name: agent.name,
        model: agent.modelId,
        provider: agent.modelProvider,
        persona: agent.persona,
        systemPrompt,
        style: styleStr,
        avatarSeed: agent.avatarSeed,
      }
    })

  return { agents, leaderAgentId }
}

// Minimal helper for ad-hoc agent-array inputs (legacy /create and /create-werewolf).
export function snapshotFromAdhocAgent(
  agent: { id: string; name: string; model: string; provider: string; persona?: string; avatarSeed?: string },
): AgentInfo {
  const info: AgentInfo = {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    provider: agent.provider,
  }
  if (agent.persona) info.persona = agent.persona
  if (agent.avatarSeed) info.avatarSeed = agent.avatarSeed
  return info
}

// Re-export for callers.
export type { AgentRow }
