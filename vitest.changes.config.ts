import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/configuration-changes.test.ts",
      "tests/integration/configuration-changes.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
