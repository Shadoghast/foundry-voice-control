/**
 * Foundry Voice Control — server-to-client dispatcher.
 *
 * The bridge between an HTTP route handler and the GM's browser. Tool
 * implementations that need canvas / UI / live rolls call
 * dispatchToClient(...) which:
 *
 *   1. Picks a connected GM (errors with gm_unavailable if none).
 *   2. Generates a dispatch_id.
 *   3. Holds a Promise keyed by dispatch_id.
 *   4. Emits a `dispatch` envelope to the GM via socket-integration.
 *   5. Resolves the Promise on the matching `reply` envelope or rejects
 *      with TimeoutError after the configured budget.
 *
 * Also routes incoming presence and disconnect messages from clients
 * into gm-presence.
 */

import * as crypto from "node:crypto";

import { DEFAULT_DISPATCH_TIMEOUT_MS } from "../shared/constants.mjs";
import {
  ApiError,
  ErrorCode,
  GmUnavailableError,
  TimeoutError,
} from "../shared/errors.mjs";
import { logger } from "./logger.mjs";
import {
  pickGm,
  recordOfflineByUser,
  recordOfflineBySocket,
  recordOnline,
} from "./gm-presence.mjs";
import {
  emitToUser,
  isReady as socketReady,
  onClientMessage,
} from "./socket-integration.mjs";
import { handleAdminRequest } from "./admin-handler.mjs";

const pending = new Map(); // dispatch_id → { resolve, reject, timer, tool }

/**
 * Wire the dispatcher to incoming socket traffic. Call once at server boot
 * AFTER initSocketIntegration() returns true.
 */
export function initDispatcher() {
  onClientMessage((payload, meta) => {
    if (!payload || typeof payload !== "object") return;

    switch (payload.kind) {
      case "presence:online": {
        // Prefer the socket-authenticated userId. If we have it and it
        // disagrees with the payload, refuse — a malicious client tried to
        // claim another user's identity.
        const authUserId = meta?.authUserId ?? null;
        const claimed = payload.user_id;
        if (authUserId && claimed && authUserId !== claimed) {
          logger.warn({
            msg: "presence:online rejected — userId mismatch",
            auth_user_id: authUserId,
            claimed_user_id: claimed,
          });
          return;
        }
        const userId = authUserId ?? claimed;
        if (!userId) return;
        recordOnline({
          userId,
          userName: payload.user_name,
          socketId: meta.socketId,
        });
        return;
      }

      case "presence:offline": {
        // Same anti-spoof check.
        const authUserId = meta?.authUserId ?? null;
        const claimed = payload.user_id;
        if (authUserId && claimed && authUserId !== claimed) return;
        recordOfflineByUser(authUserId ?? claimed);
        return;
      }

      case "_socket:disconnect":
        recordOfflineBySocket(payload.socket_id);
        return;

      case "reply":
        handleReply(payload);
        return;

      case "admin:request":
        // Fire-and-forget; admin handler emits its own reply via socket.
        Promise.resolve(handleAdminRequest(payload, meta)).catch((err) =>
          logger.warn({ msg: "admin handler rejected", err }),
        );
        return;

      default:
        logger.warn({ msg: "Unknown socket payload kind", kind: payload.kind });
    }
  });
}

/**
 * Dispatch a tool call to a connected GM client and await its reply.
 * Returns the client's reply envelope { ok, summary, data, error? }.
 *
 * Throws GmUnavailableError if no GM is connected; throws TimeoutError if
 * the reply doesn't arrive within timeoutMs; throws ApiError if the
 * client returned an error reply.
 */
export async function dispatchToClient({
  tool,
  params = {},
  options = {},
  timeoutMs = DEFAULT_DISPATCH_TIMEOUT_MS,
}) {
  if (!socketReady()) {
    throw new ApiError(
      ErrorCode.INTERNAL,
      "Server-to-client dispatch isn't initialized.",
      { reason: "socket-integration-not-ready" },
    );
  }

  const target = pickGm();
  if (!target) {
    throw new GmUnavailableError(tool);
  }

  const dispatchId = crypto.randomUUID();

  const replyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(dispatchId);
      reject(new TimeoutError(tool, timeoutMs));
    }, timeoutMs);
    pending.set(dispatchId, { resolve, reject, timer, tool });
  });

  try {
    emitToUser(target.userId, {
      kind: "dispatch",
      dispatch_id: dispatchId,
      tool,
      params,
      options,
    });
  } catch (err) {
    const entry = pending.get(dispatchId);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(dispatchId);
    }
    throw new ApiError(ErrorCode.INTERNAL, "Failed to emit dispatch.", {
      tool,
      reason: err.message,
    });
  }

  return replyPromise;
}

/** Internal: handle a reply payload from a client. */
function handleReply(payload) {
  const { dispatch_id: dispatchId } = payload;
  const entry = pending.get(dispatchId);
  if (!entry) {
    // Late or unknown reply — log but don't propagate.
    logger.warn({ msg: "Reply without pending dispatch", dispatch_id: dispatchId });
    return;
  }
  pending.delete(dispatchId);
  clearTimeout(entry.timer);

  if (payload.ok) {
    entry.resolve({
      ok: true,
      summary: payload.summary ?? "",
      data: payload.data ?? {},
    });
  } else {
    const errCode = payload.error?.code ?? ErrorCode.INTERNAL;
    entry.reject(
      new ApiError(errCode, payload.summary ?? "Client handler failed.", payload.error ?? {}),
    );
  }
}

/** Test-only state reset. */
export function _resetForTests() {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}

/** Test-only state read. */
export function _pendingForTests() {
  return new Map(pending);
}
