import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/configuration-draft-compiler.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    restoreMocks: true,
  },
});
