import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/builder-configuration-proposal.test.ts",
      "tests/integration/builder-configuration-proposal.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
