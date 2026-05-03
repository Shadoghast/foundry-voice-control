/**
 * Foundry Voice Control — client-side undo applicator.
 *
 * Receives a snapshot payload from the server and reverses the change on
 * the canvas / live game state. Mirror of applyServerSide() in
 * server/handlers/undo.mjs but for client-only operations.
 */

import { whenCanvasReady } from "../canvas-helpers.mjs";
import { registerClientTool } from "../registry.mjs";

export function registerClientUndoHandler() {
  registerClientTool("_undo_apply", async ({ params }) => {
    await whenCanvasReady();
    const payload = params.snapshot_payload;
    if (!payload || typeof payload !== "object") {
      throw clientError("validation", "Missing snapshot_payload.");
    }

    switch (payload.type) {
      case "place_token": {
        const scene = game.scenes.get(payload.scene_id);
        if (!scene) throw clientError("not_found", "Scene not found for undo.");
        const tokenDoc = scene.tokens.get(payload.token_id);
        if (!tokenDoc) {
          // Token already gone — undo is a no-op. Surface so the caller
          // doesn't think an action happened.
          return {
            summary: "place_token",
            data: {
              token_id: payload.token_id,
              scene_id: payload.scene_id,
              already_gone: true,
            },
          };
        }
        await scene.deleteEmbeddedDocuments("Token", [payload.token_id]);
        return {
          summary: "place_token",
          data: { token_id: payload.token_id, scene_id: payload.scene_id },
        };
      }

      case "select_tokens": {
        // Restore prior selection by id list. Tokens that no longer exist
        // are silently skipped.
        canvas.tokens.releaseAll();
        for (const id of payload.previous_selection ?? []) {
          const tok = canvas.tokens.get(String(id));
          if (tok) tok.control({ releaseOthers: false });
        }
        return {
          summary: "select_tokens",
          data: { restored_count: payload.previous_selection?.length ?? 0 },
        };
      }

      case "deselect_tokens": {
        canvas.tokens.releaseAll();
        for (const id of payload.previous_selection ?? []) {
          const tok = canvas.tokens.get(String(id));
          if (tok) tok.control({ releaseOthers: false });
        }
        return {
          summary: "deselect_tokens",
          data: { restored_count: payload.previous_selection?.length ?? 0 },
        };
      }

      case "target_tokens": {
        game.user.updateTokenTargets([]);
        const ids = (payload.previous_targets ?? [])
          .map((id) => canvas.tokens.get(String(id)))
          .filter(Boolean)
          .map((t) => t.id);
        game.user.updateTokenTargets(ids);
        return {
          summary: "target_tokens",
          data: { restored_count: ids.length },
        };
      }

      case "untarget_tokens": {
        game.user.updateTokenTargets([]);
        const ids = (payload.previous_targets ?? [])
          .map((id) => canvas.tokens.get(String(id)))
          .filter(Boolean)
          .map((t) => t.id);
        game.user.updateTokenTargets(ids);
        return {
          summary: "untarget_tokens",
          data: { restored_count: ids.length },
        };
      }

      default:
        throw clientError("internal", `Unknown client undo type '${payload.type}'.`);
    }
  });
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
