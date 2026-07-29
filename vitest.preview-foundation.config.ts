import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/configuration-preview-foundation.test.ts",
      "tests/runtime-renderers.test.ts",
      "tests/preorder.test.ts",
      "tests/integration/configuration-preview.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
