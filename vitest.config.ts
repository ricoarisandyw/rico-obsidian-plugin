import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    alias: {
      obsidian: path.resolve(__dirname, "./tests/mocks/obsidian.ts"),
    },
  },
});
