import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Use forked child processes instead of worker threads so that native
    // addons (better-sqlite3 .node binaries) load under the same security
    // context as a plain `node` invocation.
    pool: 'forks',
  },
});
