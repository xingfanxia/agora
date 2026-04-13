# Agora 辩论赛 — Blog 素材包

> 给 blog writer agent 用的完整素材和上下文

---

## 项目背景

**Agora** 是一个开源的多 Agent 协作平台，让多个 AI Agent（可以用不同的 LLM 模型）在一个房间里辩论、玩游戏、协作。灵感来自：
- 阿里国际站的 Accio Work — 多 agent 群聊协作的 UX 范式
- 卡兹克的三省六部模拟器 — 用 AI agent 搭一个古代朝廷
- AI 圆桌辩论 — 不同模型互相 PK

**技术栈**：TypeScript 全栈，Turborepo monorepo，Vercel AI SDK，Next.js 15
**GitHub**：https://github.com/xingfanxia/agora

## 本次实验

### 实验设计

3 场辩论，**并行执行**，每场：
- **6 个辩手** — 每个模型 2 个 persona（Claude Opus 4.6 × 2, GPT-5.4 × 2, Gemini 3.1 Pro × 2）
- **3 轮辩论** — 每轮每人发言一次 = 18 turns
- **3 个裁判** — 辩论结束后，3 个模型各一个裁判独立评分并投票

总计：**63 次 LLM 调用**（54 turns + 9 judge evaluations），总耗时 ~7.3 分钟

### 辩题

1. **Will AI make human programmers obsolete within 5 years?**（AI 能否在 5 年内让程序员失业？）
2. **Is consciousness an emergent property of computation?**（意识是计算的涌现属性吗？）
3. **Should governments ban social media for people under 18?**（政府是否应该禁止未成年人使用社交媒体？）

### 辩手阵容

#### Debate 1: AI vs 程序员
| 角色 | 模型 | 人设 |
|------|------|------|
| The Philosopher | Claude Opus 4.6 | 深思创造力与意识本质，引用海德格尔、维特根斯坦 |
| The CTO | GPT-5.4 | 20 年 FAANG 工程领导经验，务实、数据驱动、略显愤世嫉俗 |
| The Accelerationist | Gemini 3.1 Pro | 相信 AI 进步呈指数级，引用 SWE-bench 分数，认为大多数人在否认 |
| The Indie Hacker | Claude Opus 4.6 | 独立创始人，已用 AI 写 70% 代码，关注速度和实际结果 |
| The Security Researcher | GPT-5.4 | 对抗性 ML 和 AI 安全专家，担忧 AI 代码质量和供应链攻击 |
| The CS Professor | Gemini 3.1 Pro | 顶尖大学教授，看到学生每天用 AI，担忧基础能力丧失 |

#### Debate 2: 意识之辩
| 角色 | 模型 | 人设 |
|------|------|------|
| The Functionalist | Claude Opus 4.6 | 意识与基质无关，引用 Dennett、功能主义 |
| The Neuroscientist | GPT-5.4 | 基于脑科学，引用 IIT、神经关联，怀疑纯计算解释 |
| The Mystic Rationalist | Gemini 3.1 Pro | 认真对待泛心论和 Chalmers 的困难问题 |
| The AI Researcher | Claude Opus 4.6 | 每天和 LLM 打交道，不确定模型是否有体验 |
| The Evolutionary Biologist | GPT-5.4 | 意识是适应性，关注主观体验的生存优势 |
| The Quantum Physicist | Gemini 3.1 Pro | 认真但批判性地对待 Penrose-Hameroff 理论 |

#### Debate 3: 社交媒体与未成年人
| 角色 | 模型 | 人设 |
|------|------|------|
| The Child Psychologist | Claude Opus 4.6 | 治疗过数百名有社交媒体相关焦虑的青少年 |
| The Tech Libertarian | GPT-5.4 | 认为禁令永远不会奏效，主张教育和家长责任 |
| The Teen Creator | Gemini 3.1 Pro | 17 岁，靠社交媒体谋生，反感大人替他做决定 |
| The Policy Wonk | Claude Opus 4.6 | 在欧盟和美国做过科技监管，关注可行性 |
| The Sociologist | GPT-5.4 | 研究通信技术对社会的长期影响，历史视角 |
| The Parent | Gemini 3.1 Pro | 三个孩子（10-16 岁），每天面对这个问题 |

### 裁判阵容（每场相同结构，不同评判标准）

| 裁判 | 模型 | 评判标准 |
|------|------|---------|
| Judge Alpha | Claude Opus 4.6 | 逻辑严谨性、证据质量、intellectual honesty |
| Judge Beta | GPT-5.4 | 实际可行性、现实世界适用性 |
| Judge Gamma | Gemini 3.1 Pro | 原创性、洞察力、改变他人想法的能力 |

## 关键发现

### 技术验证
1. **Working Memory 有效** — agents 跨 3 轮辩论持续引用其他人的观点（"The Philosopher wants us to believe..."），记忆系统工作正常
2. **多模型协作稳定** — Claude Opus 4.6 / GPT-5.4 / Gemini 3.1 Pro 三个模型 63 次调用零失败
3. **并行执行高效** — 3 场辩论并行跑，总耗时 ~7 分钟（vs 串行 ~21 分钟）
4. **角色一致性强** — 每个 agent 在 3 轮辩论中始终保持角色特点（Teen Creator 始终愤怒、CTO 始终务实、Philosopher 始终引用哲学家）

### 内容质量观察
- **Claude Opus 4.6** 最擅长综合多方观点、构建框架性论述
- **GPT-5.4** 最擅长实操层面的分析，数据和案例引用
- **Gemini 3.1 Pro** 最擅长挑战和攻击性论述，角色扮演最到位（Teen Creator 的愤怒感、Accelerationist 的挑衅）
- Azure OpenAI 的 content filter 比 OpenAI 直连严格，会拦截某些话题的辩论

### 有趣的引用（可作为文章亮点）
- Teen Creator (Gemini): *"It is incredibly frustrating to sit here and listen to adults debate my generation's future"*
- Accelerationist (Gemini): *"The Philosopher's retreat into Heidegger is the ultimate intellectual cope"*
- Parent (Gemini): *"Listening to this debate feels like watching architects argue over the blueprint of a house that's already on fire"*
- Indie Hacker (Claude): *"I'm living in the middle of this debate every single day"*
- Security Researcher (GPT): *"You keep collapsing 'more capable' into 'safe to delegate'"*

## 完整辩论记录

见同目录下的 3 个文件：
- `debate-1-ai-programmers.md` — 完整 transcript + judge evaluations
- `debate-2-consciousness.md` — 完整 transcript + judge evaluations
- `debate-3-social-media-kids.md` — 完整 transcript + judge evaluations

## 技术实现细节（供技术文章用）

### 架构
```
monorepo (Turborepo)
├── packages/core    — Agent (reply/observe), Room, RoundRobinFlow, EventBus
├── packages/llm     — Vercel AI SDK multi-provider (Claude, GPT, Gemini)
├── packages/modes   — Roundtable debate mode
├── packages/shared  — TypeScript 类型定义
└── apps/web         — Next.js 15 前端 + API
```

### Working Memory 实现
- 每个 Agent 维护 `history: Message[]`
- `observe(message)` 存储看到的消息
- `reply()` 时注入完整历史到 LLM prompt
- 去重机制防止同一消息被重复注入

### Judge 实现
- 辩论结束后，完整 transcript 注入 judge 的 prompt
- 每个 judge 用不同模型独立评分
- 评分维度：Argument Quality, Evidence, Engagement, Originality (1-10)
- 最后宣布 Winner 和 Runner-up

### 从 AgentScope 借鉴的设计
- `reply()` / `observe()` 二元接口（来自 AgentScope 的 AgentBase）
- `GenerateFn` 注入模式（core 包零 LLM 依赖）
- 消息广播模式（来自 AgentScope 的 MsgHub）
