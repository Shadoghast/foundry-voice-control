/**
 * Foundry Voice Control — admin RPC (client side).
 *
 * Sends `admin:request` envelopes to the server over the module socket and
 * resolves the matching `admin:reply`. Used by the chat command handlers.
 */

import { SOCKET_NAMESPACE } from "../shared/constants.mjs";

const pending = new Map(); // request_id → { resolve, reject, timer }
const TIMEOUT_MS = 10_000;

/** Public: send an admin command and await the reply. */
export async function adminRpc(action, args = {}) {
  if (!game?.user?.id) {
    throw new Error("No user context — cannot RPC.");
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Admin RPC timed out."));
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });

    try {
      game.socket.emit(SOCKET_NAMESPACE, {
        kind: "admin:request",
        request_id: requestId,
        user_id: game.user.id,
        action,
        args,
      });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(err);
    }
  });
}

/** Called by the client socket handler when an admin:reply arrives. */
export function handleAdminReply(payload) {
  if (!payload || typeof payload !== "object") return;
  const entry = pending.get(payload.request_id);
  if (!entry) return;
  pending.delete(payload.request_id);
  clearTimeout(entry.timer);
  if (payload.ok) entry.resolve(payload);
  else entry.reject(new Error(payload.error ?? "Admin command failed."));
}

export function _resetForTests() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
