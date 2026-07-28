import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/configuration-boundary.test.ts",
      "tests/integration/configuration-boundary.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    restoreMocks: true,
  },
});
