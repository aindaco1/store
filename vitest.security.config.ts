import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/security/**/*.test.ts'],
    testTimeout: 30000, // 30 second timeout for rate limit tests
    hookTimeout: 10000,
    reporters: ['verbose'],
    pool: 'forks', // Use forks for network test isolation
    poolOptions: {
      forks: {
        singleFork: true // Run sequentially to avoid overwhelming the Worker
      }
    }
  },
});
