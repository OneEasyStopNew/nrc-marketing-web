// ESLint flat config (JS-01): type-aware typescript-eslint rules, React hooks,
// accessibility and TanStack Query. Run with `npm run lint`; CI runs it too.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import query from '@tanstack/eslint-plugin-query';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'e2e-results',
      // Generated from the backend's OpenAPI document (npm run gen:api).
      'src/api/schemas.gen.ts',
      // Local dummy data: git-ignored, never committed.
      'src/mocks/data.ts',
      // The earlier design system, kept for reference only (CLAUDE.md).
      'design-system',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  jsxA11y.flatConfigs.recommended,
  ...query.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      // JS-17: exported functions and components declare their return types.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // JS-26: no floating promises; `void` marks a deliberate fire-and-forget.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // JS-54: sorts of non-strings always get a comparator.
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
      // JS-06: `??` where 0, '' or false are real values. For strings, an empty one
      // usually means "missing" and should fall back, which is what `||` does.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
      // Unused names prefixed with _ are deliberate (e.g. an exhaustiveness check).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-side files: build config, scripts and browser tests.
    files: ['*.{js,mjs,ts}', 'scripts/**', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
  },
  {
    // Plain JavaScript files are not type-checked.
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
