# Phase 4.5b — Human-Play UX Design Spec

> **Status**: V3 (V2 + /mtc user-journey critique)
> **Scope**: Design-only — wireframes, copy, interaction flows. No code.
> **Depends on**: Phase 6 (team platform), Phase 4.5a (durable runtime)
> **Unblocks**: Phase 4.5c (seat tokens + human play code), Phase 4.5d (multi-human + auth)

---

## 0. Emotional Design Goal

You're a human sitting among AI agents. The AIs respond in 2-5 seconds. Your turn takes 30-60 seconds. That asymmetry is the central design challenge.

**The experience must feel:**
- **Immersive** — you're IN the game, not watching with a text box bolted on
- **Clear** — you always know what's expected of you and how long you have
- **Alive** — during your turn, spectators and other agents see a "thinking" state, not a freeze
- **Fair** — you see exactly what your role permits, no more, no less

**The critical UX moment**: the transition from spectating (watching AI agents talk) to acting (it's your turn). This transition must be smooth, not jarring — the input panel appears naturally, with just enough advance notice.

---

## 1. Scope Ladder

| Phase | Humans | Auth | What's new |
|-------|--------|------|------------|
| **4.5c** (MVP) | 1 human + N AIs | Seat token only (no login) | HumanAgent, input panels, timer, single-seat join |
| **4.5d** | N humans + M AIs | Supabase Auth + seat tokens | Invite links, waiting room, fan-in voting, presence |

This spec covers both phases. Sections marked **(4.5d only)** can be deferred.

---

## 2. Room Creation — Human Seat Assignment

### Current flow (AI-only)
```
/teams/[id] → "开始对话" → /rooms/new?teamId=X → ModePicker → ModeConfigForm → Start
```

### New flow — MVP (4.5c, single human, V3 simplified)

**No separate step.** Inline into ModeConfigForm as one additional row:

```
┌─────────────────────────────────────────────────────────────┐
│  Configure Room                                              │
│  配置房间                                                     │
│                                                              │
│  Topic: [朕欲征南诏,诸卿以为如何?____________]                 │
│  Rounds: [3 ▾]                                               │
│                                                              │
│  ── Play as (optional) ──────────────────────────────────    │
│  │  Join as:  [🤖 AI only ▾]                              │  │
│  │            [🧑 兵部尚书 ▾]  ← pre-suggested             │  │
│  │            [🧑 吏部尚书  ]                               │  │
│  │            [🧑 户部尚书  ]                               │  │
│  │            ...                                          │  │
│  └─────────────────────────────────────────────────────────  │
│                                                              │
│  [← Back]                              [Start Room →]        │
└─────────────────────────────────────────────────────────────┘
```

**Why inline (V3)**: A full Seat Assignment page was over-designed for picking ONE seat. Three setup screens (Mode → Config → Seats → Start) is too much friction for the flagship human-play feature. One dropdown in ModeConfigForm is enough.

### New flow — Multi-human (4.5d, full page)

4.5d restores the full Seat Assignment page because multiple seats need toggles + invite links + QR codes. That page is not needed for 4.5c.

**Design decisions (carry over):**
- MVP (4.5c): only ONE seat can be human. The dropdown is: `AI only` | `[agent name 1]` | `[agent name 2]` | ...
- The human inherits the agent's name, avatar, and persona. This preserves game fairness and enables future Turing-test mode.
- For werewolf: role assignment is random at game start (as today). The human doesn't pick their role.
- The "You" badge replaces the model provider badge (no `claude`/`gpt` tag on human seats).

### Template seat suggestion
When starting from a template team, the UI should suggest a seat that makes the experience interesting:
- **Do NOT suggest the leader seat** — the leader's job is dispatching/coordinating, which is hard for a first-time human player
- **Suggest a "fun" seat** — for 当皇帝, suggest a minister with a strong personality (e.g., 兵部尚书 — direct, opinionated). For 投资团队, suggest the Contrarian (most fun to role-play).
- **Implementation**: each template JSON can include a `suggestedHumanSeat` field (agent slug). The UI pre-selects it as `You` but the user can change it.
- **Non-template teams**: no pre-selection. All seats default to `AI`.

### For modes without roles (open-chat, roundtable)
Same seat assignment UI. The human takes an agent's persona and speaks in their place during round-robin turns.

---

## 3. Invite & Join Flow

### MVP (4.5c) — Host IS the human

No invite link needed. The host creates the room and is automatically seated.

```
Host clicks "Start Room"
  → Room created with status='waiting', waiting_for={seatId: X, type: 'join'}
  → Host is redirected to /room/[id]
  → Seat token auto-generated and stored in localStorage
  → Room transitions to status='running', first tick fires
```

### Multi-human (4.5d) — Invite links

```
Host clicks "Start Room"
  → Room created with status='waiting'
  → Host gets a share panel:

    ┌─────────────────────────────────────────────┐
    │  Share invite links                          │
    │  分享邀请链接                                 │
    │                                              │
    │  吏部尚书 (You) — ✅ Joined                  │
    │  户部尚书 — 🔗 Copy link  [QR]               │
    │  礼部尚书 — 🔗 Copy link  [QR]               │
    │                                              │
    │  Waiting for 2 players...                    │
    │  等待 2 位玩家加入...                          │
    │                                              │
    │  [Start with AI backfill]  [Wait for all]    │
    └─────────────────────────────────────────────┘

  → Each link: /room/[id]?seat=[jwt]
  → On click: token stored, player sees waiting room
  → When all joined (or host clicks "Start with AI backfill"):
    room → status='running', first tick fires
```

**Invite link format**: `/room/[id]?seat=[jwt]`
- JWT payload: `{ roomId, seatId, agentName, exp: +24h }`
- On visit: token extracted from URL, stored in `localStorage` as `agora-seat-{roomId}`
- URL cleaned (remove `?seat=` param) to prevent accidental re-shares

---

## 4. Player HUD (Always-Visible State)

When you're in a room with a valid seat token, a **Player HUD** is pinned to the top of the room view. This replaces the spectator header.

### Werewolf HUD
```
┌──────────────────────────────────────────────────────┐
│  [Avatar]  吏部尚书  ·  🐺 Werewolf  ·  Night 2      │
│            Alive  ·  🛡️ Protected last night          │
│            Potions: 💊 Save ✓  ☠️ Poison ✓  (witch)  │
│            🎖️ Sheriff (if elected)                     │
└──────────────────────────────────────────────────────┘
```

**Fields (conditionally visible):**

| Field | When visible |
|-------|-------------|
| Agent name + avatar | Always |
| Role + icon | After role reveal (night 1 start) |
| Phase indicator (Night/Day + round) | Always |
| Alive/Dead status | Always |
| Protection status | Guard only, after their action |
| Potion status | Witch only |
| Sheriff badge | If elected/transferred |
| Known intel (seer results) | Seer only |

### Open-chat / Roundtable HUD
```
┌──────────────────────────────────────────────────────┐
│  [Avatar]  吏部尚书  ·  Open Chat  ·  Round 2/5      │
│            Topic: 朕欲征南诏,诸卿以为如何?              │
└──────────────────────────────────────────────────────┘
```

Simpler — just identity + mode + progress.

---

## 5. Turn Panels

The **Turn Panel** is the core human interaction surface. It appears at the bottom of the chat area when it's the human's turn, and disappears when it's not.

### General behavior
- **Entrance**: Slides up from bottom (300ms ease-out). Chat scrolls up to accommodate.
- **Exit**: Slides down (200ms ease-in). Chat reclaims the space.
- **"Your turn" chime**: Optional audio cue (Web Audio, ~200ms). Mutable via a 🔇 toggle in the HUD.
- **System message**: A system message appears in chat: `"It's your turn"` / `"轮到你了"` — this anchors the transition visually.
- **During wait (not your turn)**: The panel area shows a subtle status line: `"Waiting for 中书令 to speak..."` / `"等待中书令发言..."` with a typing dots animation.

### Human message rendering in chat (V3 addition)

**Human messages look IDENTICAL to AI messages.** Same agent name, same avatar, same bubble style. No "human" badge, no different color, no visual distinction. This is a hard rule for two reasons:
1. Game fairness — in werewolf, if everyone can tell which message is from a human, it changes voting strategies
2. Future Turing-test mode — the UI already supports anonymity by default

The only difference: human messages appear instantly (no streaming animation), since the full text is submitted at once. To avoid this "tells" the human apart, add a brief simulated typing delay (200-500ms, matching typical AI first-token latency) before the message renders.

### 5.0a. First-Turn Onboarding (V3 addition)

When the room starts and the human has NOT yet taken their first turn, show a one-time onboarding message in the status bar area:

```
┌──────────────────────────────────────────────────────────┐
│  👋 Welcome! You're playing as 吏部尚书.                  │
│     欢迎！你将扮演吏部尚书。                                │
│                                                           │
│  Watch the conversation — your turn will come at          │
│  position 5 of 9 in the round.                            │
│  观察对话 — 你将在本轮第 5/9 位发言。                        │
│                                                           │
│  [Dismiss]                                                │
└──────────────────────────────────────────────────────────┘
```

**Why this matters**: Without this, the human watches 4 AI agents talk for ~12-20 seconds with no idea when they'll get to act. The onboarding sets expectations: you're watching first, your turn is coming, here's when.

- Shown only once (first round, before first human turn)
- Auto-dismissed when the human's first turn panel appears
- Click to dismiss early

### 5.0b. Between-Turns Waiting State (V2 addition)

When it's NOT the human's turn, the turn panel area doesn't disappear entirely — it collapses to a **48px status bar** pinned at the bottom:

```
┌──────────────────────────────────────────────────────────┐
│  ⏳ 中书令 is speaking...   (3 of 9 agents this round)   │
│     中书令正在发言...        (本轮第 3/9 位)               │
└──────────────────────────────────────────────────────────┘
```

**Why this matters**: If the turn panel appears from nothing, the layout jump is jarring. A persistent status bar at the bottom:
1. Gives the human spatial expectation of where the input will appear
2. Shows progress through the round (how many agents until my turn)
3. Creates a gentle "countdown to your turn" that builds anticipation

**Approaching-turn preview**: When the human is next (1 agent away), the status bar highlights:
```
┌──────────────────────────────────────────────────────────┐
│  ⚡ You're up next — after 户部尚书 finishes              │
│     马上轮到你 — 在户部尚书之后                             │
└──────────────────────────────────────────────────────────┘
```
This uses the accent color border (left 3px) as a "heads up" signal. Gives the human ~5 seconds to mentally prepare.

### 5.1. Free-Text Speech

Used in: day discuss, wolf discuss (werewolf), open-chat turns, roundtable turns, last words.

```
┌──────────────────────────────────────────────────────────┐
│  💬 Your turn to speak                                    │
│     轮到你发言了                                           │
│                                                           │
│  Playing as 吏部尚书 · cautious, values process            │
│  扮演 吏部尚书 · 谨慎，重视程序                              │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │                                                    │   │
│  │  (textarea, 3 rows, auto-expand to 6)              │   │
│  │  Placeholder: "Share your thoughts..."             │   │
│  │               "分享你的想法..."                      │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                          [Send ↵]         │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  60s remaining          │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- `Enter` sends. `Shift+Enter` inserts newline. (Tooltip on first visit.)
- Empty sends are blocked (button disabled when textarea is empty).
- Timer bar (multi-human only): fills left-to-right as a progress bar, color transitions green → amber → red.
- Single-human: no timer bar shown. Take your time.
- **Persona coaching line (V2 addition)**: A one-line reminder of the human's character, extracted from the agent's persona field (first sentence or a manually-authored `shortBio` if available). Shown in muted text above the textarea. Helps the human stay in character without re-reading the full persona. Dismissable (click to hide for the rest of the session).

**Contextual placeholders by phase:**

| Context | en | zh |
|---------|----|----|
| Day discussion | "Defend yourself or accuse..." | "为自己辩护或指控他人..." |
| Wolf discussion | "Discuss who to eliminate..." | "讨论今晚要淘汰谁..." |
| Last words | "Any final words?" | "还有什么想说的吗？" |
| Open-chat | "Share your thoughts..." | "分享你的想法..." |
| Roundtable | "Your perspective on this round..." | "你对本轮的看法..." |

### 5.2. Target Vote

Used in: wolf vote, day vote, sheriff election.

```
┌──────────────────────────────────────────────────────────┐
│  🗳️ Cast your vote                                       │
│     投出你的一票                                           │
│                                                           │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐         │
│  │[Avatar]│  │[Avatar]│  │[Avatar]│  │[Avatar]│         │
│  │ 中书令  │  │ 门下侍中│  │ 尚书令  │  │ 户部尚书│         │
│  │  ○     │  │  ○     │  │  ◉     │  │  ○     │         │
│  └────────┘  └────────┘  └────────┘  └────────┘         │
│                                                           │
│  ┌────────┐                                               │
│  │ ⊘ Skip │  (day vote only — abstain)                    │
│  └────────┘                                               │
│                                                           │
│  Selected: 尚书令                                          │
│  Reason (optional): [________________]                    │
│                                                           │
│                                [Confirm Vote →]           │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░  45s remaining               │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- Agent cards displayed in a flex-wrap grid. Each shows avatar + name + radio.
- Dead agents are NOT shown (filtered out).
- Self is NOT shown in day vote (can't vote for yourself). Self IS shown in wolf vote (wolves vote for non-wolf targets).
- "Skip" option only in day vote (abstain) and sheriff election (don't run).
- Reason field is optional (matches AI schema `{ target, reason }`).
- Two-step: select → confirm. Prevents accidental taps.
- Selected card gets a highlight border (accent color).

**Large roster handling (V2 addition):**
In 12-player werewolf, up to 11 vote targets may be shown. The grid must handle this:
- **Desktop (>640px)**: 4-column grid. 11 targets = 3 rows. Fits without scroll.
- **Mobile (≤640px)**: 2-column compact layout. Avatar shrinks to 32px. Name truncates with ellipsis. 11 targets = 6 rows. If panel exceeds 50vh, it becomes scrollable with a max-height.
- The panel never covers more than 60% of the viewport. If it would, it becomes a scrollable sheet.

**Vote-specific copy:**

| Context | Title (en) | Title (zh) |
|---------|-----------|-----------|
| Wolf vote | "Choose a target" | "选择今晚的目标" |
| Day vote | "Vote to eliminate" | "投票淘汰" |

**Note (V2 clarification)**: Sheriff election is NOT handled by `VotePanel`. Sheriff election has different semantics (opt-in self-nomination + voting for candidates, not a simple target pick), so it uses the dedicated `SheriffPanel` component (§5.7). `VotePanel` only handles wolf vote and day vote — both are pure "pick one target" interactions.

### 5.3. Witch Action Panel

Used in: witch_action phase (werewolf, witch role only).

```
┌──────────────────────────────────────────────────────────┐
│  🧪 Witch's Turn                                         │
│     女巫的回合                                             │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Tonight the wolves killed:                        │   │
│  │  今晚狼人杀害了:                                    │   │
│  │                                                    │   │
│  │        [Avatar]  门下侍中                           │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐           │
│  │ 💊 Save  │  │ ☠️ Poison... │  │ 🚫 Pass  │           │
│  │ 救人      │  │ 毒杀...      │  │ 跳过      │           │
│  └──────────┘  └──────────────┘  └──────────┘           │
│                                                           │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  60s remaining          │
└──────────────────────────────────────────────────────────┘
```

**States:**
- Save potion available → Save button active (green)
- Save already used → Save button disabled + strikethrough + "(Used)" label
- Poison available → Poison button active (purple). Clicking opens a target picker overlay (same grid as §5.2, all alive agents except the killed one).
- Both used → Only Pass button available. Copy changes to: "No potions remaining" / "药水已用完"
- Can't save AND poison same night → selecting Save disables Poison, and vice versa.
- After action: confirmation text + auto-dismiss (1s delay).

**Guard-protected night (V2 addition)**: If the guard successfully protected the wolf's target, no one was killed. The witch panel changes to:

```
┌───────────────────────────────────────────────────┐
│  No one was killed tonight.                        │
│  今晚无人死亡。                                     │
│                                                    │
│  ┌──────────────┐  ┌──────────┐                   │
│  │ ☠️ Poison... │  │ 🚫 Pass  │                   │
│  │ 毒杀...      │  │ 跳过      │                   │
│  └──────────────┘  └──────────┘                   │
└───────────────────────────────────────────────────┘
```

Save button is hidden (no one to save). Only Poison or Pass available.

### 5.4. Seer Check

Used in: seer_check phase (werewolf, seer role only).

```
┌──────────────────────────────────────────────────────────┐
│  🔮 Seer's Turn — Check one player                       │
│     预言家的回合 — 查验一位玩家                              │
│                                                           │
│  [Agent grid — same layout as §5.2, all alive non-self]   │
│                                                           │
│                                [Check →]                  │
│  ░░░░░░░░░░░░░░░░░░░░░░░  30s remaining                  │
└──────────────────────────────────────────────────────────┘
```

After selection + confirm:

```
┌──────────────────────────────────────────────────────────┐
│  🔮 Result                                                │
│                                                           │
│  [Avatar]  尚书令                                         │
│                                                           │
│     ✅ Good (好人)                                        │
│     — or —                                                │
│     ❌ Evil (坏人)                                        │
│                                                           │
│  This result is added to your HUD.                        │
│  此结果已记录在你的状态栏中。                                │
│                                                           │
│                                [Continue →]               │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- Result card shown for 3 seconds or until "Continue" clicked.
- Result persisted in Player HUD's "Known intel" section for remainder of game.

### 5.5. Guard Protect

Used in: guard_protect phase (werewolf, guard role only).

```
┌──────────────────────────────────────────────────────────┐
│  🛡️ Guard's Turn — Protect one player tonight            │
│     守卫的回合 — 选择今晚守护的对象                          │
│                                                           │
│  [Agent grid — all alive, including self]                  │
│                                                           │
│  ⚠️ You protected 中书令 last night.                      │
│     Cannot protect the same target twice in a row.        │
│     你昨晚守护了中书令，不能连续两晚守护同一人。               │
│                                                           │
│  [中书令 card is grayed out / disabled]                    │
│                                                           │
│                                [Protect →]                │
│  ░░░░░░░░░░░░░░░░░░░░░░░  30s remaining                  │
└──────────────────────────────────────────────────────────┘
```

### 5.6. Hunter Shoot

Triggered when hunter is eliminated (by wolves, vote, or poison).

```
┌──────────────────────────────────────────────────────────┐
│  🏹 You've been eliminated! As the Hunter, you may       │
│     take someone with you.                                │
│     你被淘汰了！作为猎人，你可以带走一个人。                   │
│                                                           │
│  [Agent grid — all alive agents]                          │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │ 🏹 Shoot     │  │ 🚫 Don't     │                      │
│  │ 开枪          │  │ 不开枪        │                      │
│  └──────────────┘  └──────────────┘                      │
│                                                           │
│  ░░░░░░░░░░░░░░░░░  15s remaining                        │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- Appears immediately after elimination announcement.
- "Shoot" requires selecting a target first.
- "Don't shoot" submits immediately.
- Short timer (15s) — this is a reactive decision, not a deliberation.

### 5.7. Sheriff Election & Transfer

**Election** (day phase, if sheriff rule enabled):

```
┌──────────────────────────────────────────────────────────┐
│  🎖️ Sheriff Election — Vote for a candidate              │
│     警长竞选 — 投票选举                                     │
│                                                           │
│  [Agent grid — all alive agents]                          │
│                                                           │
│  ┌──────────────┐                                        │
│  │ ⊘ Don't run  │  (opt out of election)                 │
│  └──────────────┘                                        │
│                                                           │
│                                [Vote →]                   │
│  ░░░░░░░░░░░░░░░░░░░░░░░  30s remaining                  │
└──────────────────────────────────────────────────────────┘
```

**Transfer** (when sheriff is eliminated):

```
┌──────────────────────────────────────────────────────────┐
│  🎖️ Transfer your Sheriff badge                          │
│     转交你的警长徽章                                       │
│                                                           │
│  [Agent grid — all alive agents]                          │
│                                                           │
│  ┌──────────────────┐                                    │
│  │ 💥 Destroy badge │                                    │
│  │ 销毁警徽          │                                    │
│  └──────────────────┘                                    │
│                                                           │
│                                [Transfer →]               │
│  ░░░░░░░░░░░░░░░░░░░░░░░  15s remaining                  │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Timer & Timeout UX

### Timer bar

A thin progress bar at the bottom of the turn panel.

```
Phase 1 (0-50%):    ████████░░░░░░░░░░░░  green (#22c493)
Phase 2 (50-80%):   ████████████████░░░░  amber (#f5a623)
Phase 3 (80-100%):  ████████████████████  red   (#e74c3c)
```

- Width: 100% of turn panel
- Height: 4px (desktop), 6px (mobile)
- Animation: smooth linear fill (CSS `transition: width 1s linear`)
- At 80%: a brief pulse animation on the bar (draws attention)
- At 90%: the remaining time text turns red and blinks gently

### Default timeouts per turn type

| Turn type | Default (s) | Configurable range |
|-----------|-------------|-------------------|
| Free-text (day/wolf/open/debate) | 120 | 60-300 |
| Day vote | 60 | 30-120 |
| Wolf vote | 45 | 30-90 |
| Witch action | 60 | 30-120 |
| Seer check | 30 | 15-60 |
| Guard protect | 30 | 15-60 |
| Hunter shoot | 15 | 10-30 |
| Sheriff election | 30 | 15-60 |
| Sheriff transfer | 15 | 10-30 |
| Last words | 60 | 30-120 |

### Single-human rooms (4.5c)
No per-turn timer shown by default. The human can take as long as they want per turn.

**Inactivity timeout (V2 addition)**: To prevent abandoned rooms from being stuck forever, single-human rooms have a **10-minute inactivity timeout**. If no human input is received for 10 minutes:

```
┌──────────────────────────────────────────────────────────┐
│  ⏰ Still there?                                         │
│     你还在吗？                                            │
│                                                           │
│  No activity for 10 minutes. The room will auto-pause    │
│  in 2 minutes.                                           │
│  已有 10 分钟无操作。房间将在 2 分钟后自动暂停。              │
│                                                           │
│  [I'm here — continue]        [Pause room]               │
│  [我在 — 继续]                 [暂停房间]                   │
└──────────────────────────────────────────────────────────┘
```

- "I'm here" resets the inactivity timer
- "Pause room" sets `status='paused'`; the room can be resumed later from `/room/[id]`
- If neither clicked within 2 minutes: auto-pause

Optional: room creator can enable per-turn timers in config. Useful for self-discipline.

### Multi-human rooms (4.5d)
Per-turn timers always shown. Configurable per-room (host sets in ModeConfigForm).

---

## 7. Fallback on Timeout

**Applies only when per-turn timers are active** — always on in multi-human rooms (4.5d), opt-in via config in single-human rooms (4.5c). If timers are off (single-human default), no fallback fires; the inactivity timeout (§6) handles abandoned rooms instead.

When the timer expires, the system applies a **mode-specific fallback** and shows a brief notification.

| Turn type | Fallback action | Notification (en) | Notification (zh) |
|-----------|----------------|--------------------|--------------------|
| Free-text | AI generates a brief message on behalf of the human | "Time's up — AI spoke for you" | "时间到 — AI代替你发言了" |
| Day vote | Abstain | "Time's up — you abstained" | "时间到 — 你弃权了" |
| Wolf vote | AI picks a target | "Time's up — AI voted for you" | "时间到 — AI代你投票了" |
| Witch action | Pass (no potion used) | "Time's up — passed" | "时间到 — 跳过了" |
| Seer check | AI picks a random target | "Time's up — AI chose for you" | "时间到 — AI代你查验了" |
| Guard protect | AI picks a random target | "Time's up — AI chose for you" | "时间到 — AI代你守护了" |
| Hunter shoot | Don't shoot | "Time's up — you didn't shoot" | "时间到 — 你没有开枪" |
| Sheriff | AI picks / destroy badge | "Time's up — badge destroyed" | "时间到 — 警徽被销毁了" |
| Last words | Skip (no speech) | "Time's up — silence" | "时间到 — 沉默" |

**Fallback notification style:**
- Toast notification in the turn panel area (amber background, 3s auto-dismiss)
- The system message in chat reads: `"[Agent name] 's turn timed out"` / `"[Agent name] 的回合超时了"` — wording is neutral, doesn't reveal human/AI identity to other agents.

---

## 8. Information Visibility Matrix

What the human player sees depends on their role. This matrix governs which chat channels and events are visible.

### Werewolf

| Channel / Event | Villager | Werewolf | Seer | Witch | Guard | Hunter | Idiot |
|----------------|----------|----------|------|-------|-------|--------|-------|
| `main` (day discussion) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `werewolf` (wolf chat) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `wolf-vote` (wolf target) | ❌ | ❌¹ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `witch-action` (save/poison) | ❌ | ❌ | ❌ | ✅² | ❌ | ❌ | ❌ |
| `seer-result` (check results) | ❌ | ❌ | ✅² | ❌ | ❌ | ❌ | ❌ |
| `guard-action` (protect target) | ❌ | ❌ | ❌ | ❌ | ✅² | ❌ | ❌ |
| `day-vote` results | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Elimination announcement | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Night kill target (before witch) | ❌ | ❌ | ❌ | ✅³ | ❌ | ❌ | ❌ |
| Other wolves' identity | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ Wolves see the vote RESULT (who was targeted), not individual votes.
² Only their own actions and results — not other special roles'.
³ Witch sees who was killed as part of the action panel (to decide save).

### Open-chat / Roundtable
All messages on `main` channel visible to everyone. No hidden channels. The only gating is turn order (you can't speak out of turn).

### Chat filtering
The server-side message endpoint (`/api/rooms/:id/messages`) must filter events by the viewer's seat token:
1. Read seat token from `Authorization: Bearer <jwt>` header
2. Resolve `seatId` → `agentId` → `role` → `subscribedChannels`
3. Return only events on subscribed channels

No seat token → spectator view (public channels only: `main`, `day-vote` results, eliminations, phase transitions).

---

## 9. Dead Player / Spectator UX

### On elimination

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│           ☠️  You have been eliminated.                    │
│              你已被淘汰。                                  │
│                                                           │
│           Your role: 🐺 Werewolf                          │
│           你的身份: 🐺 狼人                                │
│                                                           │
│           [Continue watching]  [Leave room]                │
│           [继续观战]           [离开房间]                    │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**After dismissing:**
- HUD updates: role badge gets a `☠️ Eliminated` label, desaturated colors
- Input panels never appear again
- Chat remains visible — day discussions, votes, eliminations
- Night phases show "Night falls..." placeholder (same as spectator)
- Optional: toggle to "God mode" spectator view (see all channels) — configurable per room at creation time

### Spectator (no seat token)
- Same as today's view: all public events, no input
- No knowledge of which seat is human (unless host enables "show human" labels)

**Spectator experience during human turns (V2 addition)**:
When a human is thinking, spectators currently see nothing — the room appears frozen. This is bad for demos and showcases.

Spectator view during a human turn:
```
┌──────────────────────────────────────────────────────────┐
│  ··· last AI message ···                                  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │  ⏳ [Agent name] is thinking...    12s elapsed      │   │
│  │     [Agent name] 正在思考...                         │   │
│  │     ● ● ●  (animated dots)                          │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  ··· next AI message appears here when turn completes ··· │
└──────────────────────────────────────────────────────────┘
```

- Shows agent name (not "a human is thinking" — preserves anonymity)
- Animated dots (typing indicator style) — purely client-side animation, no server data needed
- **Elapsed time counter**: In 4.5c, the room snapshot's `waiting_for` field includes a `waitingSince` timestamp. The existing `useRoomPoll` hook (polls `/api/rooms/:id/state` every 3s) delivers this timestamp; the client computes elapsed time locally via `Date.now() - waitingSince`. No Supabase Realtime required.
- **(4.5d only)** If typing indicator data is available via Supabase Realtime presence: show `"[name] is typing..."` instead of `"thinking..."`

---

## 10. Disconnection & Reconnection

### State recovery
On page refresh or reconnect:
1. Check `localStorage` for `agora-seat-{roomId}`
2. If valid seat token exists → reconstruct player view from DB events
3. All past channel messages (per visibility matrix) are replayed
4. HUD rebuilt from game state snapshot
5. If it's currently their turn → input panel appears (with remaining timer if timers are enabled; without timer if single-human default)

### During disconnection — 4.5c single-human (V2 addition)

Single-human rooms have no other players waiting, so disconnection is low-stakes:
- The room stays in `status='waiting'` with `waiting_for` set to the human's seat
- No grace period needed — the room simply waits indefinitely (subject to the 10-min inactivity timeout from §6)
- On page refresh: state recovery per steps 1-5 above. The turn panel reappears with the same context.
- The inactivity timeout resets on reconnect (the refresh itself counts as activity).

### During disconnection — 4.5d multi-human

```
┌──────────────────────────────────────────────────────────┐
│  ⚠️ Connection lost                                      │
│     连接已断开                                             │
│                                                           │
│  Reconnecting...   ●●●                                   │
│  正在重连...                                               │
│                                                           │
│  Your turn will be held for 30 seconds.                   │
│  你的回合将保留 30 秒。                                     │
└──────────────────────────────────────────────────────────┘
```

**Grace period (V2 revised)**: 30 seconds. The turn timer **keeps running** during disconnection (not paused — pausing would create a "disconnect to buy time" exploit). The grace period simply delays the fallback by 30s beyond the turn timer:

- If turn has 45s remaining when disconnect happens → player has 45s of turn time + 30s grace = 75s to reconnect and finish
- If turn timer expires during disconnect → 30s grace before fallback fires
- Other players see: `"[Agent] reconnecting..."` / `"[Agent] 正在重连..."`

If player reconnects:
- Input panel reappears with remaining turn time
- All messages during disconnect are caught up (from DB events)

If grace expires:
- Timeout fallback applies (§7)
- Player reconnects to a "you timed out" state with results shown

---

## 11. Mode-Specific Notes

### Werewolf
- **Night transition**: Full-screen overlay fades in — `"Night falls..."` / `"夜幕降临..."`. Human's HUD remains visible through the overlay (40% opacity background). Night-specific panels (wolf discuss, witch, seer, guard) appear within the night overlay context.
- **Wolf discussion**: Only if human is a wolf. Shows wolf-chat channel with other wolves' names revealed. Free-text input per §5.1.
- **Simultaneous night actions**: In AI-only, seer/witch/guard act in sequence. With a human in one of those roles, the sequence is the same — but the human's turn pauses the sequence while others are instant.
- **Idiot reveal**: If human is the Idiot and gets voted out, show: `"You've been revealed as the Idiot! You survive but can no longer vote."` / `"你的白痴身份被揭示！你存活但不能再投票。"` The vote panel no longer appears for them.

### Open-chat
- **Simplest mode**: Just a free-text turn panel that appears on your turn in round-robin order.
- **Leader behavior**: If the human is the leader agent, the leader directive (from team-room.ts `leaderDirectiveFor`) should be shown in the HUD as a subtle reminder: `"As leader, guide the discussion."` / `"作为领导者，引导讨论。"`

### Pacing: the long-wait problem (V3 addition)

**The issue**: In a 9-agent room with 1 human, the human waits for 8 AI turns (~24s at 3s each) between their own turns. In a 5-round game, that's ~2 minutes of watching per round vs ~30s of acting. The spectating:acting ratio is 4:1 — too high.

**Principle**: In single-human rooms, minimize dead time for the human. The AIs are not real people; there's no fairness reason to give them "natural" pacing.

**Suggested mitigations** (implementation-level, not UX spec):
1. **Compressed AI pacing**: In single-human rooms, reduce inter-AI message delay from ~3s to ~1s. AI responses still render one at a time (preserving readability), but the gap between them is shorter.
2. **"Fast-forward to my turn" button**: Optional button in the between-turns status bar. Clicking it fires all remaining AI turns in rapid succession (~0.3s intervals) and jumps to the human's turn. Useful for impatient players.
3. **Read-time awareness**: If the last AI message was long (>200 chars), add 1s extra before the next AI speaks. If short (<50 chars), reduce to 0.5s. Match pacing to reading speed.

These are implementation suggestions, not hard requirements. The spec doesn't mandate pacing — it mandates that the problem be acknowledged and addressed.

### Roundtable
- **Round structure visible**: HUD shows `"Round 2 of 5"`. Turn panel shows: `"Your perspective this round"` / `"你在本轮的观点"`.
- **After final round**: If the mode includes a summary/vote, show a special summary panel.

---

## 12. Component Inventory (for 4.5c implementation)

New components to build:

| Component | Location | Purpose |
|-----------|----------|---------|
| `PlayerHUD` | `app/room/[id]/components/v2/` | Always-visible role + status bar |
| `TurnPanel` | `app/room/[id]/components/v2/` | Container: slide-in/out, timer, dispatch to sub-panels |
| `TextInputPanel` | `app/room/[id]/components/v2/` | Free-text speech (§5.1) |
| `VotePanel` | `app/room/[id]/components/v2/` | Agent grid vote (§5.2) |
| `WitchPanel` | `app/room/[id]/components/v2/` | Save/poison/pass (§5.3) |
| `SeerPanel` | `app/room/[id]/components/v2/` | Check + reveal (§5.4) |
| `GuardPanel` | `app/room/[id]/components/v2/` | Protect picker (§5.5) |
| `HunterPanel` | `app/room/[id]/components/v2/` | Shoot decision (§5.6) |
| `SheriffPanel` | `app/room/[id]/components/v2/` | Election + transfer (§5.7) |
| `TimerBar` | `app/room/[id]/components/v2/` | Animated countdown bar (§6) |
| `TimeoutToast` | `app/room/[id]/components/v2/` | Fallback notification (§7) |
| `EliminatedOverlay` | `app/room/[id]/components/v2/` | Death screen (§9) |
| `SeatAssignment` | `app/rooms/new/` | Full multi-seat page (4.5d only). MVP: inline dropdown in ModeConfigForm (§2) |
| `WaitingRoom` | `app/room/[id]/components/v2/` | Pre-game invite + readiness (§3, 4.5d) |
| `DisconnectOverlay` | `app/room/[id]/components/v2/` | Reconnection UX (§10, 4.5d) |
| `ViewerContext` | `app/lib/` | Provider: seat token → role → visible channels |

Modified components:

| Component | Change |
|-----------|--------|
| `ChatSidebar` / `ChatView` | Filter messages by ViewerContext channels |
| `WerewolfView` | Integrate PlayerHUD + TurnPanel |
| `RoundtableView` | Integrate PlayerHUD + TurnPanel |
| `ModeConfigForm` | Add inline "Play as" dropdown (MVP); full SeatAssignment page (4.5d) |
| Room API routes | Accept human-input POST, handle waiting state |

---

## 13. API Surface (UX-Level)

Not full API specs — just the contracts the UI needs.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rooms/:id/human-input` | POST | Submit human turn (body: `{ seatToken, turnId, payload }`) |
| `/api/rooms/:id/messages` | GET | Filtered by seat token (viewer's channels only) |
| `/api/rooms/:id/state` | GET | Room snapshot + human-relevant state (is it my turn? timer remaining?) |
| `/api/rooms/:id/join` | POST | Claim a seat (4.5d: validates invite token, marks seat as occupied) |

### Payload shapes per turn type (V3 addition)

The `payload` field in `POST /api/rooms/:id/human-input` must match the AI agent's structured output schema for the same turn type. This ensures the runtime can process human and AI turns identically.

| turnId | Payload shape | Notes |
|--------|--------------|-------|
| `speak` | `{ content: string }` | Free-text for day/wolf/open/roundtable/last words |
| `wolf-vote` | `{ target: string, reason?: string }` | `target` is agentId |
| `day-vote` | `{ target: string \| 'skip', reason?: string }` | `'skip'` = abstain |
| `witch-action` | `{ action: 'save' \| 'poison' \| 'pass', poisonTarget?: string }` | `poisonTarget` required when action='poison' |
| `seer-check` | `{ target: string }` | agentId |
| `guard-protect` | `{ target: string }` | agentId |
| `hunter-shoot` | `{ shoot: boolean, target?: string }` | `target` required when shoot=true |
| `sheriff-election` | `{ target: string \| 'skip' }` | `'skip'` = don't run |
| `sheriff-transfer` | `{ target: string \| 'destroy' }` | `'destroy'` = destroy badge |

---

## 14. Microcopy Reference

### System messages (appear in chat stream)

| Event | en | zh |
|-------|----|----|
| Human's turn starts | "It's your turn" | "轮到你了" |
| Human is thinking (for others) | "Waiting for [name]..." | "等待[name]..." |
| Timeout fired | "[name]'s turn timed out" | "[name]的回合超时了" |
| Human joined room | "[name] has joined" | "[name]已加入" |
| Human disconnected | "[name] disconnected" | "[name]已断开连接" |
| Human reconnected | "[name] reconnected" | "[name]已重连" |
| Game waiting for humans | "Waiting for players to join..." | "等待玩家加入..." |

### Turn panel headers

| Turn type | en | zh |
|-----------|----|----|
| Free-text (day) | "Your turn to speak" | "轮到你发言" |
| Free-text (wolf) | "Wolf discussion" | "狼人密谋" |
| Free-text (last words) | "Your last words" | "你的遗言" |
| Vote (day) | "Vote to eliminate" | "投票淘汰" |
| Vote (wolf) | "Choose tonight's target" | "选择今晚的目标" |
| Witch | "Witch's turn" | "女巫的回合" |
| Seer | "Check one player" | "查验一位玩家" |
| Guard | "Protect one player tonight" | "选择今晚守护的对象" |
| Hunter | "Take someone with you?" | "要带走一个人吗？" |
| Sheriff election | "Vote for sheriff" | "投票选举警长" |
| Sheriff transfer | "Transfer your badge" | "转交你的警徽" |

### Timeout fallback messages

(See §7 table)

---

## 15. Open Questions

These are decisions deferred to implementation time (4.5c):

1. **Sound design**: What does the "your turn" chime sound like? Web Audio synthesis or bundled audio file? Should different turn types have different sounds?
2. **Turing test mode**: Default off. When enabled, human seats show the same AI badges as AI seats. Deferred to a later phase.
3. **Suggest button**: PRD mentions "request AI-generated response suggestion." Design deferred — not in 4.5c scope.
4. **God mode for dead players**: Should eliminated humans see all channels? Or only their role's channels? Configurable per room?
5. **Mobile keyboard**: On mobile, the system keyboard pushes the viewport up. Does the turn panel need special handling to avoid double-push (panel + keyboard)? Test during 4.5c implementation.

~~6. **Persona coaching**~~ — **RESOLVED in V2**: Yes. One-line persona reminder above the textarea, muted text, dismissable. See §5.1.

---

## Appendix: Self-Critique Log

V1 → V2 changes made after /mtc self-critique:

| # | Issue | Fix |
|---|-------|-----|
| 1 | No "between turns" waiting state — panel appeared from nothing, layout jump was jarring | Added §5.0: persistent 48px status bar with round progress + "you're up next" preview |
| 2 | Single-human rooms had no inactivity safeguard — abandoned room stuck forever | Added 10-minute inactivity timeout with "still there?" prompt + auto-pause in §6 |
| 3 | Template seat assignment had no default — user had to guess which seat to play | Added `suggestedHumanSeat` field per template + "don't suggest the leader" rule in §2 |
| 4 | Spectators saw a frozen room during human turns — bad for demos | Added spectator waiting state with elapsed timer + typing indicator in §9 |
| 5 | Vote panel overflowed on mobile for 12-player games (11 targets) | Added responsive 2-col compact layout + 60vh max-height scroll in §5.2 |
| 6 | Disconnection timer paused = exploit (disconnect to buy time) | Changed to timer-keeps-running + 30s grace extension in §10 |
| 7 | Human didn't know who they were playing as during turns | Added persona coaching one-liner above textarea in §5.1 |

**V2 audit pass** (internal consistency review by subagent):

| # | Issue | Fix |
|---|-------|-----|
| 8 | §7 fallback table read as always-on, contradicting "no timer" for single-human | Added scoping note: fallbacks only fire when per-turn timers are active |
| 9 | Spectator elapsed counter required Supabase Realtime (scope leak to 4.5d) | Specified polling via `useRoomPoll` + `waitingSince` timestamp — no Realtime needed for 4.5c |
| 10 | No 4.5c disconnection path — §10 only covered 4.5d multi-human | Added single-human disconnect section: room waits indefinitely, inactivity timeout applies |
| 11 | Witch panel assumed a kill always happened — guard protection case unhandled | Added "no one was killed tonight" variant panel with Save hidden |
| 12 | Sheriff election stuffed into VotePanel despite different semantics | Clarified SheriffPanel is separate component; VotePanel only handles wolf/day votes |

**V3 /mtc user-journey critique** (walked through as a first-time Chinese casual gamer):

| # | Issue | Fix |
|---|-------|-----|
| 13 | Seat Assignment was a full separate page — overkill for picking ONE seat in MVP | Inlined as dropdown in ModeConfigForm (§2). Full page deferred to 4.5d. |
| 14 | No first-turn onboarding — human stared at AI chatter for ~20s with no context | Added §5.0a: one-time welcome message with position indicator |
| 15 | Human message rendering in chat was unspecified — breaks game fairness if distinguishable | Added rendering rule: identical to AI messages + simulated typing delay |
| 16 | API payload shapes per turn type were too vague for implementation | Added full payload table in §13 matching AI structured output schemas |
| 17 | 8+ AI turns × 3s = 24s+ waiting per round never acknowledged | Added pacing section in §11 with compressed pacing + fast-forward suggestions |

---

*End of V3 spec (V1 → V2 technical audit → V3 /mtc user-journey critique).*
