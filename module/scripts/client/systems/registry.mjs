/**
 * Foundry Voice Control — client-side system handler registry.
 *
 * Each client-side handler implements:
 *
 *   {
 *     id:                                   string,
 *     async useItem(actor, item, options)→  { rolls, chat_message_id, summary, data },
 *     async roll(actor, kind, target, opt)→ { formula, total, results, summary, data },
 *   }
 *
 * The system-tools client handler (handlers/system-tools.mjs) routes
 * incoming use_item / roll dispatches to the registered system based on
 * `game.system.id`.
 */

const handlers = new Map();

export function registerClientSystemHandler(handler) {
  if (!handler || typeof handler.id !== "string") {
    throw new Error("Client system handler must have an id");
  }
  handlers.set(handler.id, handler);
  console.log(`foundry-voice-control | client system registered: ${handler.id}`);
}

export function getActiveClientSystemHandler() {
  const id = game?.system?.id;
  if (!id) return null;
  return handlers.get(id) ?? null;
}

export function listSupportedClientSystems() {
  return [...handlers.keys()].sort();
}

export function _resetForTests() {
  handlers.clear();
}
