import { defineConfig } from "vitest/config";

// Two projects so the headless core stays DOM-free (D1) while the React shell gets a real DOM:
//   • core — plain-TS engine (stores, geometry). Node env, no plugins, fast. `*.test.ts`.
//   • dom  — DataGrid component / interaction tests in jsdom. `*.test.tsx`.
// Split by extension so they never overlap. The app's `react()` plugin is intentionally NOT used
// (it triggers a vite-version type clash with the vite vitest bundles); JSX is handled by esbuild's
// automatic runtime instead, which matches the app's `jsx: react-jsx`.
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
        esbuild: { jsx: "automatic" },
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
    },
  },
});
