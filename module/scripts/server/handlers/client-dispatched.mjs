/**
 * Foundry Voice Control — server-side wrappers for client-dispatched tools.
 *
 * Tools whose work happens in the GM's browser still need a server-side
 * entry point: routes.mjs registers HTTP handlers on this. The wrappers
 * are thin — they validate scope, dispatch, then capture an undo snapshot
 * from the client's reply data.
 */

import { SCOPES, requireScope } from "../auth.mjs";
import { registerTool } from "../routes.mjs";
import { dispatchToClient } from "../dispatcher.mjs";
import { recordUndo } from "../undo-store.mjs";

export function registerClientDispatchedHandlers() {
  // Scene-scope verbs.
  registerClientDispatch("select_tokens", {
    scope: SCOPES.SCENE,
    kind: "mutation",
    undoPayloadFromReply: (reply, params) => ({
      type: "select_tokens",
      previous_selection: reply.data?.previous_selection ?? [],
    }),
  });

  registerClientDispatch("deselect_tokens", {
    scope: SCOPES.SCENE,
    kind: "mutation",
    undoPayloadFromReply: (reply, params) => ({
      type: "deselect_tokens",
      previous_selection: reply.data?.previous_selection ?? [],
    }),
  });

  registerClientDispatch("target_tokens", {
    scope: SCOPES.SCENE,
    kind: "mutation",
    undoPayloadFromReply: (reply, params) => ({
      type: "target_tokens",
      previous_targets: reply.data?.previous_targets ?? [],
    }),
  });

  registerClientDispatch("untarget_tokens", {
    scope: SCOPES.SCENE,
    kind: "mutation",
    undoPayloadFromReply: (reply, params) => ({
      type: "untarget_tokens",
      previous_targets: reply.data?.previous_targets ?? [],
    }),
  });

  // Actor-write — placement.
  registerClientDispatch("place_token", {
    scope: SCOPES.ACTOR_WRITE,
    kind: "mutation",
    undoPayloadFromReply: (reply, params) => ({
      type: "place_token",
      scene_id: reply.data?.scene_id,
      token_id: reply.data?.token_id,
    }),
  });
}

function registerClientDispatch(toolName, { scope, kind, undoPayloadFromReply }) {
  registerTool(toolName, {
    scope,
    kind,
    requireScope: (scopes) => requireScope(scopes, scope),
    async handler({ params, options, ctx }) {
      const reply = await dispatchToClient({
        tool: toolName,
        params,
        options,
      });

      // Capture undo if the reply gave us enough to roll back.
      let undoToken = null;
      try {
        const payload = undoPayloadFromReply(reply, params);
        if (payload) {
          undoToken = recordUndo(ctx, {
            tool: toolName,
            scopeRequired: scope,
            clientRequired: true,
            payload,
          });
        }
      } catch {
        /* undo capture is best-effort */
      }

      return {
        summary: reply.summary || `${toolName} succeeded.`,
        data: { ...(reply.data ?? {}), undo_token: undoToken },
        dispatchedToClient: true,
      };
    },
  });
}
