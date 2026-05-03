/**
 * Foundry Voice Control — undo snapshot store.
 *
 * In-memory keyed by undo_token. Per-key cap of 50; older snapshots evict
 * when a key creates a 51st. TTL of 1 hour, swept lazily on access and on
 * a 5-minute interval when running.
 *
 * One-shot consumption — undo cannot be undone.
 *
 * See docs/safety-and-permissions.md "Undo".
 */

import * as crypto from "node:crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_KEY = 50;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** undo_token → snapshot */
const snapshots = new Map();
/** key_id → array of undo_tokens in insertion order */
const tokensByKey = new Map();

let sweepTimer = null;

/**
 * Capture a snapshot. Returns the issued undo_token.
 *
 * @param {object} args
 * @param {string} args.keyId
 * @param {string} args.tool
 * @param {string} args.scopeRequired
 * @param {boolean} [args.clientRequired]
 * @param {object} args.payload  - { type: string, ...tool-specific fields }
 */
export function capture({ keyId, tool, scopeRequired, clientRequired = false, payload }) {
  const undoToken = `undo_${crypto.randomBytes(8).toString("hex")}`;
  const now = Date.now();
  const snapshot = {
    undo_token: undoToken,
    key_id: keyId,
    tool,
    scope_required: scopeRequired,
    client_required: clientRequired,
    payload,
    created_at: now,
    expires_at: now + TTL_MS,
  };

  snapshots.set(undoToken, snapshot);

  if (!tokensByKey.has(keyId)) tokensByKey.set(keyId, []);
  const list = tokensByKey.get(keyId);
  list.push(undoToken);

  // Evict oldest if over per-key cap.
  while (list.length > MAX_PER_KEY) {
    const evicted = list.shift();
    snapshots.delete(evicted);
  }

  return undoToken;
}

/** Return a snapshot WITHOUT consuming it. Lazy-prunes expired. */
export function peek(undoToken) {
  sweepExpired();
  return snapshots.get(undoToken) ?? null;
}

/** Consume a snapshot. Returns the snapshot or null. One-shot. */
export function consume(undoToken) {
  sweepExpired();
  const snapshot = snapshots.get(undoToken);
  if (!snapshot) return null;
  snapshots.delete(undoToken);
  const list = tokensByKey.get(snapshot.key_id);
  if (list) {
    const idx = list.indexOf(undoToken);
    if (idx >= 0) list.splice(idx, 1);
  }
  return snapshot;
}

/** Remove expired entries. Called lazily and on a 5-minute interval. */
export function sweepExpired() {
  const now = Date.now();
  for (const [token, snap] of snapshots) {
    if (snap.expires_at < now) {
      snapshots.delete(token);
      const list = tokensByKey.get(snap.key_id);
      if (list) {
        const idx = list.indexOf(token);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
  }
}

/** Start the periodic sweep. Idempotent. */
export function startSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpired(), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopSweep() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Convenience used by handlers — captures from an auth ctx. */
export function recordUndo(ctx, { tool, scopeRequired, clientRequired, payload }) {
  return capture({
    keyId: ctx.key.id,
    tool,
    scopeRequired,
    clientRequired: !!clientRequired,
    payload,
  });
}

/** Test-only state reset. */
export function _resetForTests() {
  snapshots.clear();
  tokensByKey.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only state read. */
export function _stateForTests() {
  return {
    snapshots: new Map(snapshots),
    tokensByKey: new Map([...tokensByKey].map(([k, v]) => [k, [...v]])),
  };
}
