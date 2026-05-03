/**
 * Foundry Voice Control — client handler barrel.
 */

import { registerClientTokenHandlers } from "./tokens.mjs";
import { registerClientPerceptionHandlers } from "./perception.mjs";
import { registerClientUndoHandler } from "./undo-apply.mjs";
import { registerSystemToolClientHandlers } from "./system-tools.mjs";
import { registerAllClientSystems } from "../systems/index.mjs";

export function registerAllClientHandlers() {
  // Systems must register first — system-tools handlers consult the registry.
  registerAllClientSystems();

  registerClientTokenHandlers();
  registerClientPerceptionHandlers();
  registerClientUndoHandler();
  registerSystemToolClientHandlers();
}
