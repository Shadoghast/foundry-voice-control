/**
 * Foundry Voice Control — error codes and ApiError class.
 *
 * One frozen enum + one error class hierarchy used by every handler. The
 * envelope builder turns these into the public response shape; the logger
 * captures the internal detail. Keep error subclasses thin — extra context
 * lives on `details`, not as ad-hoc properties.
 *
 * See docs/api-contract.md "Error codes" for the public surface.
 */

/** Public error codes. Mirrors api-contract.md exactly. */
export const ErrorCode = Object.freeze({
  NOT_FOUND: "not_found",
  AMBIGUOUS: "ambiguous",
  VALIDATION: "validation",
  PERMISSION: "permission",
  GM_UNAVAILABLE: "gm_unavailable",
  SYSTEM_UNSUPPORTED: "system_unsupported",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate_limited",
  INTERNAL: "internal",
});

/** All error codes that produce an HTTP 4xx; everything else is 5xx (internal). */
const CLIENT_ERRORS = new Set([
  ErrorCode.NOT_FOUND,
  ErrorCode.AMBIGUOUS,
  ErrorCode.VALIDATION,
  ErrorCode.PERMISSION,
  ErrorCode.GM_UNAVAILABLE,
  ErrorCode.SYSTEM_UNSUPPORTED,
  ErrorCode.TIMEOUT,
  ErrorCode.RATE_LIMITED,
]);

/**
 * Base error type. Throw any subclass from a handler — the route wrapper
 * catches it and serializes via the envelope builder.
 *
 * @param {string} code - one of ErrorCode.*
 * @param {string} summary - one-sentence voice-readable message
 * @param {object} [details] - structured machine fields
 */
export class ApiError extends Error {
  constructor(code, summary, details = {}) {
    super(summary);
    this.name = "ApiError";
    this.code = code;
    this.summary = summary;
    this.details = details;
  }

  isClientError() {
    return CLIENT_ERRORS.has(this.code);
  }
}

export class NotFoundError extends ApiError {
  constructor(kind, query, suggestions = []) {
    super(
      ErrorCode.NOT_FOUND,
      `I couldn't find ${kind} '${query}'.${suggestions.length ? ` Did you mean '${suggestions[0].name}'?` : ""}`,
      { kind, query, suggestions },
    );
  }
}

export class AmbiguousError extends ApiError {
  constructor(kind, query, candidates) {
    const top = candidates.slice(0, 2).map((c) => `'${c.name}'`).join(" and ");
    const noun = candidates.length === 1 ? "match" : "matches";
    super(
      ErrorCode.AMBIGUOUS,
      `Found ${candidates.length} ${noun}. Top: ${top}. Which one?`,
      { kind, query, candidates },
    );
  }
}

export class ValidationError extends ApiError {
  constructor(message, details = {}) {
    super(ErrorCode.VALIDATION, message, details);
  }
}

export class PermissionError extends ApiError {
  constructor(requiredScope, keyScopes) {
    super(
      ErrorCode.PERMISSION,
      `This key doesn't have permission for that. Need ${requiredScope}.`,
      { required_scope: requiredScope, key_scopes: keyScopes },
    );
  }
}

export class GmUnavailableError extends ApiError {
  constructor(toolName) {
    super(
      ErrorCode.GM_UNAVAILABLE,
      "No GM client is connected. Open the world in Chrome.",
      { tool_name: toolName },
    );
  }
}

export class SystemUnsupportedError extends ApiError {
  constructor(toolName, activeSystem, supportedSystems) {
    super(
      ErrorCode.SYSTEM_UNSUPPORTED,
      `I don't have ${activeSystem} support yet — I do ${supportedSystems.join(", ")}.`,
      { tool_name: toolName, active_system: activeSystem, supported_systems: supportedSystems },
    );
  }
}

export class TimeoutError extends ApiError {
  constructor(toolName, timeoutMs) {
    super(
      ErrorCode.TIMEOUT,
      "That took too long. Try again, or check the GM client.",
      { tool_name: toolName, timeout_ms: timeoutMs },
    );
  }
}

export class RateLimitedError extends ApiError {
  constructor(reason, retryAfterMs) {
    super(
      ErrorCode.RATE_LIMITED,
      `Rate limit reached. Try again in a moment.`,
      { reason, retry_after_ms: retryAfterMs },
    );
  }
}

export class InternalError extends ApiError {
  constructor(correlationId) {
    super(
      ErrorCode.INTERNAL,
      `Something broke on the server. Reference id ${correlationId}.`,
      { correlation_id: correlationId },
    );
  }
}
