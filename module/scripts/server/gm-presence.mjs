/**
 * Foundry Voice Control — GM presence tracking.
 *
 * In-memory record of which GM clients are currently connected. Updated by
 * the client's presence:online / presence:offline announcements and by
 * socket disconnect events. The dispatcher uses pickGm() to choose where
 * to dispatch client-required tools.
 *
 * Strategy: clients announce themselves on socket connection (driven from
 * client.mjs's `ready` hook), and we listen for socket disconnects in
 * socket-integration.mjs to clean up.
 *
 * Multi-GM rule (per architecture.md "first registered GM wins"): the
 * earliest connection to announce itself remains the dispatch target until
 * it disconnects.
 */

import { logger } from "./logger.mjs";

/**
 * Map of userId → { name, socketId, connectedAt }.
 * Insertion order is preserved, which gives us "first connected" semantics
 * when iterating.
 */
const connectedGms = new Map();

/** Socket-id → user-id reverse index for clean disconnect handling. */
const socketToUser = new Map();

/** Record a GM as online. Called when a presence:online message arrives. */
export function recordOnline({ userId, userName, socketId }) {
  if (!userId) {
    logger.warn({ msg: "presence:online without userId" });
    return;
  }
  // If the same user reconnected, replace the entry (newer socket wins for that user).
  const existing = connectedGms.get(userId);
  if (existing && existing.socketId !== socketId) {
    socketToUser.delete(existing.socketId);
  }
  connectedGms.set(userId, {
    name: userName ?? "(unknown)",
    socketId: socketId ?? null,
    connectedAt: Date.now(),
  });
  if (socketId) socketToUser.set(socketId, userId);
  logger.info({ msg: "GM presence: online", user_id: userId, user_name: userName });
}

/** Record a GM as offline by userId. */
export function recordOfflineByUser(userId) {
  const entry = connectedGms.get(userId);
  if (!entry) return false;
  if (entry.socketId) socketToUser.delete(entry.socketId);
  connectedGms.delete(userId);
  logger.info({ msg: "GM presence: offline", user_id: userId });
  return true;
}

/** Record offline by socket id (used on socket disconnect events). */
export function recordOfflineBySocket(socketId) {
  const userId = socketToUser.get(socketId);
  if (!userId) return false;
  return recordOfflineByUser(userId);
}

/**
 * Pick a GM to dispatch to. First-connected wins per the multi-GM rule.
 * Returns null if none is connected.
 */
export function pickGm() {
  // Map iteration is insertion order — first entry is first-connected GM
  // who hasn't yet disconnected.
  for (const [userId, info] of connectedGms) {
    return { userId, ...info };
  }
  return null;
}

/** True if any GM is currently connected. */
export function isAnyGmConnected() {
  return connectedGms.size > 0;
}

/** True if a specific user is currently connected and announced as a GM. */
export function isUserConnectedGm(userId) {
  return connectedGms.has(userId);
}

/** List currently-connected GMs (public-safe info). */
export function listConnectedGms() {
  return Array.from(connectedGms.entries()).map(([userId, info]) => ({
    user_id: userId,
    user_name: info.name,
    connected_at: new Date(info.connectedAt).toISOString(),
  }));
}

/** Test-only state reset. */
export function _resetForTests() {
  connectedGms.clear();
  socketToUser.clear();
}
