/**
 * Foundry Voice Control — server-side socket integration.
 *
 * Thin abstraction over Foundry's underlying socket.io server. Two
 * primitives:
 *   - emitToUser(userId, payload)  — push a message into a specific user's tab
 *   - onClientMessage(handler)     — receive any message a client emits on
 *                                    our module's namespace
 *
 * VERIFY: how Foundry v14 exposes the socket.io server to module code is
 * the single most version-dependent piece of this module. The init
 * function tries the most likely globals in priority order; whichever
 * works first is used. If none works, server-to-client dispatch will
 * fail loudly at boot.
 *
 * Known patterns from prior versions (try in order; first that works wins):
 *   1. globalThis.io                 — common when Foundry runs Node directly
 *   2. globalThis.foundry?.io        — newer namespacing
 *   3. globalThis.serverApp?.io      — when modules attach via the app
 *
 * Whatever works at install time, lock that path here.
 */

import { SOCKET_NAMESPACE } from "../shared/constants.mjs";
import { logger } from "./logger.mjs";

let emitter = null;
let messageHandler = null;
let backend = null;

/**
 * Locate a usable socket.io server and wire up a connection handler that
 * routes incoming module.<id> events to whatever handler the dispatcher
 * registers later.
 */
export function initSocketIntegration() {
  const io = findSocketServer();
  if (!io) {
    logger.error({
      msg: "Could not locate Foundry's socket.io server. Server-to-client dispatch is disabled.",
      hint: "Update findSocketServer() in socket-integration.mjs for v14.",
    });
    return false;
  }
  backend = io;

  emitter = (userId, payload) => {
    // VERIFY: room name format for connected Foundry users on v14.
    // Common patterns: `user:${userId}`, the userId itself, or the user's
    // socket.id. Foundry historically joins users to a room named after
    // their userId.
    try {
      io.to(userId).emit(SOCKET_NAMESPACE, payload);
    } catch (err) {
      logger.warn({ msg: "emitToUser failed", user_id: userId, err });
    }
  };

  io.on("connection", (socket) => {
    // Listen on the module's namespace.
    socket.on(SOCKET_NAMESPACE, (payload) => {
      if (!messageHandler) return;
      try {
        messageHandler(payload, {
          socketId: socket.id,
          authUserId: extractAuthUserId(socket),
        });
      } catch (err) {
        logger.warn({ msg: "Client message handler threw", err });
      }
    });

    // Detect disconnects so GM presence can be cleaned up.
    socket.on("disconnect", () => {
      if (messageHandler) {
        messageHandler(
          { kind: "_socket:disconnect", socket_id: socket.id },
          { socketId: socket.id, authUserId: extractAuthUserId(socket) },
        );
      }
    });
  });

  logger.info({ msg: "Socket integration ready", backend: "io" });
  return true;
}

/** Send a payload to a specific Foundry user's connected client. */
export function emitToUser(userId, payload) {
  if (!emitter) {
    throw new Error("Socket emitter not initialized — initSocketIntegration() returned false.");
  }
  emitter(userId, payload);
}

/** Register the single handler for incoming client messages. */
export function onClientMessage(handler) {
  if (messageHandler) {
    logger.warn({ msg: "onClientMessage replacing existing handler" });
  }
  messageHandler = handler;
}

/** True if the integration successfully bound at boot. */
export function isReady() {
  return emitter !== null;
}

function findSocketServer() {
  if (globalThis.io && typeof globalThis.io.on === "function") return globalThis.io;
  if (globalThis.foundry?.io && typeof globalThis.foundry.io.on === "function") {
    return globalThis.foundry.io;
  }
  if (globalThis.serverApp?.io && typeof globalThis.serverApp.io.on === "function") {
    return globalThis.serverApp.io;
  }
  return null;
}

/**
 * Pull the authenticated Foundry userId off the socket. Foundry sets this at
 * connection time after verifying the session cookie, so it's the
 * authoritative identity for admin-command authorization. Tries known fields
 * in priority order; returns null if none match (caller falls back to
 * payload-trust with a logged warning).
 *
 * VERIFY: the exact field name on Foundry v14. Common patterns:
 *   - socket.userId           (set by Foundry's connection middleware)
 *   - socket.user?.id         (older versions)
 *   - socket.handshake.auth?.userId
 *   - socket.handshake.session?.user?.id
 */
function extractAuthUserId(socket) {
  if (!socket) return null;
  if (typeof socket.userId === "string") return socket.userId;
  if (typeof socket.user?.id === "string") return socket.user.id;
  const handshake = socket.handshake;
  if (typeof handshake?.auth?.userId === "string") return handshake.auth.userId;
  if (typeof handshake?.session?.user?.id === "string") return handshake.session.user.id;
  return null;
}

/** Test-only state reset. */
export function _resetForTests() {
  emitter = null;
  messageHandler = null;
  backend = null;
}
