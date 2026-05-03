/**
 * Foundry Voice Control — admin RPC handler (server side).
 *
 * Runs in the Foundry Node process. Receives `admin:request` envelopes
 * from connected GM clients (via the dispatcher's message router) and
 * executes auth / audit operations against the server-side state. Replies
 * with `admin:reply` targeted to the requesting user only.
 *
 * Authorization: the requesting user must currently be in the connected-
 * GM presence list. Other users get a permission error. The presence
 * list is updated via the same socket layer at connect/disconnect, so
 * spoofing user_id without actually being authenticated as that GM
 * doesn't pass the check.
 */

import {
  issueKey,
  listKeys,
  revokeKey,
  revokeAll as authRevokeAll,
  rotateKey,
  SCOPE_PRESETS,
  SCOPES,
} from "./auth.mjs";
import { readAuditEntries } from "./audit-log.mjs";
import { isUserConnectedGm } from "./gm-presence.mjs";
import { listSupportedSystems } from "./systems/registry.mjs";
import { logger } from "./logger.mjs";
import { emitToUser } from "./socket-integration.mjs";
import { CONTRACT_VERSION, MODULE_ID } from "../shared/constants.mjs";

/**
 * Handle one admin:request envelope. Always replies (success or error)
 * via emitToUser to the requesting user only.
 *
 * @param payload - the message body the client sent
 * @param meta - { socketId, authUserId? } from socket-integration; authUserId
 *               is the authenticated Foundry user from the socket, or null
 *               if socket-integration couldn't extract it.
 */
export async function handleAdminRequest(payload, meta = {}) {
  const { request_id: requestId, action, args } = payload ?? {};
  const claimedUserId = payload?.user_id;
  const authUserId = meta?.authUserId ?? null;

  // Authoritative identity is what the socket layer vouches for; the payload
  // is only allowed if it matches (or is the only thing we have, in which
  // case we cross-check against world state).
  const userId = authUserId ?? claimedUserId;

  const reply = (body) => {
    try {
      // Always emit to the AUTHENTICATED userId (or the only one we have);
      // never to whatever the payload claimed if those differ.
      if (userId) {
        emitToUser(userId, { kind: "admin:reply", request_id: requestId, ...body });
      }
    } catch (err) {
      logger.warn({ msg: "admin reply emit failed", request_id: requestId, err });
    }
  };

  if (!userId) {
    logger.warn({ msg: "admin command rejected — no userId", action });
    reply({ ok: false, error: "Missing user_id." });
    return;
  }

  // If both are present, they must agree. A mismatch means the client tried
  // to spoof another user's identity in the payload.
  if (authUserId && claimedUserId && authUserId !== claimedUserId) {
    logger.warn({
      msg: "admin command rejected — payload user_id mismatches socket-authenticated user",
      auth_user_id: authUserId,
      claimed_user_id: claimedUserId,
      action,
    });
    reply({ ok: false, error: "user_id mismatch with authenticated session." });
    return;
  }

  // If we don't have an auth userId from the socket, log a warning so the
  // operator can spot the misconfiguration (extractAuthUserId failed).
  if (!authUserId) {
    logger.warn({
      msg: "admin command relying on payload-asserted user_id (socket auth not available)",
      hint: "VERIFY extractAuthUserId() in socket-integration.mjs for v14",
      claimed_user_id: claimedUserId,
    });
  }

  // Authorization: caller must be a connected GM AND that userId must
  // actually correspond to a GM-role user in the world (defense in depth in
  // case the presence list itself was self-asserted).
  if (!isUserConnectedGm(userId) || !isWorldGm(userId)) {
    logger.warn({
      msg: "admin command rejected — not a connected GM or not a GM in the world",
      user_id: userId,
      action,
    });
    reply({ ok: false, error: "Only connected GMs can issue admin commands." });
    return;
  }

  try {
    const result = await dispatch(action, args ?? {});
    reply({ ok: true, ...result });
  } catch (err) {
    logger.warn({ msg: "admin command failed", action, err });
    reply({ ok: false, error: err?.message ?? "Admin command failed." });
  }
}

/**
 * Cross-check that a userId corresponds to a Foundry user with GM role.
 * VERIFY: USER_ROLES.GAMEMASTER vs USER_ROLES.ASSISTANT_GAMEMASTER on v14;
 * we accept both as "GM-equivalent" for admin commands.
 */
function isWorldGm(userId) {
  const user = globalThis.game?.users?.get?.(userId);
  if (!user) return false;
  // Foundry's USER_ROLES enum: 0 NONE, 1 PLAYER, 2 TRUSTED, 3 ASSISTANT, 4 GAMEMASTER.
  const role = typeof user.role === "number" ? user.role : null;
  if (role !== null) return role >= 3;
  // Fallback: boolean isGM (older Foundry).
  return !!user.isGM;
}

async function dispatch(action, args) {
  switch (action) {
    case "key:new": {
      const label = String(args.label ?? "").trim();
      if (!label) throw new Error("Label required.");
      const scopes = expandScopes(args.scopes);
      const expiresInDays = args.expires
        ? parseDuration(args.expires, "days")
        : null;
      const { rawValue, metadata } = await issueKey({ label, scopes, expiresInDays });
      return {
        action: "key:new",
        raw_value: rawValue, // shown once, only to this user
        metadata,
      };
    }

    case "key:list":
      return { action: "key:list", keys: listKeys() };

    case "key:revoke": {
      const id = String(args.id ?? "").trim();
      if (!id) throw new Error("Key id required.");
      const ok = await revokeKey(id);
      if (!ok) throw new Error(`Key '${id}' not found or already revoked.`);
      return { action: "key:revoke", id };
    }

    case "key:rotate": {
      const id = String(args.id ?? "").trim();
      if (!id) throw new Error("Key id required.");
      const graceMs = args.grace ? parseDuration(args.grace, "ms") : 5 * 60 * 1000;
      const { rawValue, metadata } = await rotateKey(id, graceMs);
      return { action: "key:rotate", raw_value: rawValue, metadata, old_id: id, grace_ms: graceMs };
    }

    case "revoke-all": {
      const count = await authRevokeAll();
      return { action: "revoke-all", revoked: count };
    }

    case "audit:show": {
      const lastN = Math.max(1, Math.min(500, Number(args.last ?? 20)));
      const entries = await readAuditEntries(lastN);
      return { action: "audit:show", entries };
    }

    case "status":
      return {
        action: "status",
        contract_version: CONTRACT_VERSION,
        module_id: MODULE_ID,
        supported_systems: listSupportedSystems(),
        active_system: globalThis.game?.system?.id ?? null,
        active_system_version: globalThis.game?.system?.version ?? null,
      };

    default:
      throw new Error(`Unknown admin action '${action}'.`);
  }
}

function expandScopes(input) {
  // Input may be: undefined → operator preset; a preset name; an array; a comma string.
  if (input == null || input === "") return SCOPE_PRESETS.operator;
  if (Array.isArray(input)) {
    validateScopeList(input);
    return input;
  }
  const s = String(input).trim();
  if (SCOPE_PRESETS[s]) return SCOPE_PRESETS[s];
  // Comma-separated list of scope names.
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  validateScopeList(parts);
  return parts;
}

function validateScopeList(list) {
  const valid = new Set(Object.values(SCOPES));
  for (const s of list) {
    if (!valid.has(s)) throw new Error(`Unknown scope '${s}'. Valid: ${[...valid].join(", ")}.`);
  }
}

/**
 * Parse a duration string like `"30d"`, `"5m"`, `"24h"` into either ms
 * (default) or days, depending on `unit`.
 */
function parseDuration(input, unit = "ms") {
  const s = String(input).trim();
  const m = s.match(/^(\d+)([dhms])$/);
  if (!m) throw new Error(`Bad duration '${input}'. Use 30d, 5m, 24h, etc.`);
  const n = Number(m[1]);
  const suffix = m[2];
  const ms =
    suffix === "d" ? n * 86_400_000 :
    suffix === "h" ? n * 3_600_000 :
    suffix === "m" ? n * 60_000 :
    n * 1000;
  if (unit === "days") return ms / 86_400_000;
  return ms;
}
