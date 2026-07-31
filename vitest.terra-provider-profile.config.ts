import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/terra-provider-profile.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    restoreMocks: true,
  },
});
