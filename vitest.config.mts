import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // `tsconfig.json` sets `jsx: "preserve"` because Next compiles JSX itself,
  // which leaves vitest's esbuild passing JSX through untouched and failing to
  // parse any `.tsx` it imports. Transforming it here (test-time only, no
  // effect on the app build) is what lets a test render a component.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
