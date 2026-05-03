import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCOPES,
  SCOPE_PRESETS,
  isKeyStillActive,
  issueKey,
  listKeys,
  loadKeys,
  recordKeyUse,
  requireScope,
  resolveKeysFilePath,
  revokeAll,
  revokeKey,
  rotateKey,
  verifyBearer,
  _resetForTests,
  _setScryptCostForTests,
  _stateForTests,
} from "../scripts/server/auth.mjs";

let tmpDir;

beforeEach(async () => {
  // Use fast scrypt for tests.
  _setScryptCostForTests({ N: 1024 });
  _resetForTests();

  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fop-auth-"));
  globalThis.userData = tmpDir;
  await loadKeys();
});

afterEach(async () => {
  if (tmpDir) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    delete globalThis.userData;
  }
});

describe("scope checks", () => {
  it("requireScope throws PermissionError when scope missing", () => {
    expect(() => requireScope([SCOPES.READ], SCOPES.GM)).toThrow();
  });

  it("requireScope passes when scope is present", () => {
    expect(() => requireScope([SCOPES.READ, SCOPES.SCENE], SCOPES.SCENE)).not.toThrow();
  });

  it("gm scope is a superset and passes any scope check", () => {
    expect(() => requireScope([SCOPES.GM], SCOPES.ACTOR_WRITE)).not.toThrow();
    expect(() => requireScope([SCOPES.GM], SCOPES.ROLL)).not.toThrow();
  });
});

describe("key issuance", () => {
  it("issues a key with all required metadata", async () => {
    const { rawValue, metadata } = await issueKey({
      label: "test op",
      scopes: SCOPE_PRESETS.operator,
    });
    expect(rawValue).toMatch(/^fvc_/);
    expect(metadata.id).toMatch(/^key_/);
    expect(metadata.label).toBe("test op");
    expect(metadata.scopes).toEqual(SCOPE_PRESETS.operator);
    expect(metadata.created_at).toBeTruthy();
    expect(metadata.last_used_at).toBeNull();
    expect(metadata.revoked_at).toBeNull();
  });

  it("rejects keys without a label", async () => {
    await expect(issueKey({ label: "", scopes: SCOPE_PRESETS.operator })).rejects.toThrow();
  });

  it("rejects unknown scopes", async () => {
    await expect(
      issueKey({ label: "x", scopes: ["read", "made-up"] }),
    ).rejects.toThrow();
  });

  it("rejects empty scope list", async () => {
    await expect(issueKey({ label: "x", scopes: [] })).rejects.toThrow();
  });

  it("persists to disk with mode 0600 (POSIX)", async () => {
    await issueKey({ label: "persist", scopes: ["read"] });
    const filePath = resolveKeysFilePath();
    expect(fs.existsSync(filePath)).toBe(true);
    if (process.platform !== "win32") {
      const stat = await fsp.stat(filePath);
      // Lower 9 mode bits.
      expect(stat.mode & 0o777).toBe(0o600);
    }
    // Plaintext value never persisted.
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.keys[0].hash).toBeTruthy();
    expect(parsed.keys[0].salt).toBeTruthy();
    expect(JSON.stringify(parsed)).not.toContain("fvc_");
  });
});

describe("verifyBearer", () => {
  it("returns metadata for a valid key", async () => {
    const { rawValue, metadata } = await issueKey({
      label: "v",
      scopes: SCOPE_PRESETS.readonly,
    });
    const matched = await verifyBearer(rawValue);
    expect(matched).toBeTruthy();
    expect(matched.id).toBe(metadata.id);
  });

  it("returns null for an invalid bearer", async () => {
    await issueKey({ label: "v", scopes: SCOPE_PRESETS.readonly });
    expect(await verifyBearer("fvc_not_a_real_key")).toBeNull();
  });

  it("returns null for a non-fvc_ prefix", async () => {
    expect(await verifyBearer("Bearer xyz")).toBeNull();
    expect(await verifyBearer("")).toBeNull();
    expect(await verifyBearer(null)).toBeNull();
  });

  it("returns null for a revoked key", async () => {
    const { rawValue, metadata } = await issueKey({ label: "v", scopes: ["read"] });
    await revokeKey(metadata.id);
    expect(await verifyBearer(rawValue)).toBeNull();
  });

  it("returns null for an expired key", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T10:00:00Z"));
      const { rawValue } = await issueKey({
        label: "v",
        scopes: ["read"],
        expiresInDays: 1,
      });
      vi.setSystemTime(new Date("2026-05-02T10:00:00Z"));
      expect(await verifyBearer(rawValue)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("revocation", () => {
  it("revokeKey marks revoked_at and returns true", async () => {
    const { metadata } = await issueKey({ label: "x", scopes: ["read"] });
    expect(await revokeKey(metadata.id)).toBe(true);
    const all = listKeys();
    expect(all[0].revoked_at).toBeTruthy();
  });

  it("revokeKey returns false for unknown id", async () => {
    expect(await revokeKey("key_does_not_exist")).toBe(false);
  });

  it("revokeAll panics every active key in one call", async () => {
    await issueKey({ label: "a", scopes: ["read"] });
    await issueKey({ label: "b", scopes: ["read"] });
    await issueKey({ label: "c", scopes: ["read"] });
    const count = await revokeAll();
    expect(count).toBe(3);
    expect(listKeys().every((k) => k.revoked_at !== null)).toBe(true);
  });

  it("revokeAll only counts active keys", async () => {
    const { metadata: m1 } = await issueKey({ label: "a", scopes: ["read"] });
    await issueKey({ label: "b", scopes: ["read"] });
    await revokeKey(m1.id);
    const count = await revokeAll();
    expect(count).toBe(1);
  });
});

describe("rotation with grace", () => {
  it("rotateKey issues a new key with the same scopes", async () => {
    const { metadata: orig } = await issueKey({
      label: "rotate me",
      scopes: SCOPE_PRESETS.operator,
    });
    const { rawValue: newRaw, metadata: newMeta } = await rotateKey(orig.id, 60_000);
    expect(newRaw).toMatch(/^fvc_/);
    expect(newMeta.scopes).toEqual(orig.scopes);
    expect(newMeta.label).toContain("rotated");
    // Original is still active during grace period.
    expect(listKeys().find((k) => k.id === orig.id).revoked_at).toBeNull();
  });
});

describe("recordKeyUse", () => {
  it("updates last_used_at and last_used_ip", async () => {
    const { metadata } = await issueKey({ label: "u", scopes: ["read"] });
    await recordKeyUse(metadata.id, "1.2.3.4");
    const updated = listKeys().find((k) => k.id === metadata.id);
    expect(updated.last_used_at).toBeTruthy();
    expect(updated.last_used_ip).toBe("1.2.3.4");
  });
});

describe("isKeyStillActive (revocation race protection)", () => {
  it("returns true for an active key", async () => {
    const { metadata } = await issueKey({ label: "active", scopes: ["read"] });
    expect(isKeyStillActive(metadata.id)).toBe(true);
  });

  it("returns false after revoke", async () => {
    const { metadata } = await issueKey({ label: "rv", scopes: ["read"] });
    await revokeKey(metadata.id);
    expect(isKeyStillActive(metadata.id)).toBe(false);
  });

  it("returns false for an expired key", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T10:00:00Z"));
      const { metadata } = await issueKey({
        label: "exp",
        scopes: ["read"],
        expiresInDays: 1,
      });
      vi.setSystemTime(new Date("2026-05-02T10:00:00Z"));
      expect(isKeyStillActive(metadata.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns false for an unknown id", () => {
    expect(isKeyStillActive("key_does_not_exist")).toBe(false);
  });
});
