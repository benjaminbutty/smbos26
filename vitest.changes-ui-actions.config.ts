import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/configuration-changes-ui-actions.test.ts",
      "tests/integration/configuration-changes-ui-actions.test.ts",
    ],
    env: {
      SMBOS_CHANGES_UI_ACTIONS_TESTS: "1",
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
});
