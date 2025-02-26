module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'github',
    'implicit-dependencies',
    'import',
    'simple-import-sort',
    'ethereumjs',
  ],
  env: {
    es2020: true,
    node: true,
  },
  ignorePatterns: [
    '.eslintrc.cjs',
    '.eslintrc.js',
    'benchmarks',
    'coverage',
    'dist',
    'node_modules',
    'recipes',
    'rlp.cjs',
    'scripts',
    'typedoc.js',
    'vitest.config.ts',
    'vitest.config.browser.ts',
    'vitest.config.unit.ts',
    'vitest.config.coverage.ts',
    'vite.*.ts',
    'ethereum-tests',
    'archive',
    'devnets',
    'eslint',
    'lint-staged.config.js',
    'tsconfig.lint.json',
    'package.json',
  ],
  extends: [
    'typestrict',
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  rules: {
    'no-restricted-imports': ['error', 'ethereum-cryptography/utils'],
    '@typescript-eslint/consistent-type-imports': 'error',
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
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-redeclare': ['error'],
    '@typescript-eslint/no-unnecessary-condition': 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/restrict-plus-operands': 'off',
    '@typescript-eslint/return-await': 'error',
    '@typescript-eslint/strict-boolean-expressions': ['error'],
    '@typescript-eslint/no-use-before-define': 'warn', // TODO: decide if we care
    eqeqeq: 'error',
    'github/array-foreach': 'error',
    'implicit-dependencies/no-implicit': ['error', { peer: true, dev: true, optional: true }],
    'import/default': 'off',
    'import/export': 'error',
    'import/exports-last': 'off', // TODO: set to `warn` for fixing and then `error`
    'import/extensions': ['error','ignorePackages'],
    'import/first': 'error',
    'import/group-exports': 'off',
    'import/named': 'off',
    'import/namespace': 'off',
    'import/no-absolute-path': 'error',
    'import/no-anonymous-default-export': 'error',
    'import/no-cycle': 'error', 
    'import/no-default-export': ['error'],
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
    'import/order': [
      'error',
      {
        alphabetize: {
          order: 'asc',
        },
        groups: ['object', ['builtin', 'external'], 'parent', 'sibling', 'index', 'type'],
        'newlines-between': 'always',
      },
    ],
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-dupe-class-members': 'off',
    'no-extra-semi': 'off',
    'no-redeclare': 'off',
    'no-unused-vars': 'off',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-const': 'error',
    'simple-import-sort/exports': 'error',
    'sort-imports': ['error', { ignoreDeclarationSort: true }],
    'ethereumjs/noBuffer': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector: "ThrowStatement > NewExpression[callee.name='Error']",
        message: "Throwing default JS Errors is not allowed. Only throw `EthereumJSError` (see the util package)",
      }
    ]
  },
  parserOptions: {
    extraFileExtensions: ['.json'],
    sourceType: 'module',
    project: './config/tsconfig.lint.json',
  },
  overrides: [
    {
      files: ['**/test/**/*.ts', ],
      rules: {
        'implicit-dependencies/no-implicit': 'off',
        'import/no-extraneous-dependencies': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      files: ['**/examples/**/*.ts', '**/examples/**/*.js','**/benchmarks/*.ts'],
      rules: {
        'implicit-dependencies/no-implicit': 'off',
        'import/no-extraneous-dependencies': 'off',
        'no-console': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-restricted-syntax': 'off'
      },
    },
    {
      files: ['packages/statemanager/src/**', 'packages/vm/src/**', ],
      rules: {
        '@typescript-eslint/no-use-before-define': 'off',
        'no-invalid-this': 'off',
      },
    },
    {
      files: ['packages/devp2p/**'],
      rules: {
        'no-redeclare': 'off',
        'no-undef': 'off', // temporary until fixed: 'NodeJS' is not defined
        'no-console': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      files: ['packages/devp2p/src/ext/**'],
      rules: {
        'no-restricted-syntax': 'off'
      },
    },
    {
      files: ['packages/client/src/ext/**'],
      rules: {
        'no-restricted-syntax': 'off'
      },
    },
    {
      files: ['packages/wallet/**'],
      rules: {
        'github/array-foreach': 'warn',
        'no-prototype-builtins': 'warn',
        'no-restricted-syntax': 'off'
      },
    },
    {
      files: ['packages/rlp/**'],
      rules: {
        'no-restricted-syntax': 'off'
      },
    },
  ],
}
