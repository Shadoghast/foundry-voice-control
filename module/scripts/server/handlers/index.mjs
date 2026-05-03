/**
 * Foundry Voice Control — server handler barrel.
 */

import { registerSceneHandlers } from "./scene.mjs";
import { registerActorHandlers } from "./actor.mjs";
import { registerItemHandlers } from "./item.mjs";
import { registerSetTokenImageHandler } from "./set-token-image.mjs";
import { registerPerceptionHandlers } from "./perception.mjs";
import { registerClientDispatchedHandlers } from "./client-dispatched.mjs";
import { registerUndoHandler } from "./undo.mjs";
import { registerSystemToolHandlers } from "./system-tools.mjs";

export function registerAllServerHandlers() {
  registerSceneHandlers();
  registerActorHandlers();
  registerItemHandlers();
  registerSetTokenImageHandler();
  registerPerceptionHandlers();
  registerClientDispatchedHandlers();
  registerUndoHandler();
  registerSystemToolHandlers();
}
