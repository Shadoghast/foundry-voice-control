import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth, audit-log, and systems registry so we don't need the real
// implementations (which touch disk and Foundry globals).
vi.mock("../scripts/server/auth.mjs", () => ({
  SCOPE_PRESETS: { operator: ["read", "scene"], readonly: ["read"], gm: ["gm"] },
  SCOPES: { READ: "read", SCENE: "scene", ACTOR_WRITE: "actor-write", ROLL: "roll", GM: "gm" },
  issueKey: vi.fn(async () => ({ rawValue: "fvc_test", metadata: { id: "key_x" } })),
  listKeys: vi.fn(() => []),
  revokeKey: vi.fn(async () => true),
  revokeAll: vi.fn(async () => 0),
  rotateKey: vi.fn(async () => ({ rawValue: "fvc_rotated", metadata: { id: "key_new" } })),
}));
vi.mock("../scripts/server/audit-log.mjs", () => ({
  readAuditEntries: vi.fn(async () => []),
}));
vi.mock("../scripts/server/systems/registry.mjs", () => ({
  listSupportedSystems: vi.fn(() => ["whtow"]),
}));

// Capture emitted replies for assertion.
const emitted = [];
vi.mock("../scripts/server/socket-integration.mjs", () => ({
  emitToUser: (userId, payload) => emitted.push({ userId, payload }),
}));

// gm-presence — the real module, but we'll seed its in-memory state.
import {
  recordOnline,
  _resetForTests as resetPresence,
} from "../scripts/server/gm-presence.mjs";
import { handleAdminRequest } from "../scripts/server/admin-handler.mjs";

beforeEach(() => {
  emitted.length = 0;
  resetPresence();
  // Seed game.users with a known GM and a non-GM player.
  globalThis.game.users = new Map([
    ["gm_alice", { id: "gm_alice", name: "Alice", role: 4 }],     // GAMEMASTER
    ["player_carl", { id: "player_carl", name: "Carl", role: 1 }], // PLAYER
  ]);
});

describe("admin handler authorization", () => {
  it("accepts a request from an authenticated GM in the presence list", async () => {
    recordOnline({ userId: "gm_alice", userName: "Alice", socketId: "s1" });

    await handleAdminRequest(
      { request_id: "r1", user_id: "gm_alice", action: "status" },
      { socketId: "s1", authUserId: "gm_alice" },
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].userId).toBe("gm_alice");
    expect(emitted[0].payload.ok).toBe(true);
  });

  it("rejects when the payload user_id mismatches the socket-authenticated user", async () => {
    recordOnline({ userId: "gm_alice", userName: "Alice", socketId: "s1" });

    await handleAdminRequest(
      { request_id: "r2", user_id: "gm_alice", action: "key:list" },
      { socketId: "s_player", authUserId: "player_carl" },
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].userId).toBe("player_carl"); // reply goes to the AUTH user, not the spoof
    expect(emitted[0].payload.ok).toBe(false);
    expect(emitted[0].payload.error).toMatch(/mismatch/i);
  });

  it("rejects when the user is not a connected GM", async () => {
    // Carl is online but not in the presence list (and not a GM in the world).
    await handleAdminRequest(
      { request_id: "r3", user_id: "player_carl", action: "key:list" },
      { socketId: "s_player", authUserId: "player_carl" },
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].payload.ok).toBe(false);
    expect(emitted[0].payload.error).toMatch(/GM/i);
  });

  it("rejects when the user is in presence list but NOT GM-role in the world (defense in depth)", async () => {
    // Pretend a player somehow registered themselves into the presence list.
    recordOnline({ userId: "player_carl", userName: "Carl", socketId: "s_player" });

    await handleAdminRequest(
      { request_id: "r4", user_id: "player_carl", action: "key:list" },
      { socketId: "s_player", authUserId: "player_carl" },
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].payload.ok).toBe(false);
    expect(emitted[0].payload.error).toMatch(/GM/i);
  });

  it("falls back to payload-trust when authUserId is missing (with warning logged)", async () => {
    // No authUserId in meta — extractAuthUserId() returned null.
    recordOnline({ userId: "gm_alice", userName: "Alice", socketId: "s1" });

    await handleAdminRequest(
      { request_id: "r5", user_id: "gm_alice", action: "status" },
      { socketId: "s1" /* authUserId omitted */ },
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].payload.ok).toBe(true);
  });

  it("rejects when neither auth nor claimed userId is present", async () => {
    await handleAdminRequest(
      { request_id: "r6", action: "status" },
      { socketId: "s1" },
    );

    // No userId means we can't even emit a targeted reply.
    expect(emitted.length).toBe(0);
  });

  it("accepts assistant-GM role (role 3) for admin commands", async () => {
    globalThis.game.users.set("agm", { id: "agm", name: "Asst", role: 3 });
    recordOnline({ userId: "agm", userName: "Asst", socketId: "s_agm" });

    await handleAdminRequest(
      { request_id: "r7", user_id: "agm", action: "status" },
      { socketId: "s_agm", authUserId: "agm" },
    );

    expect(emitted[0].payload.ok).toBe(true);
  });
});
