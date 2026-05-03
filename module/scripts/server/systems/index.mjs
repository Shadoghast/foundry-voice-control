/**
 * Foundry Voice Control — server-side system handler registration.
 *
 * Currently registers WH:TOW, Shadowdark, and D&D 5e handlers.
 */

import { registerSystemHandler } from "./registry.mjs";
import { whtowServer } from "./whtow.mjs";
import { shadowdarkServer } from "./shadowdark.mjs";
import { dnd5eServer } from "./dnd5e.mjs";

export function registerAllServerSystems() {
  registerSystemHandler(whtowServer);
  registerSystemHandler(shadowdarkServer);
  registerSystemHandler(dnd5eServer);
}
