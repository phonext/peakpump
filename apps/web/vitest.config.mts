import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest resolves neither Next's "@/" alias nor tsconfig paths on its own, and
// the test files import the modules under test by the same specifier the app
// uses, so the alias is restated here rather than the imports being relative.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
