import { configDefaults, defineConfig } from "vitest/config";

// Tests that drive a real Chrome run alone, after everything else: a Chrome sharing the
// runner with the ffmpeg tests got starved past vitest's hook limit on 4-core Windows.
const BROWSER_TESTS = "src/**/*.browser.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, BROWSER_TESTS],
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: [BROWSER_TESTS],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
