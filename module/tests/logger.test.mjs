import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, _internal } from "../scripts/server/logger.mjs";

describe("logger redaction", () => {
  let logSpy, warnSpy, errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("redacts Authorization header", () => {
    logger.info({ headers: { authorization: "Bearer fvc_secret" }, msg: "hi" });
    const out = logSpy.mock.calls[0][0];
    expect(out).not.toContain("fvc_secret");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts Cookie header", () => {
    logger.info({ headers: { cookie: "session=abc123" }, msg: "hi" });
    const out = logSpy.mock.calls[0][0];
    expect(out).not.toContain("abc123");
  });

  it("redacts patch payloads", () => {
    const SECRET = "this_is_a_distinctive_patch_value";
    logger.info({
      tool: "update_actor",
      params: { patch: { "system.attributes.hp.value": SECRET } },
    });
    const out = logSpy.mock.calls[0][0];
    expect(out).not.toContain(SECRET);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts system payloads (potentially large; possibly user-stuffed)", () => {
    logger.info({ params: { system: { secret: "value" } } });
    const out = logSpy.mock.calls[0][0];
    expect(out).not.toContain("secret");
  });

  it("redacts URL credentials in image fields", () => {
    logger.info({ params: { image: "https://user:pass@cdn.example.com/img.png" } });
    const out = logSpy.mock.calls[0][0];
    expect(out).not.toContain("user:pass");
    expect(out).toContain("[REDACTED]");
  });

  it("does NOT redact non-sensitive fields", () => {
    logger.info({ tool: "activate_scene", request_id: "req-1", source_ip: "127.0.0.1" });
    const out = logSpy.mock.calls[0][0];
    expect(out).toContain("activate_scene");
    expect(out).toContain("req-1");
    expect(out).toContain("127.0.0.1");
  });

  it("strips error stack from logger.error", () => {
    const err = new Error("Boom");
    logger.error({ msg: "failed", err });
    const out = errorSpy.mock.calls[0][0];
    expect(out).toContain("Boom");
    // Stack frames typically include "at " prefix.
    expect(out).not.toContain("at ");
  });

  it("includes timestamp and module id prefix", () => {
    logger.info({ msg: "hi" });
    const out = logSpy.mock.calls[0][0];
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\..+Z foundry-voice-control INFO /);
  });

  it("redactUrlCredentials is robust", () => {
    expect(_internal.redactUrlCredentials("https://u:p@host/x")).toContain("[REDACTED]");
    expect(_internal.redactUrlCredentials("https://host/x")).toBe("https://host/x");
    expect(_internal.redactUrlCredentials("not a url")).toBe("not a url");
  });
});
