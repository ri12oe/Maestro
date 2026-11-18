import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest 4's default exclude is only node_modules and .git, so tsc's
    // dist/ copies of these files were collected too. Restore the old list.
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
    // Use forked child processes instead of worker threads so that native
    // addons (better-sqlite3 .node binaries) load under the same security
    // context as a plain `node` invocation.
    // Vitest 4 removed poolOptions. Fork isolation is the top-level isolate
    // option. It stays on so each file imports db/client.ts again.
    // src/tests/setup.ts sets a private path before that import.
    pool: 'forks',
    isolate: true,
    setupFiles: ['./src/tests/setup.ts'],
    globalSetup: './src/tests/global-setup.ts',
  },
});
