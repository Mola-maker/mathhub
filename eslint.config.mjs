import { defineConfig, globalIgnores } from 'eslint/config';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    // A leading underscore is this codebase's discard marker. It is load-bearing
    // for `const { omitted: _omitted, ...rest }`, the only way to drop a key
    // from an object, so the rule has to recognise it rather than the code
    // working around it.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'dist/**',
    'coverage/**',
    '.claude/**',
    '.superpowers/**',
    'mathhub/**',
    // `npm run build:mathhub` emits the bundled MathHub workspace here. Ignoring
    // only 'mathhub/**' missed it, so every lint run reported thousands of
    // errors against minified generated output.
    'public/mathhub/**',
    'next-env.d.ts',
  ]),
]);
