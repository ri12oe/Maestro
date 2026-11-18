import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Use forked child processes instead of worker threads so that native
    // addons (better-sqlite3 .node binaries) load under the same security
    // context as a plain `node` invocation.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Re-import each file so db/client.ts opens DB_PATH again.
        // src/tests/setup.ts sets a private path before that import.
        isolate: true,
      },
    },
    setupFiles: ['./src/tests/setup.ts'],
    globalSetup: './src/tests/global-setup.ts',
  },
});
