import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: [
      "tests/integration/configuration-rollback.test.ts",
      "tests/integration/manual-amendments.test.ts",
      "tests/integration/manual-questions.test.ts",
      // Builder UI has its own ordered integration project because its Phase
      // 9A acceptance test deliberately applies a configuration version.
      "tests/integration/builder-ui-actions.test.ts",
      "tests/integration/builder-ui-route.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
