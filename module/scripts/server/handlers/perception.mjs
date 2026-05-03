/**
 * Foundry Voice Control — perception tool handlers (server-side).
 *
 * Implements: describe_scene, get_scene_state, get_world_state.
 *
 * describe_scene and get_scene_state need both server-side data (always
 * available) and client-side canvas data (controlled / targeted tokens,
 * vision summary). When a GM is connected, server dispatches to the client
 * for the canvas-only fields and merges. When no GM is connected, server
 * returns the server-only portion with a warning rather than failing.
 */

import { CONTRACT_VERSION } from "../../shared/constants.mjs";
import { NotFoundError } from "../../shared/errors.mjs";
import { resolveByIdOrName } from "../../shared/resolver.mjs";
import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { dispatchToClient } from "../dispatcher.mjs";
import { isAnyGmConnected, listConnectedGms } from "../gm-presence.mjs";

export function registerPerceptionHandlers() {
  registerTool("describe_scene", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params, options }) {
      const scene = pickScene(params.scene);
      const focus = params.focus ?? "all";

      const tokens = Array.from(scene.tokens.values());
      const tokenCount = tokens.length;
      const hostileCount = tokens.filter((t) => t.disposition === -1).length;
      const allyCount = tokens.filter((t) => t.disposition === 1).length;
      const sceneNote = scene.navName ? ` ('${scene.navName}')` : "";

      // Headline — voice reads this verbatim.
      const summary =
        `Scene '${scene.name}'${sceneNote}: ${scene.width}x${scene.height} grid, ` +
        `${tokenCount} token${tokenCount === 1 ? "" : "s"}` +
        (hostileCount + allyCount > 0
          ? ` (${hostileCount} hostile, ${allyCount} allied)`
          : "") +
        `.`;

      let dispatchedToClient = false;
      let warnings = [];
      let canvasInfo = "";

      const wantsClient = focus !== "layout" && isAnyGmConnected();
      if (wantsClient) {
        try {
          const reply = await dispatchToClient({
            tool: "describe_scene",
            params: { focus, scene_id: scene.id },
            options,
          });
          dispatchedToClient = true;
          const c = reply.data ?? {};
          if (c.scene_mismatch) {
            warnings.push({
              code: "scene_mismatch",
              message: "Canvas-only fields omitted; the GM is viewing a different scene.",
            });
          } else {
            if (c.controlled_tokens?.length) {
              canvasInfo += ` ${c.controlled_tokens.length} token${c.controlled_tokens.length === 1 ? "" : "s"} currently controlled.`;
            }
            if (c.targeted_tokens?.length) {
              canvasInfo += ` ${c.targeted_tokens.length} target${c.targeted_tokens.length === 1 ? "" : "s"} set.`;
            }
          }
        } catch (err) {
          warnings.push({ code: "client_dispatch_failed", message: err.summary ?? String(err) });
        }
      } else if (focus !== "layout") {
        warnings.push({
          code: "no_gm_connected",
          message: "Canvas-only fields (controlled / targeted) omitted; no GM client connected.",
        });
      }

      // Multi-sentence description — what voice reads on "tell me more."
      const description = summary + canvasInfo;

      // Player-authored scene description, kept structurally separate per
      // the safety doc's untrusted-content rules.
      const userDescription = scene.description?.trim?.() ?? "";
      const untrusted = userDescription
        ? { untrusted: true, content: userDescription }
        : null;

      return {
        summary,
        data: {
          scene_id: scene.id,
          description,
          ...(untrusted ? { untrusted_description: untrusted } : {}),
        },
        warnings,
        dispatchedToClient,
      };
    },
  });

  registerTool("get_scene_state", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler({ params, options }) {
      const scene = pickScene(params.scene);

      const serverTokens = Array.from(scene.tokens.values()).map((td) => {
        const actor = td.actor;
        const hp = actor?.system?.attributes?.hp;
        const hpPct = hp && Number.isFinite(hp.value) && Number.isFinite(hp.max) && hp.max > 0
          ? Math.round((hp.value / hp.max) * 100)
          : null;
        const statuses = actor?.statuses ? Array.from(actor.statuses) : [];
        return {
          id: td.id,
          actor_id: actor?.id ?? null,
          name: td.name,
          x: td.x,
          y: td.y,
          disposition: td.disposition,
          hidden: !!td.hidden,
          hp_pct: hpPct,
          statuses,
        };
      });

      let dispatchedToClient = false;
      let canvasFields = null;
      let warnings = [];
      if (isAnyGmConnected()) {
        try {
          const reply = await dispatchToClient({
            tool: "get_scene_state",
            params: { scene_id: scene.id },
            options,
          });
          dispatchedToClient = true;
          const replyData = reply.data ?? {};
          if (replyData.scene_mismatch) {
            warnings.push({
              code: "scene_mismatch",
              message: "controlled / targeted state omitted; the GM is viewing a different scene.",
            });
          } else {
            canvasFields = replyData;
          }
        } catch (err) {
          warnings.push({ code: "client_dispatch_failed", message: err.summary ?? String(err) });
        }
      } else {
        warnings.push({
          code: "no_gm_connected",
          message: "controlled / targeted token state omitted; no GM client connected.",
        });
      }

      const merged = canvasFields
        ? mergeCanvasInfo(serverTokens, canvasFields)
        : serverTokens;

      const hostile = merged.filter((t) => t.disposition === -1).length;
      const ally = merged.filter((t) => t.disposition === 1).length;
      return {
        summary: `${merged.length} token${merged.length === 1 ? "" : "s"} on '${scene.name}'${hostile + ally > 0 ? `, ${hostile} hostile, ${ally} ally` : ""}.`,
        data: {
          scene_id: scene.id,
          tokens: merged,
          walls_summary: { count: scene.walls?.size ?? 0 },
          lighting_summary: {
            global_light: scene.environment?.globalLight ?? null,
            darkness: scene.environment?.darknessLevel ?? null,
          },
        },
        warnings,
        dispatchedToClient,
      };
    },
  });

  registerTool("get_world_state", {
    scope: SCOPES.READ,
    kind: "request",
    requireScope: (scopes) => requireScope(scopes, SCOPES.READ),
    async handler() {
      const active = game.scenes.active;
      const connectedUsers = game.users
        ? Array.from(game.users.values()).filter((u) => u.active).length
        : 0;
      const inCombat = !!game.combat?.combatants?.size;
      return {
        summary: `System ${game.system.id} v${game.system.version}; ${connectedUsers} user${connectedUsers === 1 ? "" : "s"} connected; active scene '${active?.name ?? "(none)"}'${inCombat ? "; combat in progress" : ""}.`,
        data: {
          system_id: game.system.id,
          system_version: game.system.version,
          contract_version: CONTRACT_VERSION,
          active_scene: active ? { id: active.id, name: active.name } : null,
          connected_users: connectedUsers,
          connected_gms: listConnectedGms(),
          in_combat: inCombat,
          foundry_version: globalThis.game?.version ?? null,
        },
      };
    },
  });
}

function pickScene(idOrName) {
  if (idOrName == null || idOrName === "") {
    const active = game.scenes.active;
    if (!active) throw new NotFoundError("active_scene", "(none)", []);
    return active;
  }
  const items = Array.from(game.scenes.values()).map((doc) => ({
    id: doc.id,
    name: doc.name,
    doc,
  }));
  const { match } = resolveByIdOrName({ items, query: String(idOrName), kind: "scene" });
  return match.doc;
}

function mergeCanvasInfo(serverTokens, canvasFields) {
  const controlled = new Set((canvasFields.controlled_token_ids ?? []).map(String));
  const targeted = new Set((canvasFields.targeted_token_ids ?? []).map(String));
  return serverTokens.map((t) => ({
    ...t,
    controlled: controlled.has(String(t.id)),
    targeted: targeted.has(String(t.id)),
  }));
}
