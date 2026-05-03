/**
 * Foundry Voice Control — token tool handlers (client-side).
 *
 * Implements the four selection / targeting verbs plus place_token. These
 * all manipulate canvas state and therefore must run in the GM's browser.
 *
 * Throws shape-compatible Errors (with `code` and optional `details`) that
 * the client socket handler turns into reply envelopes.
 */

import { resolveByIdOrName } from "../../shared/resolver.mjs";
import { tokenResolverItems, whenCanvasReady } from "../canvas-helpers.mjs";
import { registerClientTool } from "../registry.mjs";

export function registerClientTokenHandlers() {
  registerClientTool("select_tokens", async ({ params }) => {
    return doSelectOrTarget(params, { mode: "select" });
  });

  registerClientTool("deselect_tokens", async ({ params }) => {
    await whenCanvasReady();
    const previousSelection = canvas.tokens.controlled.map((t) => t.id);
    if (Array.isArray(params.token_ids) && params.token_ids.length > 0) {
      let cleared = 0;
      for (const id of params.token_ids) {
        const tok = canvas.tokens.get(String(id));
        if (tok) {
          tok.release();
          cleared++;
        }
      }
      return {
        summary: `Deselected ${cleared} token${cleared === 1 ? "" : "s"}.`,
        data: { cleared, previous_selection: previousSelection },
      };
    }
    const before = canvas.tokens.controlled.length;
    canvas.tokens.releaseAll();
    return {
      summary: `Cleared selection (${before} token${before === 1 ? "" : "s"}).`,
      data: { cleared: before, previous_selection: previousSelection },
    };
  });

  registerClientTool("target_tokens", async ({ params }) => {
    return doSelectOrTarget(params, { mode: "target" });
  });

  registerClientTool("untarget_tokens", async ({ params }) => {
    await whenCanvasReady();
    const previousTargets = Array.from(game.user.targets).map((t) => t.id);
    if (Array.isArray(params.token_ids) && params.token_ids.length > 0) {
      let cleared = 0;
      for (const id of params.token_ids) {
        const tok = canvas.tokens.get(String(id));
        if (tok) {
          tok.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: false });
          cleared++;
        }
      }
      return {
        summary: `Untargeted ${cleared} token${cleared === 1 ? "" : "s"}.`,
        data: { cleared, previous_targets: previousTargets },
      };
    }
    const before = game.user.targets.size;
    game.user.updateTokenTargets([]);
    return {
      summary: `Cleared targets (${before}).`,
      data: { cleared: before, previous_targets: previousTargets },
    };
  });

  registerClientTool("place_token", async ({ params }) => {
    await whenCanvasReady();
    if (!params.actor) throw clientError("validation", "Missing 'actor'.");

    const actor = resolveActor(params.actor);
    let targetScene = canvas.scene;
    if (params.scene) {
      const item = resolveScene(params.scene);
      targetScene = item.doc;
      // Switch view if necessary so the canvas reflects the placement.
      if (canvas.scene?.id !== targetScene.id) {
        await targetScene.view();
        await whenCanvasReady();
      }
    }
    if (!targetScene) {
      throw clientError("validation", "No active scene; cannot place.");
    }

    const x = Number.isFinite(params.x) ? params.x : viewportCenterX();
    const y = Number.isFinite(params.y) ? params.y : viewportCenterY();
    const hidden = !!params.hidden;

    const protoData = (await actor.getTokenDocument({ x, y, hidden })).toObject();
    const [tokenDoc] = await targetScene.createEmbeddedDocuments("Token", [protoData]);

    return {
      summary: `Placed ${actor.name} on '${targetScene.name}'.`,
      data: {
        token_id: tokenDoc.id,
        actor_id: actor.id,
        scene_id: targetScene.id,
        x: tokenDoc.x,
        y: tokenDoc.y,
      },
    };
  });
}

// ---------- helpers ----------

async function doSelectOrTarget(params, { mode }) {
  await whenCanvasReady();
  const targets = Array.isArray(params.targets) ? params.targets : null;
  if (!targets || targets.length === 0) {
    throw clientError("validation", "'targets' must be a non-empty array.");
  }
  const additive = !!params.additive;

  // Capture pre-state for undo.
  const previousSelection = canvas.tokens.controlled.map((t) => t.id);
  const previousTargets = Array.from(game.user.targets).map((t) => t.id);

  const items = tokenResolverItems();
  const resolved = [];
  for (const t of targets) {
    if (typeof t !== "string") {
      throw clientError("validation", "Each target must be a string id_or_name in v1.");
    }
    const r = resolveByIdOrName({ items, query: t, kind: "token" });
    if (!resolved.find((x) => x.id === r.match.id)) {
      resolved.push(r.match);
    }
  }

  if (mode === "select") {
    let releaseOthers = !additive;
    let result = [];
    for (const r of resolved) {
      r._token.control({ releaseOthers });
      result.push({ token_id: r._token.id, actor_name: r._token.actor?.name ?? null });
      releaseOthers = false; // only the first one releases others
    }
    return {
      summary: `Selected ${result.length} token${result.length === 1 ? "" : "s"}: ${result.slice(0, 3).map((s) => s.actor_name ?? "(unnamed)").join(", ")}${result.length > 3 ? ` and ${result.length - 3} more` : ""}.`,
      data: { selected: result, previous_selection: previousSelection },
    };
  }
  // mode === "target"
  let releaseOthers = !additive;
  let result = [];
  for (const r of resolved) {
    r._token.setTarget(true, { user: game.user, releaseOthers });
    result.push({ token_id: r._token.id, actor_name: r._token.actor?.name ?? null });
    releaseOthers = false;
  }
  return {
    summary: `Targeting ${result.length} token${result.length === 1 ? "" : "s"}: ${result.slice(0, 3).map((s) => s.actor_name ?? "(unnamed)").join(", ")}${result.length > 3 ? ` and ${result.length - 3} more` : ""}.`,
    data: { targeted: result, previous_targets: previousTargets },
  };
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

function resolveScene(idOrName) {
  const items = Array.from(game.scenes.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  return resolveByIdOrName({ items, query: String(idOrName), kind: "scene" });
}

function viewportCenterX() {
  const v = canvas.stage?.position;
  if (!v) return 0;
  return Math.round((-v.x + window.innerWidth / 2) / canvas.stage.scale.x);
}
function viewportCenterY() {
  const v = canvas.stage?.position;
  if (!v) return 0;
  return Math.round((-v.y + window.innerHeight / 2) / canvas.stage.scale.y);
}

function clientError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.summary = message;
  err.details = details;
  return err;
}
