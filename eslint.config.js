import tseslint from 'typescript-eslint';

// Layering: sim is pure; net may use sim; render/game/ui/platform sit above.
const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
});

export default tseslint.config(
  { ignores: ['dist', 'release', 'node_modules', 'assets-src', 'playwright-report', 'test-results'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'always'],
    },
  },
  // Sandboxed Electron preload scripts must be CommonJS.
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['src/sim/**'],
    rules: restrict(
      [
        'three',
        'three/*',
        'preact',
        'preact/*',
        '@preact/*',
        'electron',
        'node:*',
        '**/net/**',
        '**/render/**',
        '**/game/**',
        '**/ui/**',
        '**/platform/**',
        '**/workers/**',
      ],
      'src/sim is pure simulation: no engine, DOM, Node or upper-layer imports.',
    ),
  },
  {
    files: ['src/net/**'],
    rules: restrict(
      ['three', 'three/*', 'preact', 'preact/*', '@preact/*', '**/render/**', '**/game/**', '**/ui/**'],
      'src/net may depend only on src/sim.',
    ),
  },
  {
    files: ['src/render/**'],
    rules: restrict(['preact', 'preact/*', '@preact/*', '**/ui/**'], 'src/render must not depend on UI.'),
  },
);
