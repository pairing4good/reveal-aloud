import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit + property + adapter tests. The e2e suite has its own config because it
    // needs a real browser and a built bundle.
    include: ['test/{core,adapters,property}/**/*.test.js'],
    environment: 'node',
    environmentMatchGlobs: [['test/adapters/**', 'jsdom']]
  }
});
