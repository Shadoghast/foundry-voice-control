/**
 * Foundry Voice Control — client entry point.
 *
 * Runs in every connected user's browser. The client side is responsible for
 * canvas / UI / live-roll operations dispatched from the server via the module
 * socket layer. See docs/architecture.md.
 */

import {
  MODULE_ID,
  MODULE_TITLE,
  CONTRACT_VERSION,
} from "./shared/constants.mjs";
import { initClientSocket } from "./client/socket-handler.mjs";
import { initChatCommands } from "./client/chat-commands.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | client init (contract ${CONTRACT_VERSION})`);

  // Public api object — handlers attach here in later sub-stages.
  // See references/core-foundry-api.md "Module socket layer".
  const moduleEntry = game.modules.get(MODULE_ID);
  if (moduleEntry) {
    moduleEntry.api = {
      contractVersion: CONTRACT_VERSION,
    };
  }
});

Hooks.once("ready", () => {
  const role = game.user.isGM ? "GM" : "player";
  console.log(
    `${MODULE_ID} | client ready — user '${game.user.name}' (${role}), ` +
      `system '${game.system.id}' v${game.system.version}, ` +
      `Foundry v${game.version} (gen ${game.release.generation})`,
  );

  // Wire the dispatch handler and announce presence (GM only).
  initClientSocket();

  // Register the /voice chat commands (GM-only at runtime).
  initChatCommands();

  // Banner notification on first GM connect — confirms the module is alive.
  if (game.user.isGM) {
    ui.notifications.info(`${MODULE_TITLE} loaded (v${CONTRACT_VERSION}).`);
  }
});
