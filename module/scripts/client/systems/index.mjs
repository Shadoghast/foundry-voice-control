/**
 * Foundry Voice Control — client-side system registration.
 */

import { registerClientSystemHandler } from "./registry.mjs";
import { whtowClient } from "./whtow.mjs";
import { shadowdarkClient } from "./shadowdark.mjs";
import { dnd5eClient } from "./dnd5e.mjs";

export function registerAllClientSystems() {
  registerClientSystemHandler(whtowClient);
  registerClientSystemHandler(shadowdarkClient);
  registerClientSystemHandler(dnd5eClient);
}
