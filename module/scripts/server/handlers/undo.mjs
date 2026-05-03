/**
 * Foundry Voice Control — undo handler.
 *
 * Single tool: `undo`. Looks up the snapshot, enforces scope and GM
 * presence per the original op, then applies the inverse via either
 * server-side ops or a dispatched `_undo_apply` to the GM client.
 *
 * Undo is one-shot — the snapshot is consumed before apply, so a
 * failure mid-apply does NOT re-issue the token. Voice should retry by
 * the user re-issuing the original.
 */

import {
  ApiError,
  ErrorCode,
  GmUnavailableError,
  NotFoundError,
} from "../../shared/errors.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { dispatchToClient } from "../dispatcher.mjs";
import { isAnyGmConnected } from "../gm-presence.mjs";
import { registerTool } from "../routes.mjs";
import { logger } from "../logger.mjs";
import { consume, peek } from "../undo-store.mjs";

export function registerUndoHandler() {
  registerTool("undo", {
    // Static `scope` is the floor — every undo invocation requires at least
    // `read` to look up the snapshot. The real authorization happens
    // dynamically inside the handler against `snapshot.scope_required`,
    // which is also surfaced via `result.auditScope` so the audit log
    // records the actual scope that was checked.
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params, ctx }) {
      const token = params?.token ?? params?.undo_token;
      if (typeof token !== "string" || token.length === 0) {
        throw new ApiError(
          ErrorCode.VALIDATION,
          "Missing required parameter 'token'.",
          { field: "token" },
        );
      }

      const snapshot = peek(token);
      if (!snapshot) {
        throw new NotFoundError("undo_token", token, []);
      }

      // Re-verify scope: the calling key must hold the same scope as the
      // tool that produced the snapshot, OR `gm`.
      requireScope(ctx.key.scopes, snapshot.scope_required);

      // GM presence check for client-required undos.
      if (snapshot.client_required && !isAnyGmConnected()) {
        throw new GmUnavailableError("undo");
      }

      // Consume — one-shot. If apply fails, the token is gone; user
      // re-issues the original op manually if needed.
      consume(token);

      const result = snapshot.client_required
        ? await applyClientSide(snapshot)
        : await applyServerSide(snapshot);

      return {
        summary: `Undone: ${result.original_summary ?? snapshot.tool}.`,
        data: {
          undone: true,
          original_tool: snapshot.tool,
          original_summary: result.original_summary ?? null,
          ...result.data,
        },
        dispatchedToClient: snapshot.client_required,
        // Tell the route handler to record the *real* scope that was
        // checked for this undo, not the descriptor's static floor.
        auditScope: snapshot.scope_required,
      };
    },
  });
}

async function applyServerSide(snapshot) {
  const { tool, payload } = snapshot;
  switch (payload.type) {
    case "create_actor": {
      const actor = game.actors.get(payload.actor_id);
      if (actor) await actor.delete();
      return {
        original_summary: `created '${payload.actor_name ?? "(unknown)"}'`,
        data: { actor_id: payload.actor_id },
      };
    }

    case "update_actor": {
      const actor = game.actors.get(payload.actor_id);
      if (!actor) throw new NotFoundError("actor", payload.actor_id, []);
      await actor.update(payload.reverse_patch);
      return {
        original_summary: `updated '${actor.name}'`,
        data: { actor_id: actor.id, reverted_paths: Object.keys(flatten(payload.reverse_patch)) },
      };
    }

    case "delete_actor": {
      // Restore from full snapshot, preserving _id so existing references
      // (combat tracker, journal links) keep working.
      const restored = await Actor.create(payload.actor_data, { keepId: true });
      return {
        original_summary: `deleted '${payload.actor_name ?? restored?.name ?? "(unknown)"}'`,
        data: { actor_id: restored?.id ?? payload.actor_data._id },
      };
    }

    case "set_actor_image": {
      const actor = game.actors.get(payload.actor_id);
      if (!actor) throw new NotFoundError("actor", payload.actor_id, []);
      const patch = { img: payload.previous_img };
      if (payload.previous_proto_img !== undefined) {
        patch["prototypeToken.texture.src"] = payload.previous_proto_img;
      }
      await actor.update(patch);
      return {
        original_summary: `changed portrait for '${actor.name}'`,
        data: { actor_id: actor.id },
      };
    }

    case "set_token_image": {
      const scene = game.scenes.get(payload.scene_id);
      if (!scene) throw new NotFoundError("scene", payload.scene_id, []);
      const tokenDoc = scene.tokens.get(payload.token_id);
      if (tokenDoc && payload.previous_image_this_token !== undefined) {
        await tokenDoc.update({ "texture.src": payload.previous_image_this_token });
      }
      if (payload.actor_id && payload.previous_image_prototype !== undefined) {
        const actor = game.actors.get(payload.actor_id);
        if (actor) {
          await actor.update({ "prototypeToken.texture.src": payload.previous_image_prototype });
        }
      }
      return {
        original_summary: `changed image for token '${tokenDoc?.name ?? payload.token_id}'`,
        data: { token_id: payload.token_id },
      };
    }

    case "add_item": {
      const actor = game.actors.get(payload.actor_id);
      if (!actor) throw new NotFoundError("actor", payload.actor_id, []);
      await actor.deleteEmbeddedDocuments("Item", [payload.item_id]);
      return {
        original_summary: `added '${payload.item_name ?? "item"}' to '${actor.name}'`,
        data: { actor_id: actor.id, item_id: payload.item_id },
      };
    }

    case "remove_item": {
      const actor = game.actors.get(payload.actor_id);
      if (!actor) throw new NotFoundError("actor", payload.actor_id, []);
      await actor.createEmbeddedDocuments("Item", [payload.item_data], { keepId: true });
      return {
        original_summary: `removed '${payload.item_data?.name ?? "item"}' from '${actor.name}'`,
        data: { actor_id: actor.id, item_id: payload.item_data?._id },
      };
    }

    case "update_item": {
      const actor = game.actors.get(payload.actor_id);
      if (!actor) throw new NotFoundError("actor", payload.actor_id, []);
      await actor.updateEmbeddedDocuments("Item", [
        { _id: payload.item_id, ...payload.reverse_patch },
      ]);
      return {
        original_summary: `updated item on '${actor.name}'`,
        data: { actor_id: actor.id, item_id: payload.item_id },
      };
    }

    case "activate_scene": {
      if (!payload.previous_scene_id) {
        return { original_summary: `activated scene`, data: { previous_scene_id: null } };
      }
      const scene = game.scenes.get(payload.previous_scene_id);
      if (!scene) throw new NotFoundError("scene", payload.previous_scene_id, []);
      await scene.activate();
      return {
        original_summary: `activated scene`,
        data: { reactivated_scene_id: scene.id, name: scene.name },
      };
    }

    default:
      logger.error({ msg: "Unknown undo payload.type", type: payload?.type, tool });
      throw new ApiError(ErrorCode.INTERNAL, "Unknown undo payload type.", {
        type: payload?.type,
      });
  }
}

async function applyClientSide(snapshot) {
  const reply = await dispatchToClient({
    tool: "_undo_apply",
    params: { snapshot_payload: snapshot.payload },
  });
  return {
    original_summary: snapshot.payload?.original_summary ?? snapshot.tool,
    data: reply.data ?? {},
  };
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      flatten(v, path, out);
    } else {
      out[path] = v;
    }
  }
  return out;
}
