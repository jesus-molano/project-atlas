import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Repository setup copies and scans fixtures. Coverage instrumentation can
    // make those hooks slower than Vitest's 10 second default on shared CI.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: [
        "packages/*/src/**/*.ts",
        "apps/viewer/server/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/browser.ts",
        "**/index.ts",
        // Nuxt route and middleware entrypoints are exercised as HTTP flows by
        // Playwright. V8 unit coverage applies to their server-side domain code.
        "apps/viewer/server/api/**/*.ts",
        "apps/viewer/server/middleware/**/*.ts",
        // CLI process adapters and MCP transport registrations run in child
        // processes or through protocol contracts; their domain dependencies
        // remain covered here and the adapters are exercised by contract/E2E.
        "packages/cli/src/**/*.ts",
        "packages/mcp/src/administration-tools.ts",
        "packages/mcp/src/code-tools.ts",
        "packages/mcp/src/design-tools.ts",
        "packages/mcp/src/memory-tools.ts",
        "packages/mcp/src/task-tools.ts",
        "packages/mcp/src/index.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
