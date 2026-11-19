import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // verify runs the real SDKs under a fetch mock; give slow machines room
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
