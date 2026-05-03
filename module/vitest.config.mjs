import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.mjs"],
    globals: false,
    testTimeout: 5000,
    include: ["tests/**/*.test.mjs"],
  },
});
