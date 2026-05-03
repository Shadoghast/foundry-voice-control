import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkAuthBackoff,
  checkKeyRateLimit,
  clearFailedAuth,
  recordFailedAuth,
  _resetForTests,
} from "../scripts/server/rate-limiter.mjs";

describe("per-key rate limit", () => {
  beforeEach(() => {
    _resetForTests();
    globalThis.__resetTestSettings();
    // Tighter limits for faster test logic.
    globalThis.__setTestSetting("foundry-voice-control", "rateLimitReqPerMin", 3);
    globalThis.__setTestSetting("foundry-voice-control", "rateLimitMutationsPerMin", 2);
    globalThis.__setTestSetting("foundry-voice-control", "rateLimitDestructivePerMin", 1);
  });

  it("allows up to the configured request limit per minute", () => {
    expect(checkKeyRateLimit("k", "request").allowed).toBe(true);
    expect(checkKeyRateLimit("k", "request").allowed).toBe(true);
    expect(checkKeyRateLimit("k", "request").allowed).toBe(true);
    const blocked = checkKeyRateLimit("k", "request");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("counts mutations against both request AND mutation budgets", () => {
    expect(checkKeyRateLimit("k", "mutation").allowed).toBe(true);
    expect(checkKeyRateLimit("k", "mutation").allowed).toBe(true);
    // Third mutation hits mutation cap.
    const blocked = checkKeyRateLimit("k", "mutation");
    expect(blocked.allowed).toBe(false);
  });

  it("counts destructive against destructive AND mutation AND request", () => {
    expect(checkKeyRateLimit("k", "destructive").allowed).toBe(true);
    // Second destructive hits the destructive cap of 1.
    const blocked = checkKeyRateLimit("k", "destructive");
    expect(blocked.allowed).toBe(false);
  });

  it("isolates buckets per key", () => {
    for (let i = 0; i < 3; i++) checkKeyRateLimit("k_a", "request");
    expect(checkKeyRateLimit("k_b", "request").allowed).toBe(true);
  });

  it("rolls over after the minute window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-30T10:00:00Z"));
      for (let i = 0; i < 3; i++) checkKeyRateLimit("k", "request");
      expect(checkKeyRateLimit("k", "request").allowed).toBe(false);

      vi.setSystemTime(new Date("2026-04-30T10:01:01Z"));
      expect(checkKeyRateLimit("k", "request").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("per-IP failed-auth backoff", () => {
  beforeEach(() => _resetForTests());

  it("does NOT back off below the threshold", () => {
    for (let i = 0; i < 30; i++) recordFailedAuth("1.2.3.4");
    expect(checkAuthBackoff("1.2.3.4")).toBeNull();
  });

  it("backs off above the threshold with exponential growth", () => {
    for (let i = 0; i < 35; i++) recordFailedAuth("1.2.3.4");
    const result = checkAuthBackoff("1.2.3.4");
    expect(result).not.toBeNull();
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("clearFailedAuth wipes after a successful auth", () => {
    for (let i = 0; i < 35; i++) recordFailedAuth("1.2.3.4");
    expect(checkAuthBackoff("1.2.3.4")).not.toBeNull();
    clearFailedAuth("1.2.3.4");
    expect(checkAuthBackoff("1.2.3.4")).toBeNull();
  });

  it("isolates backoff state per IP", () => {
    for (let i = 0; i < 35; i++) recordFailedAuth("1.2.3.4");
    expect(checkAuthBackoff("5.6.7.8")).toBeNull();
  });
});
