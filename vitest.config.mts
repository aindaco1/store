import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup/browser-env.ts'],
    include: ['tests/unit/**/*.test.ts'],
    maxWorkers: 4,
    testTimeout: 30000,
    hookTimeout: 15000,
    coverage: {
      reporter: ['text', 'html'],
      include: ['assets/js/**/*.js'],
    },
  },
});
