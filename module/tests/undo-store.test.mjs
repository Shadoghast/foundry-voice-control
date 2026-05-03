import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  capture,
  consume,
  peek,
  recordUndo,
  sweepExpired,
  _resetForTests,
  _stateForTests,
} from "../scripts/server/undo-store.mjs";

describe("undo store", () => {
  beforeEach(() => _resetForTests());

  it("capture returns a token; peek returns the snapshot; consume removes it", () => {
    const token = capture({
      keyId: "key_1",
      tool: "delete_actor",
      scopeRequired: "gm",
      payload: { type: "delete_actor", actor_data: { _id: "a", name: "Bob" } },
    });
    expect(token).toMatch(/^undo_/);

    const snap = peek(token);
    expect(snap).toBeTruthy();
    expect(snap.tool).toBe("delete_actor");

    const consumed = consume(token);
    expect(consumed).toBeTruthy();
    expect(peek(token)).toBeNull();
  });

  it("is one-shot — consume twice returns null the second time", () => {
    const t = capture({
      keyId: "k",
      tool: "activate_scene",
      scopeRequired: "scene",
      payload: { type: "activate_scene", previous_scene_id: "s" },
    });
    expect(consume(t)).toBeTruthy();
    expect(consume(t)).toBeNull();
  });

  it("evicts oldest when a key exceeds 50 snapshots", () => {
    const tokens = [];
    for (let i = 0; i < 51; i++) {
      tokens.push(
        capture({
          keyId: "key_evict",
          tool: "set_actor_image",
          scopeRequired: "actor-write",
          payload: { type: "set_actor_image", actor_id: `a${i}`, previous_img: "x" },
        }),
      );
    }
    // First token should be evicted.
    expect(peek(tokens[0])).toBeNull();
    // Last token should remain.
    expect(peek(tokens[tokens.length - 1])).toBeTruthy();

    const state = _stateForTests();
    expect(state.tokensByKey.get("key_evict").length).toBe(50);
  });

  it("does not evict across keys — each key has its own 50 cap", () => {
    const ka = capture({
      keyId: "k_a",
      tool: "x",
      scopeRequired: "read",
      payload: { type: "x" },
    });
    for (let i = 0; i < 50; i++) {
      capture({
        keyId: "k_b",
        tool: "x",
        scopeRequired: "read",
        payload: { type: "x" },
      });
    }
    expect(peek(ka)).toBeTruthy();
  });

  it("expires snapshots after 1 hour", () => {
    vi.useFakeTimers();
    try {
      const start = new Date("2026-04-30T10:00:00Z").getTime();
      vi.setSystemTime(start);

      const t = capture({
        keyId: "k",
        tool: "activate_scene",
        scopeRequired: "scene",
        payload: { type: "activate_scene", previous_scene_id: null },
      });

      vi.setSystemTime(start + 59 * 60 * 1000);
      expect(peek(t)).toBeTruthy();

      vi.setSystemTime(start + 61 * 60 * 1000);
      sweepExpired();
      expect(peek(t)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recordUndo wraps capture from a ctx", () => {
    const t = recordUndo(
      { key: { id: "key_via_ctx" } },
      {
        tool: "create_actor",
        scopeRequired: "actor-write",
        clientRequired: false,
        payload: { type: "create_actor", actor_id: "abc" },
      },
    );
    const snap = peek(t);
    expect(snap.key_id).toBe("key_via_ctx");
  });
});
