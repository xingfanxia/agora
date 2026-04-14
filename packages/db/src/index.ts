// ============================================================
// Agora DB — Public API
// ============================================================

export { getDb, getDirectDb } from './client.js'
export type { Database } from './client.js'

export * as schema from './schema.js'
export { rooms, events } from './schema.js'
export type { RoomRow, NewRoomRow, EventRow, NewEventRow } from './schema.js'
