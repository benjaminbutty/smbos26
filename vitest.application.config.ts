import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/configuration-changes.test.ts"],
    testNamePattern: /\[application\]/,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    restoreMocks: true,
  },
});
