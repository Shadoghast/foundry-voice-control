/**
 * Foundry Voice Control — shared constants.
 *
 * Imported by both the client and server entry points. Anything that is a
 * compile-time constant and needs to stay in sync between the two sides lives
 * here.
 */

/** Module id — must match the `id` field in module.json. */
export const MODULE_ID = "foundry-voice-control";

/** Human-readable module name. */
export const MODULE_TITLE = "Foundry Voice Control";

/**
 * API contract version — exposed via get_world_state and used for client
 * compatibility checks. See docs/api-contract.md "Versioning".
 *
 * Increment major on breaking response-shape changes; minor on additions;
 * patch on bug fixes.
 */
export const CONTRACT_VERSION = "0.1.0";

/**
 * Foundry socket namespace for module dispatch.
 * See references/core-foundry-api.md "Module socket layer".
 */
export const SOCKET_NAMESPACE = `module.${MODULE_ID}`;

/**
 * Default dispatch timeout for client-side tool calls, in milliseconds.
 * See docs/safety-and-permissions.md "Transport".
 */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 5000;

/**
 * Hard cap on request body size, in bytes.
 * See docs/safety-and-permissions.md "Input validation".
 */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/**
 * Hard cap on JSON object depth in request bodies.
 * See docs/safety-and-permissions.md "Input validation".
 */
export const MAX_OBJECT_DEPTH = 16;
