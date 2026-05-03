/**
 * Vitest global setup — provides the minimal Foundry-side stubs the module
 * code reads at import time, so we can unit-test pure logic in plain Node.
 *
 * Per-test stubs and overrides go inside the individual specs via
 * vi.spyOn() / vi.fn().
 */

import { vi } from "vitest";

// Settings are read by audit-log, image-validation, rate-limiter on every
// call. Default to empty / falsy; specs override per-key as needed.
const settingsStore = new Map();

globalThis.game = {
  settings: {
    register: vi.fn(),
    get: vi.fn((moduleId, key) => settingsStore.get(`${moduleId}:${key}`) ?? ""),
    set: vi.fn(async (moduleId, key, value) => {
      settingsStore.set(`${moduleId}:${key}`, value);
    }),
  },
  user: { id: "test_gm", name: "Test GM", isGM: true },
  users: new Map(),
  system: { id: "test", version: "0.0.1", documentTypes: { Actor: {}, Item: {} } },
  actors: new Map(),
  scenes: new Map(),
  packs: new Map(),
  combat: null,
  modules: new Map(),
  release: { generation: 14 },
  version: "14.0.0",
};

globalThis.Hooks = {
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  call: vi.fn(),
  callAll: vi.fn(),
};

// Helpers for specs.
globalThis.__resetTestSettings = () => settingsStore.clear();
globalThis.__setTestSetting = (moduleId, key, value) => {
  settingsStore.set(`${moduleId}:${key}`, value);
};
