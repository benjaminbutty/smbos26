import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/openai-provider.test.ts",
      "tests/integration/builder-planning.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
