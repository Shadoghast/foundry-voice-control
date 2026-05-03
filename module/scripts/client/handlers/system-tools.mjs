/**
 * Foundry Voice Control — system-gated client tools (use_item, roll).
 *
 * Receives dispatch envelopes from the server and routes to the active
 * system's client handler.
 */

import { registerClientTool } from "../registry.mjs";
import {
  getActiveClientSystemHandler,
  listSupportedClientSystems,
} from "../systems/registry.mjs";

export function registerSystemToolClientHandlers() {
  registerClientTool("use_item", async ({ params }) => {
    const handler = getActiveClientSystemHandler();
    if (!handler) {
      throw clientError(
        "system_unsupported",
        `No client handler for system '${game.system?.id}'.`,
        {
          active_system: game.system?.id ?? "unknown",
          supported_systems: listSupportedClientSystems(),
        },
      );
    }

    const actor = game.actors.get(params.actor_id);
    if (!actor) throw clientError("not_found", `Actor not found: ${params.actor_id}.`);
    const item = actor.items.get(params.item_id);
    if (!item) throw clientError("not_found", `Item not found on '${actor.name}'.`);

    const result = await handler.useItem(actor, item, params.options ?? {});
    return { summary: result.summary, data: result.data ?? {} };
  });

  registerClientTool("roll", async ({ params }) => {
    const handler = getActiveClientSystemHandler();
    if (!handler) {
      throw clientError(
        "system_unsupported",
        `No client handler for system '${game.system?.id}'.`,
        {
          active_system: game.system?.id ?? "unknown",
          supported_systems: listSupportedClientSystems(),
        },
      );
    }

    const actor = game.actors.get(params.actor_id);
    if (!actor) throw clientError("not_found", `Actor not found: ${params.actor_id}.`);

    const result = await handler.roll(actor, params.kind, params.target, params.options ?? {});
    return { summary: result.summary, data: result.data ?? {} };
  });
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
