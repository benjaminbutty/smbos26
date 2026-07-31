import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: [
      "tests/integration/configuration-rollback.test.ts",
      "tests/integration/manual-amendments.test.ts",
      "tests/integration/manual-questions.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
