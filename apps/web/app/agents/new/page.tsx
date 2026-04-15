// ============================================================
// /agents/new — 4-step wizard shell
// ============================================================

'use client'

import { AgentWizard, EMPTY_INITIAL } from '../../components/AgentWizard'

export default function NewAgentPage() {
  return <AgentWizard initial={{ ...EMPTY_INITIAL }} onCancelHref="/agents" />
}
