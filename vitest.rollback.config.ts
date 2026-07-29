import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/configuration-rollback.test.ts"],
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 120_000,
    restoreMocks: true,
  },
});
