import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.js'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
