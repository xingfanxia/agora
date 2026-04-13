// ============================================================
// Agora Werewolf Mode — Role System Prompts
// ============================================================

import type { WerewolfRole } from './types.js'

/** Build a system prompt for a werewolf agent based on their role */
export function buildRoleSystemPrompt(
  agentName: string,
  role: WerewolfRole,
  allPlayerNames: string[],
  wolfNames: string[],
): string {
  const baseRules = [
    `You are playing a game of Werewolf. Your name is "${agentName}".`,
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
      '- ANTIDOTE (Save Potion): Revive the player killed by wolves. Cannot save yourself.',
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
      '- If killed by wolves at night: you CAN shoot.',
      '- If voted out during the day: you CAN shoot.',
      '- If killed by witch poison: you CANNOT shoot (poison seals your gun).',
      '- You do NOT have to shoot — you may choose to pass.',
      '',
      'STRATEGY:',
      '- Stay alive as long as possible — your gun is a powerful deterrent.',
      '- If you have seer information, consider shooting a confirmed wolf.',
      '- Be careful not to shoot a villager — that helps the wolves.',
      '- Revealing you are the hunter can protect you (wolves fear the gun).',
    ],
  }

  return [...baseRules, ...rolePrompts[role]].join('\n')
}

/**
 * Default role distribution based on player count.
 * Follows Chinese 狼人杀 standard configurations.
 *
 * 6人: 2W + 1Seer + 1Witch + 2V
 * 8人: 3W + 1Seer + 1Witch + 3V
 * 9人: 3W + 1Seer + 1Witch + 1Hunter + 3V (standard 预女猎)
 * 10人: 4W + 1Seer + 1Witch + 1Hunter + 3V
 * 12人: 4W + 1Seer + 1Witch + 1Hunter + 4V + 1 (Idiot/Guard, future)
 */
export function getDefaultRoleDistribution(playerCount: number): WerewolfRole[] {
  if (playerCount < 6) {
    throw new Error('Werewolf requires at least 6 players')
  }

  const roles: WerewolfRole[] = []

  // Always 1 seer, 1 witch
  roles.push('seer', 'witch')

  // Hunter for 9+ players
  if (playerCount >= 9) {
    roles.push('hunter')
  }

  // Wolves: 2 for 6-7, 3 for 8-9, 4 for 10+
  const wolfCount = playerCount >= 10 ? 4 : playerCount >= 8 ? 3 : 2
  for (let i = 0; i < wolfCount; i++) {
    roles.push('werewolf')
  }

  // Rest are villagers
  while (roles.length < playerCount) {
    roles.push('villager')
  }

  return roles
}
