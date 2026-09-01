import importPlugin from 'eslint-plugin-import';
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['**/node_modules/**', 'app/out/**', 'app/release/**', 'app/.external/**'],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          destructuredArrayIgnorePattern: '.',
          ignoreRestSiblings: false,
        },
      ],
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
];
