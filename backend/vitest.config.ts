import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    /*
     * Integration tests hit a real database, so they must not run concurrently
     * against a shared schema. Unit tests are pure and unaffected either way.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      // The layers worth covering. Generated code, wiring and the entrypoint are
      // excluded: asserting on a DI container mostly re-states it.
      include: ['src/core/**/*.ts', 'src/shared/**/*.ts', 'src/presentation/**/*.ts'],
      exclude: ['src/generated/**', 'src/**/index.ts', '**/*.d.ts'],
    },
  },
});
