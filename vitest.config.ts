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
          name: "ssr",
          environment: "node",
          include: ["packages/data-griddle/src/**/*.ssr.test.tsx"],
        },
      },
      {
        test: {
          name: "core",
          environment: "node",
          include: ["packages/data-griddle/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          // Preserve grid CSS (including ?raw) for computed-style assertions.
          css: { include: [/grid\.css/] },
          include: ["packages/data-griddle/src/**/*.test.tsx"],
          exclude: ["**/*.ssr.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Measure only the shippable grid's runtime logic — not the tests, the type contract
      // (interfaces erase at compile time), the demo harness, or config.
      include: ["packages/data-griddle/src/**"],
      exclude: [
        "packages/data-griddle/src/__tests__/**",
        "packages/data-griddle/src/core/types/**",
        "**/*.d.ts",
      ],
    },
  },
});
