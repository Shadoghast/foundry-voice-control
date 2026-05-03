/**
 * Foundry Voice Control — system-gated tools (server side).
 *
 * Registers `use_item` and `roll`. Both:
 *   - require the active world's system to have a registered handler (else
 *     SystemUnsupportedError);
 *   - resolve the actor / item server-side (so we get fast not_found before
 *     burning a dispatch round-trip);
 *   - dispatch to the GM client to do the actual roll, since rolls and
 *     chat messages need the live game runtime.
 *
 * Use_item and roll are NOT undoable per the safety doc (rolls / chat
 * messages are append-only).
 */

import { SystemUnsupportedError, ValidationError } from "../../shared/errors.mjs";
import { resolveByIdOrName } from "../../shared/resolver.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { dispatchToClient } from "../dispatcher.mjs";
import {
  getActiveSystemHandler,
  listSupportedSystems,
} from "../systems/registry.mjs";

export function registerSystemToolHandlers() {
  registerTool("use_item", {
    scope: SCOPES.ROLL,
    kind: "request", // not destructive, not a mutation in the "snapshot-able" sense
    requireScope: (scopes) => requireScope(scopes, SCOPES.ROLL),
    async handler({ params, options }) {
      requireSystemHandler("use_item");
      if (!params.actor) throw new ValidationError("Missing 'actor'.", { field: "actor" });
      if (!params.item) throw new ValidationError("Missing 'item'.", { field: "item" });

      // Resolve server-side first for cheap not_found.
      const actor = resolveActor(params.actor);
      const item = resolveItemOnActor(actor, params.item);

      // Dispatch to client. The client's system handler runs the actual
      // use flow (rolls, chat messages, system hooks).
      const reply = await dispatchToClient({
        tool: "use_item",
        params: {
          actor_id: actor.id,
          item_id: item.id,
          options: params.options ?? options ?? {},
        },
        options,
      });

      return {
        summary: reply.summary || `Used ${item.name}.`,
        data: reply.data ?? {},
        dispatchedToClient: true,
      };
    },
  });

  registerTool("roll", {
    scope: SCOPES.ROLL,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ROLL),
    async handler({ params, options }) {
      requireSystemHandler("roll");
      if (!params.actor) throw new ValidationError("Missing 'actor'.", { field: "actor" });
      if (!params.kind) throw new ValidationError("Missing 'kind'.", { field: "kind" });
      if (!params.target) throw new ValidationError("Missing 'target'.", { field: "target" });

      const validKinds = new Set(["skill", "save", "attack", "custom"]);
      if (!validKinds.has(params.kind)) {
        throw new ValidationError(`Unknown roll kind '${params.kind}'.`, {
          field: "kind",
          valid: [...validKinds],
        });
      }

      const actor = resolveActor(params.actor);

      const reply = await dispatchToClient({
        tool: "roll",
        params: {
          actor_id: actor.id,
          kind: params.kind,
          target: params.target,
          options: params.options ?? options ?? {},
        },
        options,
      });

      return {
        summary: reply.summary || `Roll completed.`,
        data: reply.data ?? {},
        dispatchedToClient: true,
      };
    },
  });
}

// ---------- helpers ----------

function requireSystemHandler(toolName) {
  const handler = getActiveSystemHandler();
  if (!handler) {
    throw new SystemUnsupportedError(
      toolName,
      globalThis.game?.system?.id ?? "unknown",
      listSupportedSystems(),
    );
  }
  return handler;
}

function resolveActor(idOrName) {
  const items = Array.from(game.actors.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  const { match } = resolveByIdOrName({ items, query: String(idOrName), kind: "actor" });
  return match.doc;
}

function resolveItemOnActor(actor, idOrName) {
  const items = Array.from(actor.items.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  const { match } = resolveByIdOrName({ items, query: String(idOrName), kind: "item" });
  return match.doc;
}
