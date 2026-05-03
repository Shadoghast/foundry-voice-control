import { describe, it, expect } from "vitest";
import { _internal } from "../scripts/server/transport.mjs";

const { computeDepth, ipMatchesCidr, ipv4ToInt, validateBodyShape } = _internal;

describe("computeDepth", () => {
  it("returns 0 for a flat object", () => {
    expect(computeDepth({})).toBe(0);
    expect(computeDepth({ a: 1 })).toBe(1);
  });

  it("counts nested object depth", () => {
    expect(computeDepth({ a: { b: { c: 1 } } })).toBe(3);
  });

  it("counts arrays as one level of depth each", () => {
    expect(computeDepth({ a: [{ b: 1 }] })).toBe(3);
  });

  it("handles primitives at the root", () => {
    expect(computeDepth(null)).toBe(0);
    expect(computeDepth("hi")).toBe(0);
    expect(computeDepth(42)).toBe(0);
  });
});

describe("validateBodyShape", () => {
  it("requires a JSON object at top level", () => {
    expect(() => validateBodyShape(null)).toThrow();
    expect(() => validateBodyShape([])).toThrow();
    expect(() => validateBodyShape("hi")).toThrow();
  });

  it("rejects unknown top-level fields", () => {
    expect(() => validateBodyShape({ params: {}, foo: "bar" })).toThrow(/foo/);
  });

  it("accepts canonical body", () => {
    expect(() => validateBodyShape({ params: { x: 1 }, options: {} })).not.toThrow();
    expect(() => validateBodyShape({})).not.toThrow();
    expect(() => validateBodyShape({ params: {} })).not.toThrow();
  });

  it("rejects bodies above max depth", () => {
    let nested = { a: 1 };
    for (let i = 0; i < 20; i++) nested = { x: nested };
    expect(() => validateBodyShape({ params: nested })).toThrow(/depth/);
  });
});

describe("ipv4ToInt", () => {
  it("parses dotted-quad IPv4", () => {
    expect(ipv4ToInt("0.0.0.0")).toBe(0);
    expect(ipv4ToInt("255.255.255.255")).toBe(0xffffffff);
    expect(ipv4ToInt("10.0.0.1")).toBe(0x0a000001);
  });

  it("rejects invalid IPv4", () => {
    expect(ipv4ToInt("256.0.0.0")).toBeNull();
    expect(ipv4ToInt("10.0.0")).toBeNull();
    expect(ipv4ToInt("not an ip")).toBeNull();
  });
});

describe("ipMatchesCidr", () => {
  it("matches identical IPs", () => {
    expect(ipMatchesCidr("10.0.0.1", "10.0.0.1")).toBe(true);
  });

  it("matches CIDR prefixes", () => {
    expect(ipMatchesCidr("10.0.0.42", "10.0.0.0/24")).toBe(true);
    expect(ipMatchesCidr("10.0.1.42", "10.0.0.0/24")).toBe(false);
    expect(ipMatchesCidr("10.255.255.255", "10.0.0.0/8")).toBe(true);
    expect(ipMatchesCidr("11.0.0.0", "10.0.0.0/8")).toBe(false);
  });

  it("/0 matches everything", () => {
    expect(ipMatchesCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
  });

  it("rejects malformed CIDRs", () => {
    expect(ipMatchesCidr("10.0.0.1", "10.0.0.0/abc")).toBe(false);
    expect(ipMatchesCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
  });
});
