import { defineConfig } from "vitest/config";

// The engine's own tests: the co-located generic tests in src/ (the same files are installed into customer
// projects) plus the installer / canonical-engine regression suites in tests/.
export default defineConfig({
  test: {
    include: ["src/**/*.test.mjs", "tests/**/*.test.mjs"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
