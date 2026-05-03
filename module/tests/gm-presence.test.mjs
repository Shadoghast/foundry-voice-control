import { describe, it, expect, beforeEach } from "vitest";
import {
  isAnyGmConnected,
  isUserConnectedGm,
  listConnectedGms,
  pickGm,
  recordOfflineByUser,
  recordOfflineBySocket,
  recordOnline,
  _resetForTests,
} from "../scripts/server/gm-presence.mjs";

beforeEach(() => _resetForTests());

describe("recordOnline / pickGm", () => {
  it("records an online GM and pickGm returns it", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s1" });
    expect(isAnyGmConnected()).toBe(true);
    expect(isUserConnectedGm("u1")).toBe(true);
    const picked = pickGm();
    expect(picked.userId).toBe("u1");
    expect(picked.name).toBe("Alice");
  });

  it("first-connected wins when multiple GMs are online", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s1" });
    recordOnline({ userId: "u2", userName: "Bob", socketId: "s2" });
    expect(pickGm().userId).toBe("u1");
  });

  it("ignores entries without a userId", () => {
    recordOnline({ userName: "Ghost", socketId: "s9" });
    expect(isAnyGmConnected()).toBe(false);
  });
});

describe("disconnect handling", () => {
  it("recordOfflineByUser cleans up the entry", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s1" });
    expect(recordOfflineByUser("u1")).toBe(true);
    expect(isUserConnectedGm("u1")).toBe(false);
    expect(pickGm()).toBeNull();
  });

  it("recordOfflineByUser is a no-op for unknown user", () => {
    expect(recordOfflineByUser("nobody")).toBe(false);
  });

  it("recordOfflineBySocket finds and removes by socket id", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s1" });
    recordOnline({ userId: "u2", userName: "Bob", socketId: "s2" });
    expect(recordOfflineBySocket("s1")).toBe(true);
    expect(isUserConnectedGm("u1")).toBe(false);
    expect(isUserConnectedGm("u2")).toBe(true);
    // pickGm should now return Bob.
    expect(pickGm().userId).toBe("u2");
  });
});

describe("reconnect race", () => {
  it("a user reconnecting on a new socket replaces the old entry", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s_old" });
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s_new" });
    // Old socket's reverse-map entry should be gone, so disconnecting the
    // old socket does NOT take Alice offline.
    expect(recordOfflineBySocket("s_old")).toBe(false);
    expect(isUserConnectedGm("u1")).toBe(true);
    // Disconnecting the new socket DOES.
    expect(recordOfflineBySocket("s_new")).toBe(true);
    expect(isUserConnectedGm("u1")).toBe(false);
  });
});

describe("listConnectedGms", () => {
  it("returns public-safe metadata for each connected GM", () => {
    recordOnline({ userId: "u1", userName: "Alice", socketId: "s1" });
    recordOnline({ userId: "u2", userName: "Bob", socketId: "s2" });
    const list = listConnectedGms();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ user_id: "u1", user_name: "Alice" });
    expect(list[0].connected_at).toBeTruthy();
    // No socketId leakage.
    expect(list[0]).not.toHaveProperty("socket_id");
  });
});
