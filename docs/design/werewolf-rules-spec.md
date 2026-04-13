# Agora Werewolf (狼人杀) — Rules Specification

> Based on Chinese 狼人杀 standard competitive rules (口袋狼人杀, GameRes, 网易狼人杀).
> Cross-referenced with AgentScope werewolf demo implementation.

---

## Roles

### Core Roles (Phase 2a — current implementation)

| Role | Camp | Night Action | Count |
|------|------|-------------|-------|
| **狼人 Werewolf** | Wolf | Discuss + vote to kill one villager | 2-4 |
| **预言家 Seer** | Village | Investigate one player (learn if wolf or not) | 1 |
| **女巫 Witch** | Village | Save potion (revive wolf kill) + Poison potion (kill anyone) | 1 |
| **猎人 Hunter** | Village | On death: may shoot one alive player | 1 |
| **平民 Villager** | Village | No special ability | 2-4 |

### Future Roles (Phase 2b)

| Role | Camp | Mechanic |
|------|------|----------|
| **守卫 Guard** | Village | Protect one player per night (immune to wolf kill). Cannot protect same player 2 nights in a row. Guard+Witch save = target dies (同守同救). |
| **白痴 Idiot** | Village | If voted out during day: reveals role, stays alive, loses voting rights permanently. Night kills bypass this ability. |
| **警长 Sheriff** | Village* | Elected Day 1. Vote counts 1.5x. Controls speaking order. On death: transfers badge to any player. |
| **狼王 Alpha Wolf** | Wolf | On death (day vote only): may take one player with them. |

---

## Standard Compositions

| Players | Wolves | Seer | Witch | Hunter | Villagers | Config Name |
|---------|--------|------|-------|--------|-----------|-------------|
| **6** | 2 | 1 | 1 | — | 2 | 入门局 |
| **8** | 3 | 1 | 1 | — | 3 | 基础局 |
| **9** | 3 | 1 | 1 | 1 | 3 | 预女猎 (standard beginner) |
| **10** | 4 | 1 | 1 | 1 | 3 | 标准10人局 |
| **12** | 4 | 1 | 1 | 1 | 4 + 1 (Idiot or Guard) | 预女猎白/守 (competitive) |

---

## Night Phase Order

Standard Chinese 狼人杀 night action order:

1. **守卫 Guard** (if in game) — choose who to protect
2. **狼人 Werewolves** — discuss privately, then vote on kill target
3. **女巫 Witch** — told who was killed, decide save/poison
4. **预言家 Seer** — investigate one player
5. **猎人 Hunter** — if killed by wolves tonight, may shoot (resolved at dawn)

All night deaths are applied **simultaneously** at dawn.

### Our Implementation Order (simplified, no Guard)

1. **wolfDiscuss** — wolves discuss strategy in private channel
2. **wolfVote** — wolves cast blind votes for kill target
3. **witchAction** — witch is told who was killed, decides potions
4. **seerCheck** — seer investigates one player
5. **dawn** — apply all deaths, announce results
6. **hunterShoot** — if hunter died this night, may shoot (Phase 2a)

---

## Role-Specific Rules

### Werewolves (狼人)

- Wolves discuss privately (private channel, not visible to village)
- Wolves vote simultaneously (blind — cannot see each other's votes)
- **If wolves disagree** (no majority): **空刀 (empty kill)** — no one dies
- Wolves do NOT reveal their vote reasoning publicly

### Seer (预言家)

- Investigates ONE alive player per night
- **Cannot investigate themselves**
- Cannot investigate dead players (enforced by alive-player list)
- Receives binary result: wolf (狼人) or not-wolf (好人)
- Result is private (seer-only channel)

### Witch (女巫)

- Two single-use potions for the entire game:
  - **解药 Save Potion**: revive the wolf kill target
  - **毒药 Poison Potion**: kill any alive player
- **Cannot self-save** (if witch is the wolf kill target, save is disabled)
- **Cannot use both potions in the same night** (mutually exclusive per night)
- Is told who the wolves killed BEFORE deciding (unless save already used)
- **After save potion is used**: moderator no longer reveals who was killed in future nights (witch must decide blind)
- Witch poison bypasses Guard protection and Hunter's gun ability

### Hunter (猎人)

- **CAN shoot** when:
  - Killed by wolves at night (shoots at dawn announcement)
  - Voted out during day vote
- **CANNOT shoot** when:
  - Killed by Witch poison (poison seals the gun)
- May choose **not to shoot** (voluntary)
- Can target **any alive player**
- Shoot resolves immediately (may trigger chain deaths)

### Villager (平民)

- No special ability
- Participates in day discussion and voting

---

## Day Phase Flow

### Discussion (发言)

- **Sequential** speaking order
- Without sheriff: randomized starting player, rotate clockwise
- Each alive player speaks once
- Discussion is public (all alive players see all messages)

### Voting (投票)

- **Simultaneous / blind** — all players cast votes without seeing others' votes
- Each player votes for one alive player to eliminate, or abstains ("skip")
- **Cannot vote for themselves**
- **Plurality wins** — player with most votes is eliminated
- **Tie handling**:
  - If tie: **平安日 (peaceful day)** — no one is eliminated
  - (Standard rules have PK round — simplified for AI version)
- Eliminated player's role is **revealed** publicly
- Eliminated player gives **no last words** (simplified for AI version)

---

## Win Conditions

### Village Wins
All werewolves are eliminated (at least one villager/god alive).

### Werewolves Win
Wolves **equal or outnumber** non-wolves: `wolves >= non_wolves`
(Equivalent: `wolves * 2 >= alive_players`)

### Check Timing
Win condition is checked:
1. After dawn (night deaths applied)
2. After day vote (and hunter shot if applicable)

Game ends **immediately** when a win condition is met.

### Simultaneous Death Edge Case
If wolves kill a villager AND witch poisons a wolf in the same night:
- Both deaths are applied
- Win condition is then checked
- **狼刀在先**: If wolf kill triggers win condition (wolves >= villagers after wolf kill but before poison resolves), wolves win. For our simplified implementation, we apply all deaths then check — this naturally gives the advantage to the village.

---

## Implementation Notes

### Blind Voting Mechanism
- Vote messages go to a "blind" channel with **no subscribers**
- No agent sees any vote until all are cast
- After all votes, the flow's `onExit` hook tallies and creates an announcement
- Vote results (who voted for whom) are announced publicly

### Channel Topology

```
#main          — all alive players (day discussion, dawn announcements)
#werewolf      — wolves only (night discussion)
#wolf-vote     — no subscribers (blind wolf vote)
#seer-result   — seer only (investigation results)
#witch-action  — witch only (potion decisions)
#day-vote      — no subscribers (blind day vote)
```

### State Reset
All night-scoped state (`lastNightKill`, `seerResult`, `witchPoisonTarget`) is reset in `wolfDiscuss.onEnter` to ensure clean state at the start of each night.
