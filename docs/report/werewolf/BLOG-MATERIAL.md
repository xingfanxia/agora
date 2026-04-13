# Agora 狼人杀 — Blog 素材包

> 给 blog writer agent 用的完整素材和上下文

---

## 项目背景

**Agora** 是一个开源的多 Agent 协作平台，让多个 AI Agent 在一个房间里辩论、玩游戏、协作。Phase 1（圆桌辩论）验证了平台核心。Phase 2 引入了 **狼人杀**——这是 Agora 的第一个"真正的游戏模式"，需要信息隔离、状态机流程控制、结构化输出三大核心能力。

**技术栈**：TypeScript 全栈，Turborepo monorepo，Vercel AI SDK，Next.js 15
**GitHub**：https://github.com/xingfanxia/agora

---

## Phase 2 的核心挑战

Phase 1（辩论）所有 Agent 看到相同信息。狼人杀打破了这个前提：

1. **信息隔离** — 狼人能私聊，但村民看不到。预言家有私人查验结果。女巫有私人操作。
2. **状态机** — 游戏有严格的阶段流转：夜晚→白天→投票，每个阶段允许不同的角色行动。
3. **结构化输出** — 投票必须是合法玩家名字，女巫操作必须是 save/poison/pass。不能让 LLM 自由发挥。
4. **同时投票** — 投票人不能看到其他人的投票，防止"跟票"效应。
5. **游戏逻辑** — 女巫不能自救、一晚只能用一瓶药、猎人被毒不能开枪……大量边缘情况。

---

## 技术实现

### Channel 系统（信息隔离）

```
#main          — 所有存活玩家（白天讨论、天亮公告）
#werewolf      — 仅狼人（夜晚讨论）
#wolf-vote     — 无订阅者（盲投 — 狼人投票）
#seer-result   — 仅预言家（查验结果）
#witch-action  — 仅女巫（药水操作）
#day-vote      — 无订阅者（盲投 — 白天投票）
```

关键设计：**盲投通道**。`wolf-vote` 和 `day-vote` 频道没有任何订阅者。Agent 的投票消息发到这些频道后，没有任何 Agent 会通过 `observe()` 收到它们。投票结果由 `onExit` 钩子统计后通过公告消息发布。

### StateMachineFlow（状态机）

通用状态机 FlowController，不包含任何狼人杀特有逻辑：

- **PhaseConfig** — 定义每个阶段的发言者、频道、指令、Zod schema、进入/退出钩子
- **TransitionRule** — 定义阶段间转换条件（所有人发言完毕、投票完成等）
- **动态 Schema** — `getSchema(agentId, gameState)` 根据游戏状态动态生成 Zod schema

狼人杀的游戏流程完全通过配置表达：

```
wolfDiscuss → wolfVote → witchAction → seerCheck → dawn
    → hunterShoot → checkWin → dayDiscuss → dayVote
    → hunterShoot → checkWin → (回到 wolfDiscuss 或终局)
```

### 结构化输出（Zod Schemas）

投票 schema 动态生成——只包含存活玩家名字：

```typescript
createDayVoteSchema(['Elena', 'Yuki', 'Nora', 'skip'])
// → z.object({ target: z.enum([...]), reason: z.string() })
```

Vercel AI SDK 的 `generateObject` + Zod 确保 LLM 输出严格匹配 schema。加了 3 次重试逻辑。

### 中国狼人杀标准规则

基于口袋狼人杀、GameRes、网易狼人杀的标准规则：
- **夜间顺序**：狼人→女巫→预言家（中国标准，不同于西方的狼人→预言家→女巫）
- **女巫不能自救**
- **一晚只能用一瓶药**（解药和毒药互斥）
- **解药用过后不再告知被杀者**
- **猎人被毒不能开枪**
- **投票平票 = 平安日**（无人出局）
- **狼人意见不统一 = 空刀**（无人被杀）

---

## 实验结果

### 验证场次

| 场次 | 人数 | 配置 | 胜负 | 消息数 | 耗时 |
|------|------|------|------|--------|------|
| Game 1 | 6人 | 2W+1S+1W+2V | 村民胜（女巫毒死狼人） | 29 | 2.9min |
| Game 2 | 6人 | 2W+1S+1W+2V | 狼人胜（白天票出女巫） | 29 | 2.3min |
| Game 3 | 9人 | 3W+1S+1W+1H+3V | 狼人胜（操控村民票出预言家） | 40 | 4.0min |

### 关键观察

1. **模型角色扮演能力** — Claude Opus 4.6 最擅长长期战略和信息隐藏。GPT-5.4 数据驱动分析最强。Gemini 3.1 Pro 最具攻击性和挑衅性。
2. **狼人的信息优势巨大** — 3v6 的情况下，狼人有私聊频道可以协调策略，村民只能在公开讨论中猜测。
3. **女巫的决策质量** — AI 女巫倾向于第一晚救人（合理），但毒药使用经常出错（Game 3 中毒了猎人而不是狼人）。
4. **预言家的暴露风险** — Game 3 中预言家正确查出狼人，但在白天讨论中推人太明显，反被狼人操控票出。
5. **结构化投票有效** — 所有投票都生成了合法的 JSON，Zod schema 约束了投票目标必须是存活玩家。

### 精彩瞬间

**Game 1** — Elena（狼人）开场哀悼 Dmitri 的"死亡"，但女巫已经救了他。所有人立刻质疑："大家都活着，你怎么知道他被攻击了？" 狼人暴露。

**Game 3** — Marcus（预言家）查出 Felix（狼人），但在白天讨论中被狼人联合反击："Marcus 在没有足够信息的情况下就开始指认"。3 个狼人 + 被操控的村民一起投票淘汰了预言家。经典的"反水"剧情。

**Game 3** — Nora（女巫）第二晚毒了 Kai（猎人），以为 Kai 是狼人（因为 Kai 带头投了预言家）。这个错误直接导致猎人无法开枪，狼人获胜。女巫的毒药选择是 AI 狼人杀中最难的决策点。

---

## 完整辩论记录

见同目录下的 3 个 transcript 文件。

---

## 技术亮点（供技术博客用）

### 信息隔离的优雅实现

不需要复杂的权限系统。Channel 的 `subscribe/unsubscribe` + Room 的消息路由 = 完美的信息隔离。盲投只需要创建一个没有订阅者的频道。

### 状态机的复用性

`StateMachineFlow` 完全不知道自己在跑狼人杀。它只知道阶段、转换条件、钩子。同样的状态机可以跑任何有阶段流转的游戏（剧本杀、TRPG 等）。

### 动态 Zod Schema

每个投票阶段的 schema 是动态生成的——基于当前存活玩家列表。这意味着 LLM 不可能投票给已死亡的玩家或自己。

### 从 AgentScope 偷来的好设计

1. `reply() + observe()` 二元接口
2. `MsgHub` → 我们的 Channel 系统
3. 动态约束模型（他们用 Pydantic Literal，我们用 Zod enum）
4. 结算逻辑和信息展示分离

### 我们做得更好的地方

1. **真正的同时投票** — AgentScope 的投票是顺序执行的，只是关闭了 auto_broadcast。我们的盲投频道确保投票消息不会被任何人 observe()。
2. **TypeScript 全栈** — 前后端同一语言，类型安全从 Zod schema 到 API 到 UI。
3. **通用状态机** — AgentScope 用硬编码的 Python 循环，我们用可配置的 StateMachineConfig。
4. **规则正确性** — 中国狼人杀标准规则，不是简化版。
