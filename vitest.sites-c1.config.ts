import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/sites-c1-foundation.integration.ts",
      "tests/sites-c2-functional.integration.ts",
      "tests/sites-c3-forms-sql.integration.ts",
      "tests/sites-c3-uploads-sql.integration.ts",
      "tests/sites-operational-route.test.ts",
      "tests/sites-operational-sql.integration.ts",
    ],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
