import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/ai-execution.test.ts",
      "tests/ai-accounting.test.ts",
      "tests/ai-context.test.ts",
      "tests/builder-planning.test.ts",
      "tests/integration/builder-planning.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
