import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit + property + adapter tests. The e2e suite has its own config because it
    // needs a real browser and a built bundle.
    include: ['test/{core,app,adapters,property,server}/**/*.test.js'],
    // Node by default; the three adapter suites that need a DOM ask for jsdom themselves
    // with an `@vitest-environment jsdom` directive, so each file states its own needs.
    environment: 'node'
  }
});
