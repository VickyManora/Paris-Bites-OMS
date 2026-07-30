// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Backend lint rules.
 *
 * The architecture-critical rule is the import boundary at the bottom: it is what
 * stops Clean Architecture from decaying into a folder convention. Without it,
 * the first `import { prisma }` in a use case compiles fine and the dependency
 * rule is silently gone.
 */
export default tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylistic,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Unhandled rejections in a request handler surface as a hung request.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Use the logger, which redacts secrets; console output bypasses that.
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /**
   * Dependency rule enforcement.
   *
   * The domain is the innermost layer: it may not know that Express, Prisma or
   * any other framework exists. This is the boundary that makes the domain
   * testable in isolation and swappable underneath.
   */
  {
    files: ['src/core/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express-*', '@prisma/*', '*/generated/prisma*', 'pino', 'zod'],
              message:
                'The domain layer must not depend on frameworks. Define a port in core/application/ports and implement it in infrastructure/.',
            },
            {
              group: ['**/infrastructure/**', '**/presentation/**'],
              message:
                'Dependencies point inward only: domain must not import from infrastructure or presentation.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express-*', '@prisma/*', '*/generated/prisma*'],
              message:
                'Use cases must depend on ports, not on Express or Prisma. Inject an interface instead.',
            },
            {
              group: ['**/infrastructure/**', '**/presentation/**'],
              message:
                'Dependencies point inward only: the application layer must not import from infrastructure or presentation.',
            },
          ],
        },
      ],
    },
  },
  {
    // The composition root and the seed script must construct concrete classes
    // and legitimately write to stdout.
    files: ['src/main.ts', 'prisma/seed.ts', 'src/infrastructure/container/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      /*
       * In-memory fakes implement Promise-returning port interfaces, so their
       * methods must be `async` even though nothing is awaited. Requiring an
       * await here would mean littering the fakes with `await Promise.resolve()`.
       */
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Generated code is not ours to lint.
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'coverage/**'],
  },
);
