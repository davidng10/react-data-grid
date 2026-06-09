import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the headless core is plain TS (D1), so its tests run
// DOM-free under Node with no plugins. (Keeping the app's `react()` plugin out also avoids a
// vite-version type clash between vite 8 and the vite that vitest bundles.)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
