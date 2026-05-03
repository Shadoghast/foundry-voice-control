/**
 * Foundry Voice Control — audit log.
 *
 * Append-only log of every tool invocation. Records ONLY the metadata
 * allowlist from docs/safety-and-permissions.md "Audit log" — never the
 * parameter values. GM-readable via /voice audit show (sub-stage 3g).
 *
 * Storage: <userData>/Data/modules/foundry-voice-control/audit.log
 *
 * Retention: 7-day rolling, configurable. Pruning runs at server boot and
 * once per hour thereafter. Old entries are dropped from the file by
 * rewriting it minus the expired lines (cheap at 7-day scale).
 */

import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";

import { MODULE_ID } from "../shared/constants.mjs";
import { SETTING_KEYS, getSetting } from "./settings.mjs";
import { logger } from "./logger.mjs";

/** Allowlist of fields that may appear in an audit entry. */
const ALLOWED_FIELDS = new Set([
  "timestamp",
  "key_id",
  "scope_used",
  "tool",
  "success",
  "source_ip",
  "request_id",
]);

let logFilePath = null;
let pruneTimer = null;

/** Initialize the audit log. Resolves the path, ensures the file exists. */
export async function initAuditLog(userDataPath) {
  if (!userDataPath) {
    logger.warn({ msg: "Audit log: no userData path; skipping init." });
    return;
  }
  logFilePath = nodePath.join(userDataPath, "Data", "modules", MODULE_ID, "audit.log");
  await fsp.mkdir(nodePath.dirname(logFilePath), { recursive: true });
  // Touch the file so it exists.
  try {
    await fsp.access(logFilePath);
  } catch {
    await fsp.writeFile(logFilePath, "", { mode: 0o600 });
  }

  // Initial prune + schedule.
  await pruneOldEntries();
  pruneTimer = setInterval(() => pruneOldEntries().catch(() => {}), 60 * 60 * 1000);
  pruneTimer.unref?.();

  logger.info({ msg: "Audit log initialized", path: logFilePath });
}

/** Append one audit entry. Drops any field not in ALLOWED_FIELDS. */
export async function recordAuditEntry(entry) {
  if (!logFilePath) return;
  const safe = filterFields(entry);
  if (!safe.timestamp) safe.timestamp = new Date().toISOString();
  const line = JSON.stringify(safe) + "\n";
  try {
    await fsp.appendFile(logFilePath, line);
  } catch (err) {
    logger.warn({ msg: "Failed to write audit entry", err });
  }
}

/** Read recent entries (newest last). `lastN` limits the read. */
export async function readAuditEntries(lastN = 100) {
  if (!logFilePath) return [];
  try {
    const raw = await fsp.readFile(logFilePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-lastN).map(safeParse).filter(Boolean);
  } catch (err) {
    logger.warn({ msg: "Failed to read audit log", err });
    return [];
  }
}

/** Drop entries older than the configured retention window. */
async function pruneOldEntries() {
  if (!logFilePath) return;
  const days = (typeof game !== "undefined" && game.settings)
    ? Number(getSetting(SETTING_KEYS.AUDIT_LOG_RETENTION_DAYS) ?? 7)
    : 7;
  const cutoff = Date.now() - days * 86400_000;

  try {
    const raw = await fsp.readFile(logFilePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const kept = [];
    let dropped = 0;
    for (const line of lines) {
      const parsed = safeParse(line);
      if (!parsed) continue;
      const ts = Date.parse(parsed.timestamp ?? "");
      if (Number.isFinite(ts) && ts >= cutoff) {
        kept.push(line);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      // Atomic rewrite: tmp file + rename.
      const tmp = `${logFilePath}.tmp`;
      await fsp.writeFile(tmp, kept.length ? kept.join("\n") + "\n" : "", { mode: 0o600 });
      await fsp.rename(tmp, logFilePath);
      logger.info({ msg: "Audit log pruned", dropped, kept: kept.length });
    }
  } catch (err) {
    logger.warn({ msg: "Audit prune failed", err });
  }
}

/** Stop the prune timer. Idempotent. */
export function shutdown() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

function filterFields(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry ?? {})) {
    if (ALLOWED_FIELDS.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Test-only path override. */
export function _setLogFilePathForTests(path) {
  logFilePath = path;
}
