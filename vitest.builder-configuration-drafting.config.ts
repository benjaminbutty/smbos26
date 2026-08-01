import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/builder-configuration-drafting.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    restoreMocks: true,
  },
});
