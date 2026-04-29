/**
 * Firestore layout for real-time two-player sessions (Firestore only — no RTDB).
 *
 * Collection paths are exported as constants so app code and security rules stay aligned.
 *
 * ─── Typical lifecycle ─────────────────────────────────────────────────────
 * 1. Host creates `sessions/{sessionId}` with `slots.hostUid`, `status: "open"`.
 * 2. Guest joins (writes `slots.guestUid`, sets `status: "playing"`).
 * 3. Each client listens on `sessions/{sessionId}` and optional subcollections.
 * 4. Game writes ephemeral/action payloads under `actions/*`; TTL job or client deletes stale docs.
 *
 * @typedef {object} SessionDocFields
 * @property {string} sessionId            Mirrors doc id (ease debugging).
 * @property {"open"|"playing"|"ended"} status
 * @property {FirebaseFirestore.Timestamp} createdAt
 * @property {FirebaseFirestore.Timestamp | null} startedAt
 * @property {{ hostUid: string, guestUid: string | null }} slots
 * @property {number} [schemaVersion]     Bump when fields change.
 * @property {FirebaseFirestore.Timestamp | null} [expiresAt]  Soft TTL hint for garbage collection.
 *
 * @typedef {object} ActionEnvelopeFields  sessions/{sessionId}/actions/{actionId}
 * @property {"A"|"B"} fromRole             Logical sender (desktop vs garden).
 * @property {string} verb                  Matches keys used by `doAction` / pacing maps.
 * @property {Record<string, unknown>} [payload]
 * @property {number} seq                   Monotonic per session — receivers discard duplicates/out-of-order.
 * @property {FirebaseFirestore.Timestamp} sentAt
 * @property {boolean} [appliedLocally]     Set after host resolves effects if needed for ACK flows.
 */

export const SESSIONS_COLLECTION = "sessions";

/** @param {string} sessionId @returns {string} */
export function actionsCollection(sessionId) {
  return `${SESSIONS_COLLECTION}/${sessionId}/actions`;
}
