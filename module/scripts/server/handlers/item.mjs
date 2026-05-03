/**
 * Foundry Voice Control — item tool handlers (server-side).
 *
 * Implements: list_items, add_item, remove_item, update_item.
 *
 * `add_item` supports two paths — inline spec, or compendium reference
 * (which captures pack_version per the safety doc's compendium pinning).
 * System-specific spec validation is delegated to the system registry
 * (sub-stage 3f); for now it's a permissive pass-through.
 */

import { MODULE_ID } from "../../shared/constants.mjs";
import { NotFoundError, ValidationError } from "../../shared/errors.mjs";
import { resolveByIdOrName } from "../../shared/resolver.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { logger } from "../logger.mjs";
import { recordUndo } from "../undo-store.mjs";
import { getActiveSystemHandler } from "../systems/registry.mjs";

export function registerItemHandlers() {
  registerTool("list_items", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params }) {
      const actor = resolveActor(params.actor);
      const typeFilter = typeof params.type_filter === "string" ? params.type_filter : null;
      let items = Array.from(actor.items.values());
      if (typeFilter) items = items.filter((i) => i.type === typeFilter);

      const matchPart = typeFilter ? `, ${items.length} match type '${typeFilter}'` : "";
      return {
        summary: `${actor.items.size} item${actor.items.size === 1 ? "" : "s"} on ${actor.name}${matchPart}.`,
        data: {
          items: items.map((i) => ({ id: i.id, name: i.name, type: i.type })),
        },
      };
    },
  });

  registerTool("add_item", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      const actor = resolveActor(params.actor);
      const itemSpec = params.item;
      if (!itemSpec || typeof itemSpec !== "object") {
        throw new ValidationError("Missing required parameter 'item'.", { field: "item" });
      }

      let toCreate;
      let warnings = [];
      if (itemSpec.compendium && itemSpec.name) {
        const result = await resolveCompendiumEntry(itemSpec.compendium, itemSpec.name);
        toCreate = {
          ...result.source,
          flags: {
            ...(result.source.flags ?? {}),
            [MODULE_ID]: {
              compendium: {
                pack_id: result.packId,
                entry_id: result.entryId,
                pack_version: result.packVersion ?? null,
              },
            },
          },
        };
      } else {
        // Inline spec.
        if (!itemSpec.type || !itemSpec.name) {
          throw new ValidationError("Inline item spec needs at least 'type' and 'name'.", {
            field: "item",
          });
        }
        // VERIFY: registered item types per system.
        const validTypes = Object.keys(game.system.documentTypes?.Item ?? {});
        if (validTypes.length > 0 && !validTypes.includes(itemSpec.type)) {
          throw new ValidationError(`Unknown item type '${itemSpec.type}'.`, {
            field: "item.type",
            valid_types: validTypes,
          });
        }
        validateItemSpecOrThrow(itemSpec);
        toCreate = itemSpec;
      }

      const [created] = await actor.createEmbeddedDocuments("Item", [toCreate]);
      const undoToken = recordUndo(ctx, {
        tool: "add_item",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: {
          type: "add_item",
          actor_id: actor.id,
          item_id: created.id,
          item_name: created.name,
        },
      });
      return {
        summary: `Added ${created.name} to ${actor.name}.`,
        data: { item_id: created.id, name: created.name, type: created.type, undo_token: undoToken },
        warnings,
      };
    },
  });

  registerTool("remove_item", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      const actor = resolveActor(params.actor);
      const item = resolveItemOnActor(actor, params.item);
      const itemData = item.toObject();
      await actor.deleteEmbeddedDocuments("Item", [item.id]);
      const undoToken = recordUndo(ctx, {
        tool: "remove_item",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: { type: "remove_item", actor_id: actor.id, item_data: itemData },
      });
      return {
        summary: `Removed ${item.name} from ${actor.name}.`,
        data: { actor_id: actor.id, item_id: item.id, name: item.name, undo_token: undoToken },
      };
    },
  });

  registerTool("update_item", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      const actor = resolveActor(params.actor);
      const item = resolveItemOnActor(actor, params.item);
      if (!params.patch || typeof params.patch !== "object") {
        throw new ValidationError("Missing required parameter 'patch'.", { field: "patch" });
      }
      validateItemPatchPathsOrThrow(params.patch);
      const reversePatch = computeReverseItemPatch(item, params.patch);
      await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, ...params.patch }]);
      const changed = Object.keys(flattenPatch(params.patch));
      const undoToken = recordUndo(ctx, {
        tool: "update_item",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: {
          type: "update_item",
          actor_id: actor.id,
          item_id: item.id,
          reverse_patch: reversePatch,
        },
      });
      return {
        summary: `Updated ${item.name} on ${actor.name} (${changed.length} field${changed.length === 1 ? "" : "s"}).`,
        data: { item_id: item.id, changes_applied: changed, undo_token: undoToken },
      };
    },
  });
}

// ---------- helpers ----------

function resolveActor(idOrName) {
  if (idOrName == null) {
    throw new ValidationError("Missing required parameter 'actor'.", { field: "actor" });
  }
  const items = Array.from(game.actors.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  const { match } = resolveByIdOrName({ items, query: String(idOrName), kind: "actor" });
  return match.doc;
}

function resolveItemOnActor(actor, idOrName) {
  if (idOrName == null) {
    throw new ValidationError("Missing required parameter 'item'.", { field: "item" });
  }
  const items = Array.from(actor.items.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  const { match } = resolveByIdOrName({ items, query: String(idOrName), kind: "item" });
  return match.doc;
}

async function resolveCompendiumEntry(packId, entryName) {
  const pack = game.packs.get(packId);
  if (!pack) {
    throw new NotFoundError("compendium", packId, []);
  }
  const index = await pack.getIndex();
  const entry = index.find((e) => e.name === entryName);
  if (!entry) {
    const suggestions = index
      .filter((e) => e.name?.toLowerCase().includes(String(entryName).toLowerCase()))
      .slice(0, 3)
      .map((e) => ({ id: e._id, name: e.name }));
    throw new NotFoundError("compendium-entry", entryName, suggestions);
  }
  const source = await pack.getDocument(entry._id);
  // VERIFY: pack version field name on v14. Older Foundry exposed
  // pack.metadata.version; if missing, return null and live with the warn.
  const packVersion = pack.metadata?.version ?? null;
  return {
    source: source.toObject(),
    packId,
    entryId: entry._id,
    packVersion,
  };
}

function flattenPatch(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      flattenPatch(v, path, out);
    } else {
      out[path] = v;
    }
  }
  return out;
}

function computeReverseItemPatch(item, patch) {
  const flat = flattenPatch(patch);
  const reverse = {};
  for (const path of Object.keys(flat)) {
    reverse[path] = getPath(item, path);
  }
  return reverse;
}

function getPath(obj, path) {
  const parts = path.split(".");
  let cursor = obj;
  for (const p of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
}

function validateItemSpecOrThrow(spec) {
  const handler = getActiveSystemHandler();
  if (!handler || typeof handler.validateItemSpec !== "function") {
    warnNoSystemHandler();
    return;
  }
  const result = handler.validateItemSpec(spec);
  if (!result?.ok) {
    throw new ValidationError(`Item spec rejected by ${handler.id} validator.`, {
      errors: result?.errors ?? [],
    });
  }
}

function validateItemPatchPathsOrThrow(patch) {
  const handler = getActiveSystemHandler();
  if (!handler || typeof handler.validateUpdatePath !== "function") {
    warnNoSystemHandler();
    return;
  }
  const flat = flattenPatch(patch);
  for (const path of Object.keys(flat)) {
    const r = handler.validateUpdatePath(path, "item");
    if (!r?.ok) {
      throw new ValidationError(`Path '${path}' rejected by ${handler.id} validator.`, {
        path,
        error: r?.error,
      });
    }
  }
}

let warnedNoHandler = false;
function warnNoSystemHandler() {
  if (warnedNoHandler) return;
  warnedNoHandler = true;
  logger.warn({
    msg: "No system handler registered for item validation. Pass-through mode.",
    system: globalThis.game?.system?.id ?? "unknown",
  });
}
