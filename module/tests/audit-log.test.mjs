import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  initAuditLog,
  readAuditEntries,
  recordAuditEntry,
  shutdown,
  _setLogFilePathForTests,
} from "../scripts/server/audit-log.mjs";

let tmpDir;
let logPath;

beforeEach(async () => {
  globalThis.__resetTestSettings();
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fop-audit-"));
  await initAuditLog(tmpDir);
  logPath = path.join(tmpDir, "Data", "modules", "foundry-voice-control", "audit.log");
});

afterEach(async () => {
  shutdown();
  if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("audit log allowlist", () => {
  it("records only the allowlisted fields", async () => {
    await recordAuditEntry({
      timestamp: "2026-04-30T10:00:00Z",
      tool: "delete_actor",
      success: true,
      key_id: "key_1",
      scope_used: "gm",
      source_ip: "127.0.0.1",
      request_id: "req-1",
      // These should be dropped:
      params: { actor: "Bob" },
      bearer_token: "fvc_secret",
    });
    const entries = await readAuditEntries();
    expect(entries.length).toBe(1);
    const e = entries[0];
    expect(e.tool).toBe("delete_actor");
    expect(e.params).toBeUndefined();
    expect(e.bearer_token).toBeUndefined();
  });

  it("auto-fills timestamp when missing", async () => {
    await recordAuditEntry({ tool: "list_scenes", success: true });
    const entries = await readAuditEntries();
    expect(entries[0].timestamp).toBeTruthy();
  });

  it("returns last-N entries in order", async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditEntry({
        timestamp: new Date(2026, 0, 1, 10, i).toISOString(),
        tool: `tool_${i}`,
        success: true,
      });
    }
    const last3 = await readAuditEntries(3);
    expect(last3.length).toBe(3);
    expect(last3[2].tool).toBe("tool_4");
  });
});

describe("retention pruning", () => {
  it("drops entries older than the configured window", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "auditLogRetentionDays", 1);

    const oldDate = new Date(Date.now() - 5 * 86400_000).toISOString();
    const newDate = new Date().toISOString();

    // Write entries directly to the file to bypass the timestamp default.
    await fsp.writeFile(
      logPath,
      [
        JSON.stringify({ timestamp: oldDate, tool: "old", success: true }),
        JSON.stringify({ timestamp: newDate, tool: "new", success: true }),
        "",
      ].join("\n"),
    );

    // Re-init triggers prune at boot.
    await initAuditLog(tmpDir);
    const entries = await readAuditEntries();
    expect(entries.find((e) => e.tool === "old")).toBeUndefined();
    expect(entries.find((e) => e.tool === "new")).toBeTruthy();
  });
});

describe("when path is unset", () => {
  it("recordAuditEntry is a no-op without a configured path", async () => {
    _setLogFilePathForTests(null);
    await expect(recordAuditEntry({ tool: "x", success: true })).resolves.toBeUndefined();
  });
});
