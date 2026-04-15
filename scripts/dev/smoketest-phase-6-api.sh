#!/usr/bin/env bash
# ============================================================
# Phase 6 — CRUD API smoke test
# ============================================================
#
# Runs end-to-end against a running dev server (default :3000).
# Creates an agent, a team, adds the agent, sets leader, then
# cleans up.
#
# Usage:
#   pnpm --filter @agora/web dev   # in one terminal
#   bash scripts/dev/smoketest-phase-6-api.sh
#
# Override base URL:
#   BASE=http://localhost:3001 bash scripts/dev/smoketest-phase-6-api.sh
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
UID_COOKIE="agora-uid=smoketest-$(date +%s)"

say() { printf '\n\033[36m# %s\033[0m\n' "$*"; }
die() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

say "1. Create agent (POST /api/agents)"
AGENT_RES=$(curl -sS -X POST "$BASE/api/agents" \
  -H "Content-Type: application/json" \
  -H "Cookie: $UID_COOKIE" \
  -d '{
    "name": "Smoke Bot",
    "persona": "A minimal test agent.",
    "modelProvider": "anthropic",
    "modelId": "claude-sonnet-4-5",
    "avatarSeed": "smoke-1"
  }')
echo "$AGENT_RES" | head -c 500; echo
AGENT_ID=$(echo "$AGENT_RES" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)
[ -n "$AGENT_ID" ] || die "no agent id in response"
say "  → agent id: $AGENT_ID"

say "2. Get the agent (GET /api/agents/[id])"
curl -sS "$BASE/api/agents/$AGENT_ID" -H "Cookie: $UID_COOKIE" | head -c 500; echo

say "3. List own agents (GET /api/agents?scope=mine)"
curl -sS "$BASE/api/agents?scope=mine" -H "Cookie: $UID_COOKIE" | head -c 500; echo

say "4. Create team (POST /api/teams)"
TEAM_RES=$(curl -sS -X POST "$BASE/api/teams" \
  -H "Content-Type: application/json" \
  -H "Cookie: $UID_COOKIE" \
  -d "{
    \"name\": \"Smoke Team\",
    \"avatarSeed\": \"smoke-team-1\",
    \"defaultModeId\": \"open-chat\",
    \"memberIds\": [\"$AGENT_ID\"],
    \"leaderAgentId\": \"$AGENT_ID\"
  }")
echo "$TEAM_RES" | head -c 500; echo
TEAM_ID=$(echo "$TEAM_RES" | sed -n 's/.*"team":{"id":"\([^"]*\)".*/\1/p' | head -n1)
[ -n "$TEAM_ID" ] || die "no team id in response"
say "  → team id: $TEAM_ID"

say "5. Fetch team + members (GET /api/teams/[id])"
curl -sS "$BASE/api/teams/$TEAM_ID" -H "Cookie: $UID_COOKIE" | head -c 800; echo

say "6. Patch team name (PATCH /api/teams/[id])"
curl -sS -X PATCH "$BASE/api/teams/$TEAM_ID" \
  -H "Content-Type: application/json" \
  -H "Cookie: $UID_COOKIE" \
  -d '{"name": "Smoke Team v2"}' | head -c 400; echo

say "7. Remove member (DELETE /api/teams/[id]/members/[agentId])"
curl -sS -X DELETE "$BASE/api/teams/$TEAM_ID/members/$AGENT_ID" \
  -H "Cookie: $UID_COOKIE" | head -c 200; echo

say "8. Cleanup — delete team"
curl -sS -X DELETE "$BASE/api/teams/$TEAM_ID" -H "Cookie: $UID_COOKIE" | head -c 200; echo

say "9. Cleanup — delete agent"
curl -sS -X DELETE "$BASE/api/agents/$AGENT_ID" -H "Cookie: $UID_COOKIE" | head -c 200; echo

printf '\n\033[32mALL GREEN.\033[0m\n'
