import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/builder-ui.test.ts",
      "tests/integration/builder-ui-actions.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
