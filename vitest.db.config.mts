import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The database-backed suite.
 *
 * It is a second config on purpose: `npm test` / `npx vitest run` must stay
 * runnable on a checkout with no PostgreSQL, so the default config only includes
 * `src/**`. These tests need a real server with the migrations applied — CI runs
 * them against the `postgres` service container (see `.github/workflows/ci.yml`,
 * `database` job).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // One database with `TRUNCATE` between suites: never two files at once.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
