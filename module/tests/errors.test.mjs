import { describe, it, expect } from "vitest";
import {
  ApiError,
  AmbiguousError,
  ErrorCode,
  GmUnavailableError,
  InternalError,
  NotFoundError,
  PermissionError,
  SystemUnsupportedError,
  TimeoutError,
  ValidationError,
} from "../scripts/shared/errors.mjs";

describe("ApiError hierarchy", () => {
  it("ApiError carries code, summary, details", () => {
    const e = new ApiError(ErrorCode.INTERNAL, "Boom", { x: 1 });
    expect(e.code).toBe("internal");
    expect(e.summary).toBe("Boom");
    expect(e.details).toEqual({ x: 1 });
    expect(e).toBeInstanceOf(Error);
  });

  it("isClientError distinguishes 4xx-like from 5xx-like", () => {
    expect(new NotFoundError("scene", "x", []).isClientError()).toBe(true);
    expect(new ValidationError("nope").isClientError()).toBe(true);
    expect(new PermissionError("gm", []).isClientError()).toBe(true);
    expect(new InternalError("abc").isClientError()).toBe(false);
  });

  it("NotFoundError surfaces top suggestion in summary", () => {
    const e = new NotFoundError("scene", "Bridge", [
      { id: "abc", name: "Bridge of Khazad-Dum" },
    ]);
    expect(e.code).toBe("not_found");
    expect(e.summary).toContain("Bridge of Khazad-Dum");
    expect(e.details.suggestions).toHaveLength(1);
  });

  it("AmbiguousError formats top two candidates", () => {
    const e = new AmbiguousError("scene", "Bridge", [
      { id: "1", name: "Bridge One" },
      { id: "2", name: "Bridge Two" },
      { id: "3", name: "Bridge Three" },
    ]);
    expect(e.code).toBe("ambiguous");
    expect(e.summary).toContain("Bridge One");
    expect(e.summary).toContain("Bridge Two");
    expect(e.details.candidates).toHaveLength(3);
  });

  it("PermissionError records required and granted scopes", () => {
    const e = new PermissionError("gm", ["read", "scene"]);
    expect(e.details.required_scope).toBe("gm");
    expect(e.details.key_scopes).toEqual(["read", "scene"]);
  });

  it("GmUnavailableError tells the user to open Chrome", () => {
    const e = new GmUnavailableError("select_tokens");
    expect(e.summary).toMatch(/GM client/i);
    expect(e.details.tool_name).toBe("select_tokens");
  });

  it("SystemUnsupportedError lists supported systems", () => {
    const e = new SystemUnsupportedError("roll", "made_up", ["dnd5e", "whtow"]);
    expect(e.code).toBe("system_unsupported");
    expect(e.details.supported_systems).toEqual(["dnd5e", "whtow"]);
  });

  it("TimeoutError records tool name and budget", () => {
    const e = new TimeoutError("place_token", 5000);
    expect(e.code).toBe("timeout");
    expect(e.details.timeout_ms).toBe(5000);
  });

  it("InternalError carries correlation_id only", () => {
    const e = new InternalError("corr-abc");
    expect(e.code).toBe("internal");
    expect(e.details.correlation_id).toBe("corr-abc");
    // Must not contain a stack reference to file paths.
    expect(JSON.stringify(e.details)).not.toContain("scripts/");
  });
});
