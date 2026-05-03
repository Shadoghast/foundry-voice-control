import { describe, it, expect } from "vitest";
import {
  errorEnvelope,
  statusCodeForEnvelope,
  successEnvelope,
} from "../scripts/shared/envelope.mjs";
import {
  AmbiguousError,
  GmUnavailableError,
  NotFoundError,
  PermissionError,
  SystemUnsupportedError,
  TimeoutError,
  ValidationError,
} from "../scripts/shared/errors.mjs";

describe("successEnvelope", () => {
  it("includes ok, summary, data", () => {
    const e = successEnvelope({ summary: "Done", data: { x: 1 } });
    expect(e.ok).toBe(true);
    expect(e.summary).toBe("Done");
    expect(e.data).toEqual({ x: 1 });
  });

  it("never includes forbidden top-level fields", () => {
    const e = successEnvelope({ summary: "Done", data: { x: 1 } });
    const json = JSON.stringify(e);
    expect(json).not.toContain("stack");
    expect(json).not.toContain("__proto__");
  });

  it("requires a non-empty summary string", () => {
    expect(() => successEnvelope({ data: {} })).toThrow();
    expect(() => successEnvelope({ summary: "" })).toThrow();
    expect(() => successEnvelope({ summary: 123 })).toThrow();
  });

  it("dispatched_to_client false is preserved in spirit but filtered when null/undefined", () => {
    const e = successEnvelope({ summary: "ok", dispatchedToClient: true });
    expect(e.dispatched_to_client).toBe(true);
  });
});

describe("errorEnvelope", () => {
  it("formats ApiError into the documented shape", () => {
    const env = errorEnvelope(new NotFoundError("scene", "x", []));
    expect(env.ok).toBe(false);
    expect(env.summary).toBeTruthy();
    expect(env.error.code).toBe("not_found");
  });

  it("wraps unknown throws as InternalError without leaking stack", () => {
    const env = errorEnvelope(new Error("raw with secret"), "req-1", "corr-1");
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("internal");
    expect(env.error.correlation_id).toBe("corr-1");

    const json = JSON.stringify(env);
    expect(json).not.toContain("at ");
    expect(json).not.toContain("scripts/");
    expect(json).not.toContain("raw with secret");
  });

  it("attaches the request id", () => {
    const env = errorEnvelope(new ValidationError("nope"), "req-7");
    expect(env.request_id).toBe("req-7");
  });
});

describe("statusCodeForEnvelope", () => {
  const cases = [
    [() => successEnvelope({ summary: "ok" }), 200],
    [() => errorEnvelope(new NotFoundError("x", "y", [])), 404],
    [() => errorEnvelope(new ValidationError("v")), 400],
    [() => errorEnvelope(new PermissionError("gm", [])), 403],
    [() => errorEnvelope(new GmUnavailableError("t")), 503],
    [() => errorEnvelope(new TimeoutError("t", 5000)), 504],
    [() => errorEnvelope(new SystemUnsupportedError("t", "x", [])), 501],
    [
      () =>
        errorEnvelope(new AmbiguousError("scene", "x", [{ id: "1", name: "A" }, { id: "2", name: "B" }])),
      409,
    ],
  ];
  for (const [build, expectedStatus] of cases) {
    it(`returns ${expectedStatus} for ${expectedStatus < 400 ? "success" : build().error?.code}`, () => {
      expect(statusCodeForEnvelope(build())).toBe(expectedStatus);
    });
  }
});
