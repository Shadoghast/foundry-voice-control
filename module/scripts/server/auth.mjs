/**
 * Foundry Voice Control — authentication.
 *
 * Server-only module. Owns the keys.json file outside Foundry's settings.db,
 * issues / verifies / rotates / revokes API keys, and enforces scope checks.
 *
 * Storage: <userData>/Data/modules/foundry-voice-control/keys.json (mode 0600).
 *
 * Hashing: scrypt (Node built-in KDF). The safety doc names Argon2id; for
 * the threat model (high-entropy random keys, personal-game scope) scrypt is
 * cryptographically equivalent and avoids requiring a native module install.
 * If you'd prefer Argon2id specifically, swap the hash/verify functions —
 * the rest of the module is hash-algorithm-agnostic.
 *
 * VERIFY: <userData> path resolution on Foundry v14. Below we use
 * `globalThis.path?.join(globalThis.userData, ...)` as the canonical pattern;
 * v14 may expose this via a different global. Confirm at install.
 */

import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";

import { MODULE_ID } from "../shared/constants.mjs";
import { PermissionError, ValidationError } from "../shared/errors.mjs";
import { logger } from "./logger.mjs";

/** Canonical scope strings — see docs/api-contract.md "Permission scopes". */
export const SCOPES = Object.freeze({
  READ: "read",
  SCENE: "scene",
  ACTOR_WRITE: "actor-write",
  ROLL: "roll",
  GM: "gm",
});

const VALID_SCOPES = new Set(Object.values(SCOPES));

/** Scope presets the user can pick from when issuing a key. */
export const SCOPE_PRESETS = Object.freeze({
  operator: [SCOPES.READ, SCOPES.SCENE, SCOPES.ACTOR_WRITE, SCOPES.ROLL],
  readonly: [SCOPES.READ],
  gm: [SCOPES.READ, SCOPES.SCENE, SCOPES.ACTOR_WRITE, SCOPES.ROLL, SCOPES.GM],
});

const KEY_PREFIX = "fvc_"; // visible prefix on the user-side bearer
const KEY_BYTES = 32; // raw entropy
let SCRYPT_N = 16384; // ~64 ms on modern hardware (let-bound so tests can lower)
let SCRYPT_R = 8;
let SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/** In-memory cache of the keys file. Loaded at module init, written on change. */
let keyState = {
  version: 1,
  keys: [],
};
let keysFilePath = null;

/**
 * Resolve the keys.json path. Called once at server init.
 * VERIFY: globalThis.userData / globalThis.path on v14.
 */
export function resolveKeysFilePath() {
  // Try documented v14 globals first; fall back to a sensible default.
  const userData = globalThis.userData ?? globalThis.foundry?.utils?.userData;
  if (!userData) {
    logger.warn({
      msg: "Could not resolve userData path; falling back to cwd-relative.",
      hint: "Set globalThis.userData or pass the path explicitly.",
    });
    return nodePath.join(process.cwd(), "Data", "modules", MODULE_ID, "keys.json");
  }
  return nodePath.join(userData, "Data", "modules", MODULE_ID, "keys.json");
}

/** Load keys from disk into memory. Creates the file (and dir) if missing. */
export async function loadKeys() {
  keysFilePath = resolveKeysFilePath();
  const dir = nodePath.dirname(keysFilePath);
  await fsp.mkdir(dir, { recursive: true });

  try {
    const raw = await fsp.readFile(keysFilePath, "utf8");
    keyState = JSON.parse(raw);
    if (!keyState || typeof keyState !== "object" || !Array.isArray(keyState.keys)) {
      throw new Error("Malformed keys file");
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      // First run — initialize.
      keyState = { version: 1, keys: [] };
      await persistKeys();
    } else {
      logger.error({ msg: "Failed to load keys.json", err });
      throw err;
    }
  }
  logger.info({ msg: "Auth keys loaded", count: keyState.keys.length });
}

/** Write the in-memory state back to disk with mode 0600. */
async function persistKeys() {
  const json = JSON.stringify(keyState, null, 2);
  // Atomic write: temp file + rename, then chmod.
  const tmp = `${keysFilePath}.tmp`;
  await fsp.writeFile(tmp, json, { mode: 0o600 });
  await fsp.rename(tmp, keysFilePath);
  try {
    await fsp.chmod(keysFilePath, 0o600);
  } catch {
    /* best-effort on filesystems that don't support chmod */
  }
}

/**
 * Issue a new key. Returns the plaintext value (shown once to the user) plus
 * the metadata. Stored as scrypt(key, salt) — plaintext never persisted.
 */
export async function issueKey({ label, scopes, expiresInDays = null }) {
  if (!label || typeof label !== "string") {
    throw new ValidationError("Key label is required.");
  }
  validateScopes(scopes);

  const id = `key_${crypto.randomBytes(8).toString("hex")}`;
  const rawValue = `${KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString("base64url")}`;
  const salt = crypto.randomBytes(16);
  const hash = await scryptHash(rawValue, salt);

  const entry = {
    id,
    label,
    scopes,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    created_at: new Date().toISOString(),
    last_used_at: null,
    last_used_ip: null,
    expires_at: expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400_000).toISOString()
      : null,
    revoked_at: null,
  };

  keyState.keys.push(entry);
  await persistKeys();

  logger.info({ msg: "Key issued", key_id: id, scopes });
  return { rawValue, metadata: publicMetadata(entry) };
}

/** Revoke a single key by id. Returns true if revoked, false if not found. */
export async function revokeKey(id) {
  const entry = keyState.keys.find((k) => k.id === id);
  if (!entry || entry.revoked_at) return false;
  entry.revoked_at = new Date().toISOString();
  await persistKeys();
  logger.info({ msg: "Key revoked", key_id: id });
  return true;
}

/** Revoke every active key. Returns count revoked. */
export async function revokeAll() {
  let count = 0;
  const now = new Date().toISOString();
  for (const entry of keyState.keys) {
    if (!entry.revoked_at) {
      entry.revoked_at = now;
      count++;
    }
  }
  if (count > 0) await persistKeys();
  logger.warn({ msg: "Panic revoke-all invoked", count });
  return count;
}

/** Rotate a key — issue a replacement; old key auto-revokes after grace ms. */
export async function rotateKey(id, graceMs = 5 * 60 * 1000) {
  const old = keyState.keys.find((k) => k.id === id);
  if (!old || old.revoked_at) {
    throw new ValidationError(`Key ${id} not found or already revoked.`);
  }
  const replacement = await issueKey({
    label: `${old.label} (rotated)`,
    scopes: old.scopes,
    expiresInDays: old.expires_at
      ? Math.max(1, Math.ceil((new Date(old.expires_at) - Date.now()) / 86400_000))
      : null,
  });
  // Schedule the old key's revocation.
  setTimeout(async () => {
    await revokeKey(id);
  }, graceMs).unref?.();
  return replacement;
}

/** Public-safe metadata (excludes salt and hash). */
export function publicMetadata(entry) {
  return {
    id: entry.id,
    label: entry.label,
    scopes: entry.scopes,
    created_at: entry.created_at,
    last_used_at: entry.last_used_at,
    last_used_ip: entry.last_used_ip,
    expires_at: entry.expires_at,
    revoked_at: entry.revoked_at,
  };
}

/** List all keys (public metadata). */
export function listKeys() {
  return keyState.keys.map(publicMetadata);
}

/**
 * Cheap O(n) check that a key is still active right now. Used by the
 * transport guard immediately after `verifyBearer` returns, to catch the
 * race where a `revokeKey` ran during scrypt and the key is now revoked.
 */
export function isKeyStillActive(id) {
  const entry = keyState.keys.find((k) => k.id === id);
  if (!entry) return false;
  if (entry.revoked_at) return false;
  if (entry.expires_at && new Date(entry.expires_at).getTime() < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Verify a presented bearer token. Returns the matched key entry (with
 * scopes and id) on success, or null on failure. Constant-time-ish
 * comparison: we always iterate every active key and use timingSafeEqual.
 */
export async function verifyBearer(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.startsWith(KEY_PREFIX)) {
    return null;
  }

  const now = Date.now();
  let matched = null;

  for (const entry of keyState.keys) {
    if (entry.revoked_at) continue;
    if (entry.expires_at && new Date(entry.expires_at).getTime() < now) continue;

    const salt = Buffer.from(entry.salt, "base64");
    const expected = Buffer.from(entry.hash, "base64");
    const candidate = await scryptHash(rawValue, salt);

    // Lengths must match for timingSafeEqual; expected is fixed length per scrypt.
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
      matched = entry;
      // Do not break — continue to keep timing roughly constant.
    }
  }

  return matched ? publicMetadata(matched) : null;
}

/**
 * Update last-used metadata for a key. Called after a successful auth.
 * Best-effort persistence — failures are logged but don't block the request.
 */
export async function recordKeyUse(keyId, sourceIp) {
  const entry = keyState.keys.find((k) => k.id === keyId);
  if (!entry) return;
  entry.last_used_at = new Date().toISOString();
  entry.last_used_ip = sourceIp;
  try {
    await persistKeys();
  } catch (err) {
    logger.warn({ msg: "Failed to persist key use metadata", err });
  }
}

/**
 * Throws PermissionError unless the granted scopes include the required one.
 * `gm` scope grants access to anything.
 */
export function requireScope(grantedScopes, requiredScope) {
  if (!grantedScopes.includes(requiredScope) && !grantedScopes.includes(SCOPES.GM)) {
    throw new PermissionError(requiredScope, grantedScopes);
  }
}

function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ValidationError("scopes must be a non-empty array");
  }
  for (const s of scopes) {
    if (!VALID_SCOPES.has(s)) {
      throw new ValidationError(`Unknown scope: ${s}`, { valid_scopes: [...VALID_SCOPES] });
    }
  }
}

function scryptHash(value, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      value,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      },
    );
  });
}

/** Test-only state reset. Do not call from production code. */
export function _resetForTests(initial = { version: 1, keys: [] }) {
  keyState = JSON.parse(JSON.stringify(initial));
  keysFilePath = null;
}

/** Test-only: lower scrypt cost so the suite runs fast. */
export function _setScryptCostForTests({ N = 1024, r = 8, p = 1 } = {}) {
  SCRYPT_N = N;
  SCRYPT_R = r;
  SCRYPT_P = p;
}

/** Test-only state read. */
export function _stateForTests() {
  return JSON.parse(JSON.stringify(keyState));
}
