// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Lint rules that encode this project's conventions.
 *
 * Anything a reviewer would otherwise have to say twice belongs here — component
 * prefixes, signal usage, template accessibility — so the build enforces it
 * instead of a person.
 */
module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      // Every component and directive selector is namespaced `pb-` / `pb`, so
      // ours are never mistaken for a third-party element.
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'pb', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'pb', style: 'kebab-case' },
      ],

      // OnPush everywhere. With signals there is no reason for default change
      // detection, and mixing the two makes performance unpredictable.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',

      // Signal-first: these push new code toward `input()`/`output()` rather
      // than the decorator forms.
      '@angular-eslint/prefer-signals': 'warn',
      '@angular-eslint/prefer-output-emitter-ref': 'warn',
      '@angular-eslint/no-input-rename': 'error',
      '@angular-eslint/no-output-native': 'error',

      // Constructor injection still works, but `inject()` composes with
      // functional guards and interceptors, so keep the codebase on one style.
      '@angular-eslint/prefer-inject': 'warn',

      // Unused code is a bug or a leftover; either way it should not merge.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `any` erases the type safety the strict tsconfig is buying.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Catches `if (somePromise)` and unawaited calls — a common async bug.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      /*
       * `ignoreStatic` because Angular's `Validators.required` and friends are
       * static and designed to be passed as unbound references — the default
       * setting flags every reactive form in the codebase as a false positive.
       * Unbound *instance* methods remain an error, which is the real hazard.
       */
      '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
  {
    // The one sanctioned place that touches `console`. Everything else logs
    // through LoggerService, which honours the configured level.
    files: ['src/app/core/services/logger.service.ts', 'src/main.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Spec files legitimately need loose typing for stubs and spies.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.angular/**', 'coverage/**'],
  },
);
