import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/builder-ui.test.ts",
      "tests/integration/builder-record-creation.test.ts",
      "tests/integration/builder-ui-actions.test.ts",
      "tests/integration/builder-ui-route.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
