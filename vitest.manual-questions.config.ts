import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/manual-questions.test.ts",
      "tests/integration/manual-questions.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
