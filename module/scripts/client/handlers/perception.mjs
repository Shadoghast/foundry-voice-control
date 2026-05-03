/**
 * Foundry Voice Control — perception client-side fields.
 *
 * Server-side describe_scene and get_scene_state dispatch HERE for the
 * canvas-only fields they can't compute themselves (controlled / targeted
 * / vision summary). Returns a small structured payload that the server
 * merges into the final response.
 */

import { whenCanvasReady } from "../canvas-helpers.mjs";
import { registerClientTool } from "../registry.mjs";

export function registerClientPerceptionHandlers() {
  registerClientTool("describe_scene", async ({ params }) => {
    await whenCanvasReady();
    const scene = canvas.scene;
    // If the GM happens to be viewing a different scene than what was
    // queried, return what's actually rendered — the server uses the
    // returned data only for canvas-derived fields.
    if (params.scene_id && scene?.id !== params.scene_id) {
      return {
        summary: "GM is viewing a different scene; canvas-only fields skipped.",
        data: { scene_mismatch: true, viewed_scene_id: scene?.id ?? null },
      };
    }

    const controlled = canvas.tokens?.controlled ?? [];
    const targeted = Array.from(game.user?.targets ?? []);
    const center = canvas.stage?.pivot
      ? { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y }
      : null;

    return {
      summary: `${controlled.length} controlled, ${targeted.length} targeted.`,
      data: {
        controlled_tokens: controlled.map((t) => ({ id: t.id, name: t.name })),
        targeted_tokens: targeted.map((t) => ({ id: t.id, name: t.name })),
        viewport_center: center,
        vision_summary: {
          // VERIFY: FogExploration / sight summary surface on v14.
          fog_exploration_active: !!canvas.fog?.active,
        },
      },
    };
  });

  registerClientTool("get_scene_state", async ({ params }) => {
    await whenCanvasReady();
    const scene = canvas.scene;
    if (params.scene_id && scene?.id !== params.scene_id) {
      return {
        summary: "GM viewing different scene; canvas fields skipped.",
        data: { scene_mismatch: true },
      };
    }

    const controlled = (canvas.tokens?.controlled ?? []).map((t) => t.id);
    const targeted = Array.from(game.user?.targets ?? []).map((t) => t.id);
    return {
      summary: `${controlled.length} controlled, ${targeted.length} targeted.`,
      data: {
        controlled_token_ids: controlled,
        targeted_token_ids: targeted,
      },
    };
  });
}
