/**
 * Foundry Voice Control — server-side system handler registry.
 *
 * Each system handler implements a small synchronous interface used by the
 * universal handlers to validate system-specific data:
 *
 *   {
 *     id:                    string,                       // game.system.id
 *     validateActorSpec:    (spec) => { ok, errors[] },
 *     validateItemSpec:     (spec) => { ok, errors[] },
 *     validateUpdatePath:   (path, kind) => { ok, error? },
 *     composeActorSummary:  (actor) => string,
 *   }
 *
 * Client-side execution (use_item, roll, etc.) lives in scripts/client/
 * systems/. The two halves coordinate via the shared `id` and the contract.
 */

import { logger } from "../logger.mjs";

const handlers = new Map();

/**
 * Register a server-side system handler. Throws if the id is already
 * registered — duplicate registrations are a coding error.
 */
export function registerSystemHandler(handler) {
  if (!handler || typeof handler.id !== "string") {
    throw new Error("System handler must have an id string");
  }
  if (handlers.has(handler.id)) {
    throw new Error(`System handler '${handler.id}' already registered`);
  }
  handlers.set(handler.id, handler);
  logger.info({ msg: "System handler registered", system_id: handler.id });
}

/** Get the handler for the active world's system, or null if none. */
export function getActiveSystemHandler() {
  const id = globalThis.game?.system?.id;
  if (!id) return null;
  return handlers.get(id) ?? null;
}

/** Get a specific system's handler. */
export function getSystemHandler(systemId) {
  return handlers.get(systemId) ?? null;
}

/** List all registered system ids. */
export function listSupportedSystems() {
  return [...handlers.keys()].sort();
}

/** Test-only state reset. */
export function _resetForTests() {
  handlers.clear();
}
