/**
 * Foundry Voice Control — rate limiter.
 *
 * In-memory token-bucket-ish per-key request counter, plus per-IP
 * failed-auth backoff. Limits per docs/safety-and-permissions.md
 * "Abuse and rate limits".
 *
 * Per key:
 *   - 60 total requests / minute
 *   - 10 mutations / minute
 *   - 5 destructive (delete + bulk update) / minute
 *
 * Per source IP:
 *   - 30 failed-auth attempts / hour, then exponential backoff
 *
 * Limits are read from settings, so a power user can adjust at runtime.
 */

import { SETTING_KEYS, getSetting } from "./settings.mjs";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const FAILED_AUTH_LIMIT = 30;
const FAILED_AUTH_WINDOW_MS = HOUR_MS;
const FAILED_AUTH_BASE_BACKOFF_MS = 30 * 1000;
const FAILED_AUTH_MAX_BACKOFF_MS = 30 * 60 * 1000;

/** Per-key bucket. Resets on minute window roll. */
const keyBuckets = new Map();
/** Per-IP failed-auth tracking. */
const failedAuth = new Map();

/**
 * Check whether a request from `keyId` is allowed.
 * `kind` is one of "request" | "mutation" | "destructive".
 * Returns { allowed: true } or { allowed: false, retryAfterMs, reason }.
 */
export function checkKeyRateLimit(keyId, kind) {
  const now = Date.now();
  const bucket = ensureBucket(keyId, now);

  const limits = readLimits();
  const bumps = ["request"];
  if (kind === "mutation" || kind === "destructive") bumps.push("mutation");
  if (kind === "destructive") bumps.push("destructive");

  for (const k of bumps) {
    const limit = limits[k];
    if (bucket[k] >= limit) {
      return {
        allowed: false,
        retryAfterMs: bucket.windowEndsAt - now,
        reason: `Per-key ${k} limit (${limit}/min) exceeded`,
      };
    }
  }

  for (const k of bumps) bucket[k]++;
  return { allowed: true };
}

/** Record a failed-auth attempt from `sourceIp`. */
export function recordFailedAuth(sourceIp) {
  const now = Date.now();
  const entry = failedAuth.get(sourceIp) ?? { count: 0, lastFailureAt: 0, windowStartedAt: now };
  if (now - entry.windowStartedAt > FAILED_AUTH_WINDOW_MS) {
    entry.count = 0;
    entry.windowStartedAt = now;
  }
  entry.count++;
  entry.lastFailureAt = now;
  failedAuth.set(sourceIp, entry);
}

/**
 * Returns null if the IP is OK to attempt auth, or { retryAfterMs } if
 * currently in backoff.
 */
export function checkAuthBackoff(sourceIp) {
  const entry = failedAuth.get(sourceIp);
  if (!entry) return null;
  if (entry.count <= FAILED_AUTH_LIMIT) return null;

  // Exponential backoff: base * 2^(count - limit), capped.
  const overage = entry.count - FAILED_AUTH_LIMIT;
  const backoff = Math.min(
    FAILED_AUTH_BASE_BACKOFF_MS * 2 ** Math.min(overage, 10),
    FAILED_AUTH_MAX_BACKOFF_MS,
  );
  const elapsed = Date.now() - entry.lastFailureAt;
  if (elapsed < backoff) {
    return { retryAfterMs: backoff - elapsed };
  }
  return null;
}

/** Reset failed-auth tracking for an IP after a successful auth. */
export function clearFailedAuth(sourceIp) {
  failedAuth.delete(sourceIp);
}

function ensureBucket(keyId, now) {
  let bucket = keyBuckets.get(keyId);
  if (!bucket || now >= bucket.windowEndsAt) {
    bucket = {
      request: 0,
      mutation: 0,
      destructive: 0,
      windowEndsAt: now + MINUTE_MS,
    };
    keyBuckets.set(keyId, bucket);
  }
  return bucket;
}

function readLimits() {
  // Defaults from safety-and-permissions.md. Settings can override at runtime.
  if (typeof game === "undefined" || !game.settings) {
    return { request: 60, mutation: 10, destructive: 5 };
  }
  return {
    request: Number(getSetting(SETTING_KEYS.RATE_LIMIT_REQ_PER_MIN) ?? 60),
    mutation: Number(getSetting(SETTING_KEYS.RATE_LIMIT_MUTATIONS_PER_MIN) ?? 10),
    destructive: Number(getSetting(SETTING_KEYS.RATE_LIMIT_DESTRUCTIVE_PER_MIN) ?? 5),
  };
}

/** Test-only: clear all state. */
export function _resetForTests() {
  keyBuckets.clear();
  failedAuth.clear();
}

/** Test-only: read state for assertions. */
export function _stateForTests() {
  return {
    keyBuckets: new Map(keyBuckets),
    failedAuth: new Map(failedAuth),
  };
}
