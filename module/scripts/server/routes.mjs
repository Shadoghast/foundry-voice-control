/**
 * Foundry Voice Control — route registration and request orchestration.
 *
 * Connects the Express app to the transport guards and dispatches to tool
 * handlers. Sub-stage 3b only ships two stub routes — `_health` and `_echo`
 * — to prove the auth + transport chain end-to-end. Real tool dispatch
 * lands in 3c (the dispatcher) and 3d (handlers).
 *
 * VERIFY: how the Foundry v14 server exposes its Express app. The pattern
 * below tries the most likely globals in priority order and logs a clear
 * failure if none works. Fix `findExpressApp` for v14 once confirmed.
 */

import * as crypto from "node:crypto";

import { MODULE_ID, CONTRACT_VERSION } from "../shared/constants.mjs";
import {
  errorEnvelope,
  statusCodeForEnvelope,
  successEnvelope,
} from "../shared/envelope.mjs";
import { ApiError, RateLimitedError, ValidationError } from "../shared/errors.mjs";
import { logger } from "./logger.mjs";
import { recordAuditEntry } from "./audit-log.mjs";
import { checkKeyRateLimit } from "./rate-limiter.mjs";
import { extractSourceIp, runTransportGuards, StealthDenyError } from "./transport.mjs";
import { dispatchToClient } from "./dispatcher.mjs";
import { isAnyGmConnected, listConnectedGms } from "./gm-presence.mjs";

/** Map from tool name → { handler, scope, kind, system_gated }. */
const TOOL_REGISTRY = new Map();

/**
 * Register a tool handler. Handlers are added by sub-stage 3c+ as they're
 * implemented; for 3b we register only the two stubs below.
 */
export function registerTool(name, descriptor) {
  if (TOOL_REGISTRY.has(name)) {
    throw new Error(`Tool '${name}' already registered`);
  }
  TOOL_REGISTRY.set(name, descriptor);
}

/** Public: get a registered tool descriptor. */
export function getTool(name) {
  return TOOL_REGISTRY.get(name);
}

/**
 * Register routes on the Express app. Returns true if successful, false
 * (with a logged warning) if the Express app couldn't be located.
 */
export function registerRoutes() {
  const app = findExpressApp();
  if (!app) {
    logger.error({
      msg: "Could not locate Foundry's Express app — module routes NOT registered.",
      hint: "Update findExpressApp() in routes.mjs to match v14's actual export.",
    });
    return false;
  }

  // POST /modules/foundry-voice-control/api/:tool — single entry point for all tools.
  app.post(`/modules/${MODULE_ID}/api/:tool`, makeApiHandler());

  // OPTIONS for any of our routes returns 405 — no CORS preflight.
  app.options(`/modules/${MODULE_ID}/api/*`, (req, res) => {
    res.status(405).set("Allow", "POST").end();
  });

  // Register the stub tools.
  registerStubs();

  logger.info({ msg: "Routes registered", base: `/modules/${MODULE_ID}/api/` });
  return true;
}

function makeApiHandler() {
  return async (req, res) => {
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomBytes(6).toString("hex");
    const toolName = req.params?.tool ?? "";

    // Populate source_ip BEFORE guards run so stealth-denied requests
    // (failed TLS, bad bearer, IP allowlist mismatch) still produce a useful
    // audit entry rather than a row with empty key_id and source_ip.
    const sourceIp = extractSourceIp(req);

    let auditEntry = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      success: false,
      request_id: requestId,
      source_ip: sourceIp,
    };

    try {
      // Run guards. They populate `ctx`, or throw.
      const ctx = await runTransportGuards(req);
      auditEntry.key_id = ctx.key.id;
      auditEntry.source_ip = ctx.sourceIp;

      // Look up the tool.
      const tool = TOOL_REGISTRY.get(toolName);
      if (!tool) {
        throw new ValidationError(`Unknown tool '${toolName}'.`);
      }

      // Scope check happens inside the handler descriptor.
      tool.requireScope(ctx.key.scopes);
      auditEntry.scope_used = tool.scope;

      // Rate limit by tool kind.
      const rateCheck = checkKeyRateLimit(ctx.key.id, tool.kind);
      if (!rateCheck.allowed) {
        // The `finally` block records the audit entry — don't double-record.
        // success: false is already the default.
        res
          .status(429)
          .set("Retry-After", String(Math.ceil(rateCheck.retryAfterMs / 1000)))
          .json(
            errorEnvelope(
              new RateLimitedError(rateCheck.reason, rateCheck.retryAfterMs),
              requestId,
              correlationId,
            ),
          );
        return;
      }

      // Dispatch.
      const result = await tool.handler({
        params: ctx.body.params ?? {},
        options: ctx.body.options ?? {},
        ctx,
        requestId,
      });

      // Handlers may override `scope_used` for the audit log via
      // `result.auditScope` — used by tools whose effective scope is
      // dynamic (e.g., `undo` checks against the snapshot's required
      // scope rather than its descriptor's static value). The field is
      // consumed here and explicitly DELETED so it cannot leak into the
      // response if a handler ever returns a complete envelope rather
      // than the partial spec form (the partial form is filtered by
      // successEnvelope's allowlist; the complete form is not).
      if (result && typeof result.auditScope === "string") {
        auditEntry.scope_used = result.auditScope;
        delete result.auditScope;
      }

      // Wrap into envelope (handlers may return either a partial spec or a
      // complete envelope; normalize here).
      const envelope = result?.ok !== undefined
        ? result
        : successEnvelope({
            summary: result.summary,
            data: result.data ?? {},
            warnings: result.warnings ?? [],
            requestId,
            dispatchedToClient: result.dispatchedToClient ?? false,
          });

      auditEntry.success = envelope.ok === true;
      res.status(statusCodeForEnvelope(envelope)).json(envelope);
    } catch (err) {
      if (err instanceof StealthDenyError) {
        // Per safety doc: 404 for unauthenticated/unknown so scanners can't
        // fingerprint. Don't update audit entry with details — just log.
        logger.warn({
          msg: "Stealth-deny",
          reason: err.reason,
          source_ip: auditEntry.source_ip ?? "unknown",
          tool: toolName,
        });
        res.status(404).end();
        return;
      }

      const apiErr = err instanceof ApiError ? err : null;
      const envelope = errorEnvelope(apiErr ?? err, requestId, correlationId);
      if (!apiErr) {
        logger.error({
          msg: "Unhandled error in tool handler",
          tool: toolName,
          correlation_id: correlationId,
          err,
        });
      }
      res.status(statusCodeForEnvelope(envelope)).json(envelope);
    } finally {
      // Always write the audit entry, even on failure.
      try {
        await recordAuditEntry(auditEntry);
      } catch {
        /* logged elsewhere */
      }
    }
  };
}

/** Sub-stage 3b/3c stub tools. */
function registerStubs() {
  registerTool("_health", {
    scope: "read",
    kind: "request",
    requireScope: () => {
      /* health is always callable by any valid key */
    },
    async handler({ requestId }) {
      return {
        summary: "Module is alive.",
        data: {
          contract_version: CONTRACT_VERSION,
          module_id: MODULE_ID,
          server_time: new Date().toISOString(),
          gm_connected: isAnyGmConnected(),
          connected_gms: listConnectedGms(),
        },
      };
    },
  });

  registerTool("_echo", {
    scope: "read",
    kind: "request",
    requireScope: (scopes) => {
      const ok = scopes.includes("read") || scopes.includes("gm");
      if (!ok) {
        throw new ApiError("permission", "_echo requires read scope.", {
          required_scope: "read",
          key_scopes: scopes,
        });
      }
    },
    async handler({ params, ctx }) {
      return {
        summary: `Echoed ${Object.keys(params).length} param(s).`,
        data: {
          echoed_params: params,
          key_id: ctx.key.id,
          key_scopes: ctx.key.scopes,
          source_ip: ctx.sourceIp,
        },
      };
    },
  });

  // Sub-stage 3c stub: server-side ping that exercises the full dispatch
  // chain — server → socket → GM client → handler → reply → server. Returns
  // the client's data plus a "dispatched_to_client: true" flag in the
  // envelope so callers can confirm the round-trip happened.
  registerTool("_ping_client", {
    scope: "read",
    kind: "request",
    requireScope: (scopes) => {
      const ok = scopes.includes("read") || scopes.includes("gm");
      if (!ok) {
        throw new ApiError("permission", "_ping_client requires read scope.", {
          required_scope: "read",
          key_scopes: scopes,
        });
      }
    },
    async handler({ params, options }) {
      const reply = await dispatchToClient({
        tool: "_ping_client",
        params,
        options,
      });
      return {
        summary: reply.summary || "Round-trip succeeded.",
        data: reply.data,
        dispatchedToClient: true,
      };
    },
  });
}

/**
 * Try the most likely v14 globals for the Express app. Update for the
 * actual v14 export when known.
 */
function findExpressApp() {
  if (globalThis.express?.app) return globalThis.express.app;
  if (globalThis.serverApp) return globalThis.serverApp;
  if (globalThis.foundry?.server?.app) return globalThis.foundry.server.app;
  if (globalThis.app && typeof globalThis.app.post === "function") return globalThis.app;
  return null;
}

/** Test-only access to the registry. */
export function _resetForTests() {
  TOOL_REGISTRY.clear();
}
export function _toolsForTests() {
  return new Map(TOOL_REGISTRY);
}
