module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'implicit-dependencies',
    'import',
    'prettier',
    'simple-import-sort',
  ],
  env: {
    es2020: true,
    node: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    'prettier.config.js',
    'typedoc.js',
    'karma.conf.js',
  ],
  extends: [
    'typestrict',
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  rules: {
    'no-console': 'warn',
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'implicit-dependencies/no-implicit': ['error', { peer: true, dev: true, optional: true }],
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/no-use-before-define': 'error',
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'interface',
        format: ['PascalCase', 'camelCase'],
        custom: {
          regex: '^I[A-Z]',
          match: false,
        },
      },
    ],
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-unnecessary-condition': 'off',
    'no-dupe-class-members': 'off',
    'no-extra-semi': 'off',
    'prettier/prettier': 'error',
    'no-redeclare': 'off',
    '@typescript-eslint/no-redeclare': ['error'],
    '@typescript-eslint/restrict-plus-operands': 'off',
    'import/no-default-export' : ['error'],
    '@typescript-eslint/strict-boolean-expressions': ['error'],
    'simple-import-sort/exports': 'error',
    'import/default': 'error',
    'import/export': 'error',
    'import/exports-last': 'off', // TODO: set to `warn` for fixing and then `error`
    'import/extensions': 'off',
    'import/first': 'error',
    'import/group-exports': 'off',
    'import/named': 'error',
    'import/namespace': 'error',
    'import/no-absolute-path': 'error',
    'import/no-anonymous-default-export': 'error',
    'import/no-cycle': 'off', // TODO: set to `warn` for fixing and then `error`
    'import/no-deprecated': 'off', // TODO: set to `warn` for fixing and then `error`
    'import/no-duplicates': 'error',
    'import/no-dynamic-require': 'off',
    'import/no-extraneous-dependencies': 'error',
    'import/no-mutable-exports': 'error',
    'import/no-namespace': 'off',
    'import/no-self-import': 'error',
    'import/no-unresolved': 'off',
    'import/no-unused-modules': 'error',
    'import/no-useless-path-segments': 'error',
    'import/no-webpack-loader-syntax': 'error',
    'import/order': 'error',
  },
  parserOptions: {
    sourceType: 'module',
    project: './tsconfig.json',
  },
}
