/**
 * Foundry Voice Control — actor tool handlers (server-side).
 *
 * Implements: create_actor, update_actor, get_actor, find_actor,
 * set_actor_image, delete_actor.
 *
 * System-specific validation in create_actor and update_actor's `system.*`
 * paths is delegated to the system registry (sub-stage 3f). For now it's
 * a permissive pass-through with a warning logged once per system.
 */

import * as nodePath from "node:path";

import { ValidationError } from "../../shared/errors.mjs";
import { resolveByIdOrName, scoreItems } from "../../shared/resolver.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { resolveKeysFilePath } from "../auth.mjs";
import { validateImageInput } from "../image-validation.mjs";
import { SETTING_KEYS, getSetting } from "../settings.mjs";
import { logger } from "../logger.mjs";
import { recordUndo } from "../undo-store.mjs";
import { getActiveSystemHandler } from "../systems/registry.mjs";

export function registerActorHandlers() {
  registerTool("create_actor", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      const { name, type, img, prototypeToken, system, items } = params;
      if (!name || typeof name !== "string") {
        throw new ValidationError("Missing required parameter 'name'.", { field: "name" });
      }
      if (!type || typeof type !== "string") {
        throw new ValidationError("Missing required parameter 'type'.", { field: "type" });
      }
      // VERIFY: documentTypes structure on v14. Subtype list lives at
      // game.system.documentTypes.Actor (object whose keys are subtypes).
      const validTypes = Object.keys(game.system.documentTypes?.Actor ?? {});
      if (validTypes.length > 0 && !validTypes.includes(type)) {
        throw new ValidationError(`Unknown actor type '${type}'.`, {
          field: "type",
          valid_types: validTypes,
        });
      }

      // Delegate system-specific spec validation.
      validateSpecOrThrow({ name, type, system, items });

      const data = {
        name,
        type,
        ...(img ? { img } : {}),
        ...(prototypeToken ? { prototypeToken } : {}),
        ...(system ? { system } : {}),
        ...(items ? { items } : {}),
      };

      const actor = await Actor.create(data);
      const undoToken = recordUndo(ctx, {
        tool: "create_actor",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: { type: "create_actor", actor_id: actor.id, actor_name: actor.name },
      });
      return {
        summary: `Created ${type} '${actor.name}'${items?.length ? ` with ${items.length} item${items.length === 1 ? "" : "s"}` : ""}.`,
        data: { actor_id: actor.id, name: actor.name, type: actor.type, undo_token: undoToken },
      };
    },
  });

  registerTool("update_actor", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      assertParam(params, "actor");
      assertParam(params, "patch");
      const items = actorItems();
      const { match } = resolveByIdOrName({
        items,
        query: String(params.actor),
        kind: "actor",
      });
      const actor = match.doc;

      // Reject items keys per recipe.
      if (params.patch.items !== undefined) {
        throw new ValidationError(
          "Cannot patch 'items' via update_actor. Use add_item / remove_item / update_item.",
          { hint: "tools: add_item, remove_item, update_item" },
        );
      }

      // Delegate system-specific path validation per safety doc.
      validatePatchPathsOrThrow(params.patch, "actor");

      // Capture reverse patch BEFORE applying.
      const reversePatch = computeReversePatch(actor, params.patch);

      // Foundry deep-merges; dot-notation paths resolve correctly.
      await actor.update(params.patch);
      const changed = Object.keys(flattenPatch(params.patch));

      const undoToken = recordUndo(ctx, {
        tool: "update_actor",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: { type: "update_actor", actor_id: actor.id, reverse_patch: reversePatch },
      });

      return {
        summary: `Updated ${actor.name} (${changed.length} field${changed.length === 1 ? "" : "s"}).`,
        data: { actor_id: actor.id, changes_applied: changed, undo_token: undoToken },
      };
    },
  });

  registerTool("get_actor", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params }) {
      assertParam(params, "actor");
      const items = actorItems();
      const { match } = resolveByIdOrName({
        items,
        query: String(params.actor),
        kind: "actor",
      });
      const actor = match.doc;

      const fields = Array.isArray(params.fields) ? params.fields : null;
      const full = actor.toObject();
      const projected = fields ? projectFields(full, fields) : full;

      // Wrap user-authored prose fields per safety doc.
      const wrapped = wrapUntrusted(projected);

      // Prefer the system handler's voice template if registered.
      const sysHandler = getActiveSystemHandler();
      let summary;
      if (sysHandler && typeof sysHandler.composeActorSummary === "function") {
        try {
          summary = sysHandler.composeActorSummary(actor);
        } catch (err) {
          logger.warn({ msg: "System composeActorSummary threw; falling back", err });
        }
      }
      if (!summary) {
        const hp = full.system?.attributes?.hp;
        const ac = full.system?.attributes?.ac?.value ?? full.system?.attributes?.ac?.flat;
        summary = composeUniversalActorSummary(actor.name, actor.type, hp, ac);
      }

      return {
        summary,
        data: { actor: wrapped },
      };
    },
  });

  registerTool("find_actor", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params, ctx }) {
      assertParam(params, "query");
      const respect = !!getSetting(SETTING_KEYS.RESPECT_OWNERSHIP);
      const isGm = ctx.key.scopes.includes(SCOPES.GM);
      const limit = Math.max(1, Math.min(50, Number(params.limit ?? 10)));

      const all = actorItems().filter(({ doc }) => {
        if (params.type && doc.type !== params.type) return false;
        if (respect && !isGm && hasRestrictedOwnership(doc)) return false;
        return true;
      });

      const scored = scoreItems(all, String(params.query), 0)
        .slice(0, limit)
        .map(({ item, score }) => ({
          id: item.id,
          name: item.name,
          type: item.doc.type,
          score: Math.round(score * 100) / 100,
        }));

      const top = scored.slice(0, 2).map((m) => `'${m.name}'`).join(" and ");
      const summary = scored.length === 0
        ? `No actor matches '${params.query}'.`
        : `${scored.length} actor${scored.length === 1 ? "" : "s"} match '${params.query}'.${top ? ` Top: ${top}.` : ""}`;
      return { summary, data: { matches: scored } };
    },
  });

  registerTool("set_actor_image", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.ACTOR_WRITE),
    async handler({ params, ctx }) {
      assertParam(params, "actor");
      assertParam(params, "image");
      const items = actorItems();
      const { match } = resolveByIdOrName({
        items,
        query: String(params.actor),
        kind: "actor",
      });
      const actor = match.doc;
      const userDataPath = resolveUserDataPath();
      const validated = await validateImageInput(String(params.image), userDataPath);

      const previousImage = actor.img;
      const previousProto = actor.prototypeToken?.texture?.src;
      const alsoProto = !!params.also_update_prototype_token;

      const patch = { img: validated.value };
      if (alsoProto) patch["prototypeToken.texture.src"] = validated.value;
      await actor.update(patch);

      const undoToken = recordUndo(ctx, {
        tool: "set_actor_image",
        scopeRequired: SCOPES.ACTOR_WRITE,
        clientRequired: false,
        payload: {
          type: "set_actor_image",
          actor_id: actor.id,
          previous_img: previousImage,
          previous_proto_img: alsoProto ? previousProto : undefined,
        },
      });

      return {
        summary: `Updated portrait for ${actor.name}${alsoProto ? ", prototype too" : ""}.`,
        data: {
          actor_id: actor.id,
          previous_image: previousImage,
          new_image: validated.value,
          prototype_updated: alsoProto,
          previous_prototype_image: alsoProto ? previousProto : undefined,
          undo_token: undoToken,
        },
        warnings: validated.warnings,
      };
    },
  });

  registerTool("delete_actor", {
    scope: SCOPES.GM,
    kind: "destructive",
    requireScope: (scopes) => requireScope(scopes, SCOPES.GM),
    async handler({ params, options, ctx }) {
      assertParam(params, "actor");
      const items = actorItems();
      const { match } = resolveByIdOrName({
        items,
        query: String(params.actor),
        kind: "actor",
      });
      const actor = match.doc;

      const itemCount = actor.items?.size ?? 0;
      const inActiveCombat = !!game.combat?.combatants?.find?.((c) => c.actorId === actor.id);

      // Dry-run-first per safety doc + recipes. Module enforces confirm: true.
      if (options?.dry_run || params.confirm !== true) {
        return {
          summary: `Would delete ${actor.type} '${actor.name}' (${itemCount} item${itemCount === 1 ? "" : "s"}${inActiveCombat ? ", in active combat" : ""}).`,
          data: {
            dry_run: true,
            requires_confirmation: true,
            would_delete: {
              actor_id: actor.id,
              name: actor.name,
              type: actor.type,
              item_count: itemCount,
              has_active_combat: inActiveCombat,
            },
          },
        };
      }

      // Snapshot the full actor BEFORE deletion so undo can recreate.
      const actorData = actor.toObject();
      const actorName = actor.name;
      const actorType = actor.type;
      await actor.delete();

      const undoToken = recordUndo(ctx, {
        tool: "delete_actor",
        scopeRequired: SCOPES.GM,
        clientRequired: false,
        payload: { type: "delete_actor", actor_data: actorData, actor_name: actorName },
      });

      return {
        summary: `${actorName} deleted. Undo token saved for an hour.`,
        data: { actor_id: actorData._id, name: actorName, type: actorType, undo_token: undoToken },
      };
    },
  });
}

// ---------- helpers ----------

function actorItems() {
  return Array.from(game.actors.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
}

function assertParam(params, name) {
  if (params?.[name] == null) {
    throw new ValidationError(`Missing required parameter '${name}'.`, { field: name });
  }
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

/**
 * Read the current values at every path the patch would touch, so undo
 * can apply this object to restore the prior state.
 */
function computeReversePatch(doc, patch) {
  const flat = flattenPatch(patch);
  const reverse = {};
  for (const path of Object.keys(flat)) {
    reverse[path] = getPath(doc, path);
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

function projectFields(obj, fields) {
  const out = {};
  for (const path of fields) {
    const parts = String(path).split(".");
    let cursorIn = obj;
    let cursorOut = out;
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      if (cursorIn == null || typeof cursorIn !== "object") break;
      if (i === parts.length - 1) {
        cursorOut[k] = cursorIn[k];
      } else {
        cursorOut[k] = cursorOut[k] ?? {};
        cursorOut = cursorOut[k];
        cursorIn = cursorIn[k];
      }
    }
  }
  return out;
}

const PROSE_FIELDS = new Set([
  "system.details.biography.value",
  "system.details.biography.public",
  "system.description.value",
  "system.bio",
  "system.notes",
]);

function wrapUntrusted(actor) {
  // Walk known prose paths and wrap with the untrusted marker.
  const out = JSON.parse(JSON.stringify(actor));
  for (const path of PROSE_FIELDS) {
    const parts = path.split(".");
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cursor = cursor?.[parts[i]];
      if (cursor == null) break;
    }
    if (cursor != null && typeof cursor === "object") {
      const last = parts[parts.length - 1];
      const v = cursor[last];
      if (typeof v === "string" && v.length > 0) {
        cursor[last] = { untrusted: true, content: v };
      }
    }
  }
  return out;
}

function composeUniversalActorSummary(name, type, hp, ac) {
  const parts = [`${name} — ${type}`];
  if (hp && hp.value != null && hp.max != null) parts.push(`HP ${hp.value}/${hp.max}`);
  if (ac != null) parts.push(`AC ${ac}`);
  return parts.join(", ") + ".";
}

function hasRestrictedOwnership(actor) {
  // VERIFY: ownership flags shape on v14. Universal default ownership
  // values: 0 = none, 1 = limited, 2 = observer, 3 = owner.
  // "Restricted" here means default=0 with no explicit grants beyond GM.
  const ownership = actor.ownership ?? actor.permission ?? {};
  const defaultOwn = ownership.default ?? 0;
  return defaultOwn === 0;
}

/**
 * Run the active system's actor-spec validator over the parts of the spec
 * that touch system data. Throws ValidationError on rejection. If no
 * system handler is registered, logs once and lets the spec through.
 */
function validateSpecOrThrow(spec) {
  const handler = getActiveSystemHandler();
  if (!handler) {
    warnNoSystemHandler();
    return;
  }
  if (typeof handler.validateActorSpec !== "function") return;
  const result = handler.validateActorSpec(spec);
  if (!result?.ok) {
    throw new ValidationError(
      `Actor spec rejected by ${handler.id} validator.`,
      { errors: result?.errors ?? [] },
    );
  }
}

/**
 * Validate every dot-path in a patch against the active system's
 * validateUpdatePath. Throws on the first reject.
 */
function validatePatchPathsOrThrow(patch, kind) {
  const handler = getActiveSystemHandler();
  if (!handler || typeof handler.validateUpdatePath !== "function") {
    warnNoSystemHandler();
    return;
  }
  const flat = flattenPatch(patch);
  for (const path of Object.keys(flat)) {
    const r = handler.validateUpdatePath(path, kind);
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
    msg: "No system handler registered for the active system. Validation is pass-through.",
    system: globalThis.game?.system?.id ?? "unknown",
  });
}

function resolveUserDataPath() {
  // Same derivation as in server.mjs's audit log init.
  const keysPath = resolveKeysFilePath();
  // <userData>/Data/modules/foundry-voice-control/keys.json → strip 4 levels.
  return nodePath.dirname(nodePath.dirname(nodePath.dirname(nodePath.dirname(keysPath))));
}
