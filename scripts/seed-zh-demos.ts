#!/usr/bin/env tsx
// ============================================================
// scripts/seed-zh-demos.ts
// ============================================================
// Creates 3 Chinese-language debates + 3 Chinese-language werewolf
// games against a running Agora instance. Used to seed replay
// content for the zh demo.
//
// Usage:
//   AGORA_API_URL=https://agora-panpanmao.vercel.app pnpm tsx scripts/seed-zh-demos.ts
//   AGORA_API_URL=http://localhost:3000 pnpm tsx scripts/seed-zh-demos.ts --only=debate
//   pnpm tsx scripts/seed-zh-demos.ts --only=werewolf --index=2
// ============================================================

type ModelId = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'gpt-5.4' | 'gemini-3.1-pro-preview'
type Provider = 'anthropic' | 'openai' | 'google'

const MODEL_ROTATION: { value: ModelId; provider: Provider }[] = [
  { value: 'claude-opus-4-6', provider: 'anthropic' },
  { value: 'gpt-5.4', provider: 'openai' },
  { value: 'gemini-3.1-pro-preview', provider: 'google' },
  { value: 'claude-sonnet-4-6', provider: 'anthropic' },
]

function modelFor(index: number) {
  return MODEL_ROTATION[index % MODEL_ROTATION.length]!
}

// ── Debate seeds ───────────────────────────────────────────

interface DebateSeed {
  topic: string
  rounds: number
  agents: Array<{ name: string; persona: string }>
}

const DEBATE_SEEDS: DebateSeed[] = [
  {
    topic: '人工智能(AI)是否应该完全开源?',
    rounds: 3,
    agents: [
      {
        name: '林默',
        persona:
          '你是一位理想主义的开源布道者。你深信「代码自由」是数字时代最重要的权利,AI 如果不开源就会沦为少数巨头的工具。你擅长用哲学、历史先例(如 Linux、互联网协议)和对未来的乐观论述支撑观点。',
      },
      {
        name: '江雪',
        persona:
          '你是一位安全优先的怀疑派研究员。你见过足够多的 AI 被滥用的案例(深度伪造、自动化诈骗、恶意微调),对「全民开源」的后果感到警惕。你的论述扎实、举例具体,经常引用真实的安全事件与监管难题。',
      },
      {
        name: '陈浩',
        persona:
          '你是一位经济与产业视角的实用派。你不站队「开源 vs 闭源」,而是追问:谁付得起训练成本?谁来承担安全责任?开源是否能真正「民主化」,还是只是把门槛让渡给另一批大公司?你擅长用商业现实和激励结构分析问题。',
      },
    ],
  },
  {
    topic: '远程办公长期来看是否会毁掉城市文化与社区经济?',
    rounds: 3,
    agents: [
      {
        name: '王芳',
        persona:
          '你是一位 35 岁的自由职业设计师,亲身受益于远程办公。你认为远程工作让年轻人负担得起生活、让偏远城市重新焕发生机,"城市文化"的定义本来就在变化。你的论述感性而具体,常常以自己的真实生活为例。',
      },
      {
        name: '李建国',
        persona:
          '你是一位在北京开了 20 年餐馆的老板,亲眼见证写字楼空置带来的区域经济塌方。你认为"办公室 = 附近餐饮、零售、通勤、服务业的一整条生态链",远程办公是对城市活力的慢性毒药。你的观察细致,善用数字和故事。',
      },
      {
        name: '周敏',
        persona:
          '你是一位专注劳动经济学的大学青年教师。你试图用数据说话:通勤成本、生产率测量、房价溢出效应、社会资本衰减。你不下结论性的站队,而是指出"远程"不是一个而是多个截然不同的现象,需要分层次讨论。',
      },
    ],
  },
  {
    topic: '短视频平台是否应该对未成年人实施强制使用时长限制?',
    rounds: 3,
    agents: [
      {
        name: '张教授',
        persona:
          '你是一位研究青少年认知发展的心理学教授。你引用注意力碎片化、多巴胺回路、睡眠剥夺等研究,主张政府应强制每日使用上限。你表达克制,但论述紧致,不容易被反驳。',
      },
      {
        name: '刘律师',
        persona:
          '你是一位公益法律工作者。你担心"保护儿童"被用作无限扩权的理由,强调"家长责任 vs 国家责任"的界限。你擅长援引宪法、程序正义、规则可执行性来反驳粗暴的限制方案。',
      },
      {
        name: '柳老师',
        persona:
          '你是一位公立中学班主任,每天面对学生真实的情况。你既看到短视频的负面影响,也看到部分家长自己就沉迷其中,立场 ambivalent 而务实。你的发言最贴近真实案例,经常指出双方的盲区。',
      },
    ],
  },
]

// ── Werewolf seeds ───────────────────────────────────────────

interface WerewolfSeed {
  label: string
  players: string[]
  advancedRules: {
    guard?: boolean
    idiot?: boolean
    sheriff?: boolean
    lastWords?: boolean
  }
}

const WEREWOLF_SEEDS: WerewolfSeed[] = [
  {
    label: '9 人基础局',
    players: ['李明', '王芳', '张伟', '刘洋', '陈婷', '周磊', '吴娟', '郑浩', '孙丽'],
    advancedRules: {},
  },
  {
    label: '9 人 + 遗言',
    players: ['朱琳', '马良', '胡敏', '林潇', '黄琪', '高洁', '何鹏', '方琳', '袁博'],
    advancedRules: { lastWords: true },
  },
  {
    label: '12 人 预女猎守 + 警长 + 遗言',
    players: ['元宝', '雅楠', '墨白', '夜凉', '雪茗', '银杏', '青山', '白鹭', '朝霞', '月舞', '疏影', '清平'],
    advancedRules: { guard: true, sheriff: true, lastWords: true },
  },
]

// ── CLI arg parsing ───────────────────────────────────────────

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? 'all'
const indexFilter = args.find((a) => a.startsWith('--index='))
const indexValue = indexFilter ? parseInt(indexFilter.split('=')[1] ?? '', 10) : null
const dryRun = args.includes('--dry-run')

const apiUrl = (process.env.AGORA_API_URL ?? '').replace(/\/$/, '')
if (!apiUrl && !dryRun) {
  console.error('Missing AGORA_API_URL env var. Example: AGORA_API_URL=https://agora-xxx-panpanmao.vercel.app')
  process.exit(1)
}

// ── Request helpers ───────────────────────────────────────────

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>')
    throw new Error(`POST ${path} failed: ${res.status} ${text}`)
  }
  return (await res.json()) as T
}

interface PollResponse {
  status: string
  messages?: Array<unknown>
  tokenSummary?: { callCount: number; totalCost: number; totalTokens: number }
  error?: string | null
}

async function pollUntilComplete(roomId: string, label: string, timeoutMs = 30 * 60 * 1000): Promise<PollResponse | null> {
  const started = Date.now()
  let lastCallCount = -1
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${apiUrl}/api/rooms/${roomId}/messages`)
    if (!res.ok) {
      console.warn(`[${label}] snapshot fetch failed: ${res.status}`)
      await sleep(5000)
      continue
    }
    const snapshot = (await res.json()) as PollResponse
    const callCount = snapshot.tokenSummary?.callCount ?? 0
    if (callCount !== lastCallCount) {
      console.log(
        `[${label}] ${snapshot.status} · ${(snapshot.messages ?? []).length} msgs · ${callCount} calls · $${(snapshot.tokenSummary?.totalCost ?? 0).toFixed(4)}`,
      )
      lastCallCount = callCount
    }
    if (snapshot.status === 'completed' || snapshot.status === 'error') return snapshot
    await sleep(15000)
  }
  console.warn(`[${label}] timed out after ${timeoutMs / 1000}s`)
  return null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Runners ───────────────────────────────────────────────────

async function runDebate(seed: DebateSeed, label: string) {
  const payload = {
    topic: seed.topic,
    rounds: seed.rounds,
    language: 'zh',
    agents: seed.agents.map((a, i) => {
      const m = modelFor(i)
      return { name: a.name, persona: a.persona, model: m.value, provider: m.provider }
    }),
  }
  if (dryRun) {
    console.log(`[DRY] Debate ${label}:`, JSON.stringify(payload, null, 2).slice(0, 400), '...')
    return
  }
  console.log(`\n▶ Starting debate: ${label}`)
  const { roomId } = await postJSON<{ roomId: string }>('/api/rooms', payload)
  console.log(`  room: ${apiUrl}/replay/${roomId}`)
  const snapshot = await pollUntilComplete(roomId, label)
  if (snapshot?.status === 'error') console.error(`  ERROR: ${snapshot.error}`)
}

async function runWerewolf(seed: WerewolfSeed, label: string) {
  const payload = {
    language: 'zh',
    advancedRules: seed.advancedRules,
    players: seed.players.map((name, i) => {
      const m = modelFor(i)
      return { name, model: m.value, provider: m.provider }
    }),
  }
  if (dryRun) {
    console.log(`[DRY] Werewolf ${label}:`, JSON.stringify(payload, null, 2).slice(0, 400), '...')
    return
  }
  console.log(`\n▶ Starting werewolf: ${label}`)
  const { roomId } = await postJSON<{ roomId: string }>('/api/rooms/werewolf', payload)
  console.log(`  room: ${apiUrl}/replay/${roomId}`)
  const snapshot = await pollUntilComplete(roomId, label)
  if (snapshot?.status === 'error') console.error(`  ERROR: ${snapshot.error}`)
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const runDebates = only === 'all' || only === 'debate'
  const runWerewolves = only === 'all' || only === 'werewolf'

  const tasks: Promise<void>[] = []

  if (runDebates) {
    DEBATE_SEEDS.forEach((seed, i) => {
      if (indexValue != null && indexValue !== i + 1) return
      tasks.push(runDebate(seed, `debate-${i + 1}`))
    })
  }
  if (runWerewolves) {
    WEREWOLF_SEEDS.forEach((seed, i) => {
      if (indexValue != null && indexValue !== i + 1) return
      tasks.push(runWerewolf(seed, `werewolf-${i + 1} (${seed.label})`))
    })
  }

  console.log(`Launching ${tasks.length} games in parallel against ${apiUrl || '(dry)'}…\n`)
  await Promise.all(tasks)
  console.log('\n✓ All seed games settled (completed / errored / timed out).')
  console.log(`  Browse: ${apiUrl}/replays`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
