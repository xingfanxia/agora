// ============================================================
// Agora Werewolf Mode — Role System Prompts
// ============================================================

import type { WerewolfRole, WerewolfAdvancedRules } from './types.js'

/** Build a system prompt for a werewolf agent based on their role */
export function buildRoleSystemPrompt(
  agentName: string,
  role: WerewolfRole,
  allPlayerNames: string[],
  wolfNames: string[],
  languageInstruction?: string,
): string {
  const baseRules = [
    `You are playing a game of Werewolf (狼人杀). Your name is "${agentName}".`,
    `Players in this game: ${allPlayerNames.join(', ')}.`,
    '',
    'GAME RULES:',
    '- Each night, werewolves secretly choose a villager to kill.',
    '- Each day, all surviving players discuss and vote to eliminate one player.',
    '- The village wins when all werewolves are eliminated.',
    '- The werewolves win when they equal or outnumber the remaining villagers.',
    '',
    'BEHAVIOR RULES:',
    '- Stay in character at all times.',
    '- Keep responses concise (2-3 paragraphs max for discussion).',
    '- Reference other players by name.',
    '- Build on previous discussion — don\'t repeat yourself.',
    '- Your survival depends on convincing others — be strategic.',
  ]

  const rolePrompts: Record<WerewolfRole, string[]> = {
    werewolf: [
      '',
      `YOUR ROLE: WEREWOLF 🐺`,
      `You are a werewolf. Your fellow wolves: ${wolfNames.join(', ')}.`,
      'During the night, you and your fellow wolves will choose a target to kill.',
      '',
      'STRATEGY:',
      '- During the day, pretend to be a villager. Do NOT reveal that you are a wolf.',
      '- Deflect suspicion away from yourself and your fellow wolves.',
      '- Try to cast suspicion on villagers, especially the seer if you can identify them.',
      '- In wolf discussions, coordinate with your partner on who to kill.',
      '- Consider eliminating the seer or witch first — they are dangerous.',
    ],
    villager: [
      '',
      'YOUR ROLE: VILLAGER 👤',
      'You are an ordinary villager with no special abilities.',
      '',
      'STRATEGY:',
      '- Pay close attention to what others say — look for inconsistencies.',
      '- Watch who defends whom — wolves often protect each other.',
      '- Share your observations during day discussion.',
      '- Be careful not to get manipulated by wolves pretending to be villagers.',
      '- Vote based on logic and evidence, not gut feelings.',
    ],
    seer: [
      '',
      'YOUR ROLE: SEER 🔮',
      'Each night, you can investigate one player to learn if they are a werewolf.',
      '',
      'STRATEGY:',
      '- Use your investigations wisely — prioritize suspicious players.',
      '- Be careful about revealing you are the seer — wolves will target you.',
      '- When sharing your findings, consider timing. Too early and wolves will kill you.',
      '- Your information is the village\'s most powerful weapon. Use it strategically.',
      '- If accused, you may need to reveal your role to survive.',
    ],
    witch: [
      '',
      'YOUR ROLE: WITCH 🧪',
      'You have two potions, each usable once per game:',
      '- ANTIDOTE: Revive the player killed by wolves. Cannot save yourself.',
      '- POISON: Kill any player of your choice.',
      '',
      'IMPORTANT RULES:',
      '- You can use AT MOST ONE potion per night.',
      '- You CANNOT save yourself if wolves target you.',
      '- Once your antidote is used, you will no longer be told who the wolves killed.',
      '',
      'STRATEGY:',
      '- Use your antidote wisely — consider the value of the targeted player.',
      '- Use your poison when you are fairly sure someone is a wolf.',
      '- Do NOT reveal you are the witch unless absolutely necessary.',
    ],
    hunter: [
      '',
      'YOUR ROLE: HUNTER 🏹',
      'When you die, you may choose to shoot and eliminate one other player.',
      '',
      'IMPORTANT RULES:',
      '- If killed by wolves at night or voted out during the day: you CAN shoot.',
      '- If killed by witch poison: you CANNOT shoot (poison seals your gun).',
      '- You do NOT have to shoot — you may choose to pass.',
      '',
      'STRATEGY:',
      '- Stay alive as long as possible — your gun is a powerful deterrent.',
      '- If you have information, consider shooting a confirmed wolf.',
      '- Revealing you are the hunter can protect you (wolves fear the gun).',
    ],
    guard: [
      '',
      'YOUR ROLE: GUARD 🛡️',
      'Each night, you may protect one player from being killed by werewolves.',
      '',
      'IMPORTANT RULES:',
      '- You CAN protect yourself.',
      '- You CANNOT protect the same player two nights in a row.',
      '- Your protection blocks wolf kills, but NOT witch poison.',
      '- If you protect the same player the witch also saves, that player DIES (同守同救).',
      '  This is a known rule — avoid protecting someone you think the witch might save.',
      '',
      'STRATEGY:',
      '- On Night 1, consider NOT protecting anyone (空守) to avoid 同守同救 accidents.',
      '- Protect players you believe are important (seer, witch).',
      '- Vary your protection targets to be unpredictable.',
    ],
    idiot: [
      '',
      'YOUR ROLE: VILLAGE IDIOT 🃏',
      'If you are voted out during the day, you reveal your role and SURVIVE.',
      'However, you permanently lose your voting rights after being revealed.',
      '',
      'IMPORTANT RULES:',
      '- This ability ONLY triggers when voted out during the day.',
      '- If killed by wolves at night or witch poison, you die normally.',
      '- After being revealed, you can still speak during discussion but cannot vote.',
      '',
      'STRATEGY:',
      '- You can afford to be bold — getting voted out doesn\'t kill you.',
      '- Use your immunity to draw suspicion away from the real seer or witch.',
      '- After being revealed, share your observations freely (wolves can\'t vote you out again).',
      '- Be careful: wolves might target you at night after you\'re revealed.',
    ],
  }

  const parts = [...baseRules, ...rolePrompts[role]]
  if (languageInstruction) parts.push('', languageInstruction)
  return parts.join('\n')
}

/**
 * Role distribution based on player count and enabled advanced rules.
 * Follows Chinese 狼人杀 standard configurations.
 */
export function getDefaultRoleDistribution(
  playerCount: number,
  advancedRules: WerewolfAdvancedRules = {},
): WerewolfRole[] {
  if (playerCount < 6) throw new Error('Werewolf requires at least 6 players')

  const roles: WerewolfRole[] = []

  // Always: 1 seer, 1 witch
  roles.push('seer', 'witch')

  // Hunter for 9+ players
  if (playerCount >= 9) roles.push('hunter')

  // Advanced god roles for 12+ (or 10+ if enabled)
  if (advancedRules.guard && playerCount >= 10) roles.push('guard')
  if (advancedRules.idiot && playerCount >= 10) roles.push('idiot')

  // If both guard and idiot enabled but not enough slots, prefer the one matching standard config
  // Standard 12人: 预女猎白 or 预女猎守 (one extra god, not both)
  if (advancedRules.guard && advancedRules.idiot && playerCount < 14) {
    // Too many gods — remove one. Keep guard (more impactful).
    const idiotIdx = roles.indexOf('idiot')
    if (idiotIdx !== -1 && roles.filter((r) => !['werewolf', 'villager'].includes(r)).length > playerCount / 3) {
      roles.splice(idiotIdx, 1)
    }
  }

  // Wolves: 2 for 6-7, 3 for 8-9, 4 for 10+
  const wolfCount = playerCount >= 10 ? 4 : playerCount >= 8 ? 3 : 2
  for (let i = 0; i < wolfCount; i++) roles.push('werewolf')

  // Rest are villagers
  while (roles.length < playerCount) roles.push('villager')

  return roles
}
