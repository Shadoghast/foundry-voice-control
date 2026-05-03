/**
 * Foundry Voice Control — response envelope builders.
 *
 * Every tool returns a JSON envelope with exactly these shapes. Keep all
 * envelope construction here; never hand-roll a response object in a
 * handler. See docs/api-contract.md "Response envelope".
 *
 * Forbidden in either envelope: stack traces, file paths, secrets, raw
 * error.message strings (use the per-error summary instead).
 */

import { ApiError, ErrorCode, InternalError } from "./errors.mjs";

/** Allowed top-level fields in success responses. */
const SUCCESS_FIELDS = new Set([
  "ok",
  "summary",
  "data",
  "warnings",
  "request_id",
  "dispatched_to_client",
]);

/** Allowed top-level fields in error responses. */
const ERROR_FIELDS = new Set([
  "ok",
  "summary",
  "error",
  "request_id",
]);

/**
 * Build a success envelope. Any extra keys in `data` are passed through;
 * top-level fields outside SUCCESS_FIELDS are dropped to prevent accidental
 * leakage.
 */
export function successEnvelope({
  summary,
  data = {},
  warnings = [],
  requestId = null,
  dispatchedToClient = false,
}) {
  if (!summary || typeof summary !== "string") {
    throw new Error("successEnvelope requires a non-empty string summary");
  }
  return filterFields(
    {
      ok: true,
      summary,
      data,
      warnings,
      request_id: requestId,
      dispatched_to_client: dispatchedToClient,
    },
    SUCCESS_FIELDS,
  );
}

/**
 * Build an error envelope from an ApiError instance, or wrap any other
 * thrown value as an InternalError. The envelope never includes
 * stack traces or arbitrary error messages — only the curated summary
 * and structured details.
 */
export function errorEnvelope(thrown, requestId = null, correlationId = null) {
  let apiError;
  if (thrown instanceof ApiError) {
    apiError = thrown;
  } else {
    apiError = new InternalError(correlationId ?? "unknown");
  }

  const errorBody = {
    code: apiError.code,
    ...apiError.details,
  };

  return filterFields(
    {
      ok: false,
      summary: apiError.summary,
      error: errorBody,
      request_id: requestId,
    },
    ERROR_FIELDS,
  );
}

/** Strip any property not in the allowlist. Defensive; should be a no-op. */
function filterFields(obj, allowed) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** HTTP status code for a given envelope. */
export function statusCodeForEnvelope(envelope) {
  if (envelope.ok) return 200;
  switch (envelope.error?.code) {
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.AMBIGUOUS:
      return 409;
    case ErrorCode.VALIDATION:
      return 400;
    case ErrorCode.PERMISSION:
      return 403;
    case ErrorCode.GM_UNAVAILABLE:
      return 503;
    case ErrorCode.SYSTEM_UNSUPPORTED:
      return 501;
    case ErrorCode.TIMEOUT:
      return 504;
    case ErrorCode.RATE_LIMITED:
      return 429;
    case ErrorCode.INTERNAL:
    default:
      return 500;
  }
}
