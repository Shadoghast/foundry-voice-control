/**
 * Foundry Voice Control — client-side tool registry.
 *
 * Mirrors the server-side TOOL_REGISTRY in routes.mjs but for handlers
 * that run in the browser (canvas, UI, live-roll work). Sub-stage 3c
 * registers a single stub `_ping_client` tool here to prove the
 * dispatch round-trip; real handlers land in 3d.
 *
 * Each handler is async, takes `{ params, options }`, and returns
 * `{ summary, data }` on success. Throw an Error to signal failure;
 * the socket handler converts to a reply envelope.
 */

const CLIENT_TOOLS = new Map();

export function registerClientTool(name, handler) {
  if (CLIENT_TOOLS.has(name)) {
    console.warn(`foundry-voice-control | client tool '${name}' re-registered`);
  }
  CLIENT_TOOLS.set(name, handler);
}

export function getClientTool(name) {
  return CLIENT_TOOLS.get(name);
}

/** Read-only view for tests / introspection. */
export function listClientTools() {
  return Array.from(CLIENT_TOOLS.keys()).sort();
}

/** Test-only reset. */
export function _resetForTests() {
  CLIENT_TOOLS.clear();
}
