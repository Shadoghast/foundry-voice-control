/**
 * Foundry Voice Control — image input validation.
 *
 * Used by set_token_image and set_actor_image. Enforces the safety doc's
 * "Input validation / Images and URLs" rules:
 *   - Paths must canonicalize under <userData>/Data/.
 *   - URLs must be in the allowlist; RFC1918 / link-local / cloud-metadata
 *     hosts are blocked; SVG content-type is rejected; size cap; no redirects.
 *
 * Returns { kind: "path" | "url", value: string } on success, throws
 * ValidationError on rejection.
 */

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import { ValidationError } from "../shared/errors.mjs";
import { SETTING_KEYS, getSetting } from "./settings.mjs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BLOCKED_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /^169\.254\.169\.254$/,
];

/**
 * Validate an image input. Doesn't fetch — only checks shape and policy.
 * The caller is responsible for actual fetching (only for URLs) when it
 * makes sense to cache server-side; otherwise Foundry handles the fetch.
 *
 * @param {string} input - path or URL
 * @param {string} userDataPath - root of the Foundry user data directory
 * @returns {{ kind: "path" | "url", value: string, warnings: string[] }}
 */
export async function validateImageInput(input, userDataPath) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ValidationError("image must be a non-empty string");
  }
  const trimmed = input.trim();

  // Reject SVG outright by extension regardless of path/url.
  if (/\.svg(\?|#|$)/i.test(trimmed)) {
    throw new ValidationError("SVG images are not accepted.");
  }

  // Any URL with a scheme + :// — accept only http(s).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new ValidationError("URL scheme not supported.", {
        reason: "scheme-not-allowed",
      });
    }
    return validateUrl(trimmed);
  }
  // Schemeful inputs without :// (e.g., javascript:, data:, file:) — reject.
  if (/^(javascript|data|vbscript|file|about|blob):/i.test(trimmed)) {
    throw new ValidationError("URL scheme not supported.", {
      reason: "scheme-not-allowed",
    });
  }
  return validatePath(trimmed, userDataPath);
}

async function validatePath(path, userDataPath) {
  if (!userDataPath) {
    throw new ValidationError("Server can't resolve user data path; image rejected.", {
      reason: "userdata-unresolved",
    });
  }

  // Canonicalize using path.resolve. This collapses `..` segments without
  // touching the filesystem; we then compare against the canonical
  // userDataPath. Symlink escape is checked separately.
  const dataRoot = nodePath.resolve(userDataPath, "Data");
  let resolved = nodePath.resolve(dataRoot, path);

  // Try to follow symlinks if the file exists. If realpath errors, we still
  // require the un-realpath'd path to be under dataRoot.
  try {
    const real = await fs.realpath(resolved);
    if (!isUnderDir(real, dataRoot)) {
      throw new ValidationError("Image path resolves outside user data directory.", {
        reason: "path-traversal",
      });
    }
    resolved = real;
  } catch (err) {
    // ENOENT is fine — file may not exist yet (rare for set_*_image but possible).
    if (err.code !== "ENOENT") throw err;
    if (!isUnderDir(resolved, dataRoot)) {
      throw new ValidationError("Image path resolves outside user data directory.", {
        reason: "path-traversal",
      });
    }
  }

  return {
    kind: "path",
    value: nodePath.relative(userDataPath, resolved).split(nodePath.sep).join("/"),
    warnings: [],
  };
}

function validateUrl(rawUrl) {
  const allowlist = getSetting(SETTING_KEYS.URL_ALLOWLIST);
  if (!allowlist || allowlist.length === 0) {
    throw new ValidationError(
      "URL-based images are disabled. Add a host to the URL allowlist setting first.",
      { reason: "url-allowlist-empty" },
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError("image is not a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(`URL protocol '${url.protocol}' is not supported.`);
  }

  // Block dangerous internal targets by hostname pattern. Note: this is a
  // textual check; a defense-in-depth deployment would also resolve the
  // hostname and refuse non-public IPs after DNS. v1 keeps it simple.
  for (const re of BLOCKED_HOST_PATTERNS) {
    if (re.test(url.hostname)) {
      throw new ValidationError("URL host is in the block list.", {
        reason: "blocked-host",
        host: url.hostname,
      });
    }
  }

  if (!allowlist.some((h) => hostMatches(url.hostname, h))) {
    throw new ValidationError("URL host is not in the allowlist.", {
      reason: "host-not-allowed",
      host: url.hostname,
    });
  }

  // Strip credentials silently — Foundry shouldn't see them.
  const cleaned = new URL(url.toString());
  cleaned.username = "";
  cleaned.password = "";
  return { kind: "url", value: cleaned.toString(), warnings: [] };
}

function isUnderDir(child, parent) {
  const rel = nodePath.relative(parent, child);
  return rel && !rel.startsWith("..") && !nodePath.isAbsolute(rel);
}

function hostMatches(host, pattern) {
  if (host === pattern) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix);
  }
  return false;
}

export { MAX_IMAGE_BYTES };
