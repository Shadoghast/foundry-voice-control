import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { validateImageInput } from "../scripts/server/image-validation.mjs";

let tmpDir;

beforeEach(async () => {
  globalThis.__resetTestSettings();
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fop-img-"));
  // Create the Data subdirectory so path canonicalization can resolve.
  await fsp.mkdir(path.join(tmpDir, "Data", "modules", "foundry-voice-control"), {
    recursive: true,
  });
});

afterEach(async () => {
  if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("path inputs", () => {
  it("accepts a path under user data", async () => {
    const r = await validateImageInput("modules/foundry-voice-control/img/x.webp", tmpDir);
    expect(r.kind).toBe("path");
    expect(r.value).toBe("Data/modules/foundry-voice-control/img/x.webp");
  });

  it("rejects path traversal", async () => {
    await expect(
      validateImageInput("../../../../etc/passwd", tmpDir),
    ).rejects.toThrow(/outside/i);
  });

  it("rejects absolute paths outside user data", async () => {
    await expect(
      validateImageInput("/etc/passwd", tmpDir),
    ).rejects.toThrow(/outside/i);
  });

  it("rejects SVG by extension", async () => {
    await expect(
      validateImageInput("modules/foundry-voice-control/img/icon.svg", tmpDir),
    ).rejects.toThrow(/SVG/i);
    await expect(
      validateImageInput("modules/foundry-voice-control/img/icon.SVG?v=1", tmpDir),
    ).rejects.toThrow(/SVG/i);
  });

  it("rejects empty input", async () => {
    await expect(validateImageInput("", tmpDir)).rejects.toThrow();
    await expect(validateImageInput("   ", tmpDir)).rejects.toThrow();
  });
});

describe("URL inputs", () => {
  it("rejects URLs when allowlist is empty", async () => {
    await expect(
      validateImageInput("https://cdn.example.com/icon.png", tmpDir),
    ).rejects.toThrow(/allowlist/i);
  });

  it("accepts URLs on the allowlist", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "cdn.example.com");
    const r = await validateImageInput("https://cdn.example.com/icon.png", tmpDir);
    expect(r.kind).toBe("url");
    expect(r.value).toBe("https://cdn.example.com/icon.png");
  });

  it("supports wildcard suffix in allowlist", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "*.example.com");
    const r = await validateImageInput("https://cdn.example.com/icon.png", tmpDir);
    expect(r.kind).toBe("url");
  });

  it("blocks loopback / RFC1918 / link-local / cloud metadata", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "127.0.0.1,10.0.0.1,169.254.169.254");
    for (const url of [
      "http://127.0.0.1/icon.png",
      "http://10.0.0.1/icon.png",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(validateImageInput(url, tmpDir)).rejects.toThrow(/block/i);
    }
  });

  it("rejects SVG URLs", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "cdn.example.com");
    await expect(
      validateImageInput("https://cdn.example.com/icon.svg", tmpDir),
    ).rejects.toThrow(/SVG/i);
  });

  it("rejects non-http(s) protocols", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "cdn.example.com");
    await expect(
      validateImageInput("file:///etc/passwd", tmpDir),
    ).rejects.toThrow();
    await expect(
      validateImageInput("javascript:alert(1)", tmpDir),
    ).rejects.toThrow();
  });

  it("strips credentials from accepted URLs", async () => {
    globalThis.__setTestSetting("foundry-voice-control", "urlAllowlist", "cdn.example.com");
    const r = await validateImageInput(
      "https://user:pass@cdn.example.com/icon.png",
      tmpDir,
    );
    expect(r.value).not.toContain("user");
    expect(r.value).not.toContain("pass");
  });
});
