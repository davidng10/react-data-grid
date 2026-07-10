import { defineConfig } from "vitest/config";

// Keep the plain TypeScript core DOM-free while running React tests in jsdom.
//   • core — plain-TS engine (stores, geometry). Node env, no plugins, fast. `*.test.ts`.
//   • dom  — DataGrid component / interaction tests in jsdom. `*.test.tsx`.
// Split by extension so they never overlap. The app's `react()` plugin is intentionally NOT used
// (it triggers a vite-version type clash with the vite vitest bundles); JSX is handled by the
// bundled transform's automatic runtime, matching the app's `jsx: react-jsx`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Measure only the shippable grid's runtime logic — not the tests, the type contract
      // (interfaces erase at compile time), the demo harness, or config.
      include: ["src/data-grid/**"],
      exclude: ["src/data-grid/__tests__/**", "src/data-grid/core/types/**", "**/*.d.ts"],
    },
  },
});
