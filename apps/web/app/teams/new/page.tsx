// ============================================================
// /teams/new — team composer (empty initial)
// ============================================================

'use client'

import { TeamComposer, EMPTY_TEAM_INITIAL } from '../../components/TeamComposer'

export default function NewTeamPage() {
  return <TeamComposer initial={{ ...EMPTY_TEAM_INITIAL }} onCancelHref="/teams" />
}
