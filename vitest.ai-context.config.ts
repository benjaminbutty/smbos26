import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/ai-context.test.ts",
      "tests/integration/ai-context.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
