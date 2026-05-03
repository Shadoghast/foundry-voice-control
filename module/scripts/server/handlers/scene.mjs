/**
 * Foundry Voice Control — scene tool handlers (server-side).
 *
 * Implements: activate_scene, list_scenes, get_active_scene.
 *
 * VERIFY: server-side `game.scenes` access. Modern Foundry exposes the
 * world's document collections to server-side code after world load, but
 * confirm at install. If not available, these need to dispatch to client.
 */

import { NotFoundError, ValidationError } from "../../shared/errors.mjs";
import { resolveByIdOrName, scoreItems } from "../../shared/resolver.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { recordUndo } from "../undo-store.mjs";

export function registerSceneHandlers() {
  registerTool("activate_scene", {
    scope: SCOPES.SCENE,
    kind: "mutation",
    requireScope: (scopes) => requireScope(scopes, SCOPES.SCENE),
    async handler({ params, ctx }) {
      assertParam(params, "scene");
      const items = sceneItems();
      const { match, matchedBy } = resolveByIdOrName({
        items,
        query: String(params.scene),
        kind: "scene",
      });
      const scene = match.doc;
      const previous = game.scenes.active;

      // No-op if already active — return success but flag in summary.
      if (previous?.id === scene.id) {
        return {
          summary: `Scene '${scene.name}' is already active.`,
          data: {
            scene: { id: scene.id, name: scene.name },
            previous_scene: { id: scene.id, name: scene.name },
            no_op: true,
          },
        };
      }

      await scene.activate();

      const undoToken = recordUndo(ctx, {
        tool: "activate_scene",
        scopeRequired: SCOPES.SCENE,
        clientRequired: false,
        payload: { type: "activate_scene", previous_scene_id: previous?.id ?? null },
      });

      const warnings = matchedBy === "fuzzy"
        ? [{ code: "fuzzy_match", message: `Matched query to '${scene.name}'.` }]
        : [];
      return {
        summary: `Activated scene '${scene.name}'.`,
        data: {
          scene: { id: scene.id, name: scene.name },
          previous_scene: previous ? { id: previous.id, name: previous.name } : null,
          undo_token: undoToken,
        },
        warnings,
      };
    },
  });

  registerTool("list_scenes", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params }) {
      const filter = typeof params.filter === "string" ? params.filter.trim() : "";
      const includeInactive = params.include_inactive !== false;
      const items = sceneItems().filter((s) => includeInactive || s.doc.active);

      let scenes;
      if (filter) {
        const scored = scoreItems(items, filter, 0.4);
        scenes = scored.map(({ item, score }) => ({
          id: item.id,
          name: item.name,
          thumb: item.doc.thumb ?? null,
          active: !!item.doc.active,
          score: Math.round(score * 100) / 100,
        }));
      } else {
        scenes = items
          .map(({ id, name, doc }) => ({
            id,
            name,
            thumb: doc.thumb ?? null,
            active: !!doc.active,
          }))
          .sort((a, b) => (b.active === a.active ? a.name.localeCompare(b.name) : b.active - a.active));
      }

      const total = items.length;
      const matchPart = filter ? `, ${scenes.length} match '${filter}'` : "";
      return {
        summary: `${total} scene${total === 1 ? "" : "s"} total${matchPart}.`,
        data: { scenes, total, filter: filter || null },
      };
    },
  });

  registerTool("get_active_scene", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler() {
      const scene = game.scenes.active;
      if (!scene) {
        throw new NotFoundError("active_scene", "(none)", []);
      }
      return {
        summary: `Active scene is '${scene.name}'.`,
        data: {
          scene: {
            id: scene.id,
            name: scene.name,
            grid: scene.grid?.toObject?.() ?? null,
            dimensions: { width: scene.width, height: scene.height },
          },
        },
      };
    },
  });
}

function sceneItems() {
  return Array.from(game.scenes.values()).map((doc) => ({
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
