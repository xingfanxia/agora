// ============================================================
// Agora DB — Public API
// ============================================================

export { getDb, getDirectDb } from './client.js'
export type { Database } from './client.js'

export * as schema from './schema.js'
export { rooms, events, agents, teams, teamMembers, allowedEmails, seatPresence } from './schema.js'
export type {
  RoomRow,
  NewRoomRow,
  EventRow,
  NewEventRow,
  AgentRow,
  NewAgentRow,
  TeamRow,
  NewTeamRow,
  TeamMemberRow,
  NewTeamMemberRow,
  AllowedEmailRow,
  NewAllowedEmailRow,
  SeatPresenceRow,
  NewSeatPresenceRow,
} from './schema.js'
