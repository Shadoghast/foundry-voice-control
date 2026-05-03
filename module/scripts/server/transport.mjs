/**
 * Foundry Voice Control — transport guards.
 *
 * Everything between "request received" and "tool handler runs":
 *   - TLS check (reject plain HTTP)
 *   - Bearer-only auth extraction
 *   - IP allowlist
 *   - Failed-auth backoff
 *   - Body size and depth limits
 *   - Content-type check
 *
 * Each guard either returns a successfully-augmented context object or
 * throws an ApiError. The route handler catches and serializes via the
 * envelope builder.
 *
 * Express-style: each guard takes `(req, ctx)` and either mutates `ctx` or
 * throws. The route handler runs them in order then passes `ctx` to the
 * tool handler.
 */

import { MAX_OBJECT_DEPTH, MAX_REQUEST_BODY_BYTES } from "../shared/constants.mjs";
import { PermissionError, ValidationError } from "../shared/errors.mjs";
import { SETTING_KEYS, getSetting } from "./settings.mjs";
import {
  checkAuthBackoff,
  clearFailedAuth,
  recordFailedAuth,
} from "./rate-limiter.mjs";
import { isKeyStillActive, recordKeyUse, verifyBearer } from "./auth.mjs";
import { logger } from "./logger.mjs";

/**
 * Special sentinel error: caller should respond with 404 (not 401), so
 * unauthenticated scanners can't fingerprint the module. Per safety doc.
 */
export class StealthDenyError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "StealthDenyError";
    this.reason = reason;
  }
}

/**
 * Run all guards in order. Returns the populated context:
 *   { sourceIp, key: { id, scopes, ... }, body }
 * On guard failure, throws — see route handler for serialization.
 */
export async function runTransportGuards(req) {
  const ctx = { sourceIp: extractSourceIp(req) };

  requireTls(req);
  requireMethod(req);
  requireContentType(req);
  requireIpAllowed(req, ctx.sourceIp);
  requireAuthBackoff(ctx.sourceIp);

  const bearer = extractBearer(req);
  ctx.key = await authenticate(bearer, ctx.sourceIp);

  ctx.body = await readJsonBody(req);
  validateBodyShape(ctx.body);

  // Best-effort metadata update.
  await recordKeyUse(ctx.key.id, ctx.sourceIp);

  return ctx;
}

/** Reject plain HTTP. Honors X-Forwarded-Proto from a trusted proxy. */
function requireTls(req) {
  const xfp = (req.headers?.["x-forwarded-proto"] ?? "").toString().toLowerCase();
  if (xfp === "http") {
    throw new StealthDenyError("Plain HTTP via proxy is not allowed");
  }
  // If the connection itself is encrypted, accept regardless.
  if (req.connection?.encrypted || req.socket?.encrypted) return;
  if (xfp === "https") return;
  // Loopback (Foundry running on the same machine) gets a pass — useful for
  // local development. The check uses the *actual* peer address, NOT the
  // Host header (which is attacker-controlled). Common loopback addresses
  // include 127.0.0.1, ::1, and the IPv4-mapped form.
  const remote =
    req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? "";
  if (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1"
  ) {
    return;
  }
  throw new StealthDenyError("TLS required");
}

function requireMethod(req) {
  if (req.method && req.method !== "POST") {
    throw new ValidationError(`Method ${req.method} not supported. Use POST.`);
  }
}

function requireContentType(req) {
  const ct = (req.headers?.["content-type"] ?? "").toString().toLowerCase();
  if (!ct.startsWith("application/json")) {
    throw new ValidationError("Content-Type must be application/json.");
  }
}

function requireIpAllowed(req, sourceIp) {
  const allowlist = getSetting(SETTING_KEYS.IP_ALLOWLIST);
  if (!allowlist || allowlist.length === 0) return;
  if (allowlist.some((cidr) => ipMatchesCidr(sourceIp, cidr))) return;
  throw new StealthDenyError(`IP ${sourceIp} not in allowlist`);
}

function requireAuthBackoff(sourceIp) {
  const backoff = checkAuthBackoff(sourceIp);
  if (backoff) {
    throw new StealthDenyError(`IP in failed-auth backoff (${backoff.retryAfterMs}ms remaining)`);
  }
}

function extractBearer(req) {
  // Reject any auth scheme other than Bearer, and refuse cookie/query auth.
  const authHeader = req.headers?.authorization ?? "";
  if (req.headers?.cookie?.toLowerCase().includes("authorization")) {
    throw new StealthDenyError("Cookie-based auth refused");
  }
  if (!authHeader.startsWith("Bearer ")) {
    throw new StealthDenyError("Bearer header required");
  }
  return authHeader.slice("Bearer ".length).trim();
}

async function authenticate(bearer, sourceIp) {
  const matched = await verifyBearer(bearer);
  if (!matched) {
    recordFailedAuth(sourceIp);
    logger.warn({ msg: "Auth failed", source_ip: sourceIp });
    throw new StealthDenyError("Invalid bearer");
  }
  // Re-check after the await: the key may have been revoked while scrypt
  // was running. verifyBearer reads state at the start of its loop, so a
  // revocation arriving mid-hash would otherwise slip through.
  if (!isKeyStillActive(matched.id)) {
    recordFailedAuth(sourceIp);
    logger.warn({ msg: "Auth race: key revoked during verify", source_ip: sourceIp, key_id: matched.id });
    throw new StealthDenyError("Key revoked");
  }
  clearFailedAuth(sourceIp);
  return matched;
}

async function readJsonBody(req) {
  // If the body has already been parsed by Express middleware, use it.
  if (req.body && typeof req.body === "object") {
    const size = JSON.stringify(req.body).length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new ValidationError(`Body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    }
    return req.body;
  }

  // Otherwise stream and parse with size cap.
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_REQUEST_BODY_BYTES) {
      throw new ValidationError(`Body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ValidationError("Body is not valid JSON.");
  }
}

function validateBodyShape(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Body must be a JSON object.");
  }
  const depth = computeDepth(body);
  if (depth > MAX_OBJECT_DEPTH) {
    throw new ValidationError(`Body object depth ${depth} exceeds limit ${MAX_OBJECT_DEPTH}.`);
  }
  // Top-level fields allowed: params, options. Anything else is rejected.
  const allowed = new Set(["params", "options"]);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      throw new ValidationError(`Unknown top-level field '${k}'.`, { unknown_field: k });
    }
  }
}

function computeDepth(obj, current = 0) {
  if (obj === null || typeof obj !== "object") return current;
  let max = current;
  if (Array.isArray(obj)) {
    for (const v of obj) max = Math.max(max, computeDepth(v, current + 1));
  } else {
    for (const v of Object.values(obj)) max = Math.max(max, computeDepth(v, current + 1));
  }
  return max;
}

export function extractSourceIp(req) {
  // Prefer X-Forwarded-For if behind a trusted proxy; first entry is original client.
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) {
    return xff.toString().split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? "unknown";
}

/** Tiny CIDR matcher (IPv4-only for v1). */
function ipMatchesCidr(ip, cidr) {
  if (cidr === ip) return true;
  if (!cidr.includes("/")) return false;
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipNum = ipv4ToInt(ip);
  const baseNum = ipv4ToInt(base);
  if (ipNum === null || baseNum === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** Test-only export. */
export const _internal = {
  computeDepth,
  ipMatchesCidr,
  ipv4ToInt,
  validateBodyShape,
};
