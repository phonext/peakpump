import { defineConfig } from "vitest/config";

// jsdom rather than the default node environment: Dialog and Toast both portal
// into document.body and return null when there is no document, so a node-env
// suite would report them as passing without having rendered a single node.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
  },
});
