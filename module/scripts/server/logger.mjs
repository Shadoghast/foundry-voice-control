/**
 * Foundry Voice Control — log redaction.
 *
 * One thin wrapper around console for structured server-side logging.
 * Redacts the fields explicitly named in docs/safety-and-permissions.md
 * "Logging": Authorization headers, params.patch, params.system, and
 * credentialed image URLs. Redaction is enforced at the writer, not by
 * convention — callers pass the full request shape and trust the logger
 * to scrub.
 *
 * Use:
 *   logger.info({ tool, request_id, source_ip, msg: "..." })
 *   logger.warn({ ..., headers: req.headers })  // headers auto-redacted
 *   logger.error({ ..., err: someError, correlation_id: "..." })
 */

import { MODULE_ID } from "../shared/constants.mjs";

const REDACTED = "[REDACTED]";
const URL_CRED_RE = /\/\/[^/@]+@/g;

/** Recursively redact known-sensitive paths in an object. */
function redact(obj, depth = 0) {
  if (depth > 20 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const kLower = k.toLowerCase();
    if (kLower === "authorization" || kLower === "cookie") {
      out[k] = REDACTED;
    } else if (k === "patch" || k === "system" || k === "items") {
      // Patch payloads can include actor flags users have stuffed secrets into;
      // system payloads can be large; items can contain large embedded data.
      out[k] = REDACTED;
    } else if (kLower === "image" && typeof v === "string") {
      out[k] = redactUrlCredentials(v);
    } else if (typeof v === "object") {
      out[k] = redact(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Redact `https://user:pass@host/path` → `https://[REDACTED]@host/path`. */
function redactUrlCredentials(s) {
  return s.replace(URL_CRED_RE, `//${REDACTED}@`);
}

function format(level, payload) {
  const timestamp = new Date().toISOString();
  const safe = redact(payload);
  return `${timestamp} ${MODULE_ID} ${level} ${JSON.stringify(safe)}`;
}

export const logger = {
  info(payload) {
    console.log(format("INFO", payload));
  },
  warn(payload) {
    console.warn(format("WARN", payload));
  },
  error(payload) {
    // Strip any error stack before logging; we keep the message but not the trace.
    const { err, ...rest } = payload ?? {};
    const errMsg = err instanceof Error ? err.message : err;
    console.error(format("ERROR", { ...rest, err: errMsg }));
  },
};

/** Exposed for unit tests. */
export const _internal = { redact, redactUrlCredentials };
