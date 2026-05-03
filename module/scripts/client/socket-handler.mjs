/**
 * Foundry Voice Control — client-side socket handler.
 *
 * Receives `dispatch` envelopes from the server, routes to the matching
 * handler in the client registry, and replies with the result. Also
 * announces presence on `ready` (for the GM client only — non-GMs ignore
 * dispatches).
 */

import { MODULE_ID, SOCKET_NAMESPACE } from "../shared/constants.mjs";
import { getClientTool, registerClientTool } from "./registry.mjs";
import { registerAllClientHandlers } from "./handlers/index.mjs";
import { handleAdminReply } from "./admin-rpc.mjs";

let initialized = false;

/**
 * Wire up the client-side socket handler. Idempotent.
 */
export function initClientSocket() {
  if (initialized) return;
  initialized = true;

  registerStubs();
  registerAllClientHandlers();

  // Listen for envelopes from the server.
  game.socket.on(SOCKET_NAMESPACE, async (payload, meta) => {
    if (!payload || typeof payload !== "object") return;

    // admin:reply is delivered to the requesting GM regardless of the
    // dispatch GM-only filter below.
    if (payload.kind === "admin:reply") {
      handleAdminReply(payload);
      return;
    }

    if (payload.kind !== "dispatch") return;

    // Only the GM client services dispatches. Non-GM clients silently
    // ignore — the server's pickGm() will route to the right one.
    if (!game.user.isGM) return;

    const reply = await runDispatched(payload);
    try {
      game.socket.emit(SOCKET_NAMESPACE, reply);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to emit reply`, err);
    }
  });

  // Announce presence — only GM clients matter for dispatch.
  if (game.user.isGM) {
    sendPresenceOnline();
    // Best-effort offline announcement on tab close.
    window.addEventListener("beforeunload", () => {
      try {
        game.socket.emit(SOCKET_NAMESPACE, {
          kind: "presence:offline",
          user_id: game.user.id,
        });
      } catch {
        /* unload is racy; ignore */
      }
    });
  }
}

function sendPresenceOnline() {
  try {
    game.socket.emit(SOCKET_NAMESPACE, {
      kind: "presence:online",
      user_id: game.user.id,
      user_name: game.user.name,
    });
    console.log(`${MODULE_ID} | presence: online (GM ${game.user.name})`);
  } catch (err) {
    console.error(`${MODULE_ID} | presence announce failed`, err);
  }
}

async function runDispatched(payload) {
  const { dispatch_id: dispatchId, tool, params = {}, options = {} } = payload;

  const handler = getClientTool(tool);
  if (!handler) {
    return {
      kind: "reply",
      dispatch_id: dispatchId,
      ok: false,
      summary: `Unknown client tool '${tool}'.`,
      error: { code: "internal", reason: "client-handler-missing", tool_name: tool },
    };
  }

  try {
    const result = await handler({ params, options });
    return {
      kind: "reply",
      dispatch_id: dispatchId,
      ok: true,
      summary: result?.summary ?? "",
      data: result?.data ?? {},
    };
  } catch (err) {
    // Client-side handlers should throw with a `code` and optional `details`.
    return {
      kind: "reply",
      dispatch_id: dispatchId,
      ok: false,
      summary: err?.summary ?? err?.message ?? "Client handler failed.",
      error: {
        code: err?.code ?? "internal",
        ...(err?.details ?? {}),
      },
    };
  }
}

/** Sub-stage 3c stub: client-side ping. Real handlers register in 3d. */
function registerStubs() {
  registerClientTool("_ping_client", async ({ params }) => {
    return {
      summary: "Client responded to ping.",
      data: {
        echoed: params,
        canvas_ready: !!canvas?.ready,
        active_scene_id: canvas?.scene?.id ?? null,
        user_id: game.user.id,
        user_name: game.user.name,
        is_gm: game.user.isGM,
      },
    };
  });
}
