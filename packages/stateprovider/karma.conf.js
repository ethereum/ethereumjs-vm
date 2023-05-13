module.exports = function (config) {
  config.set({
    frameworks: ['karma-typescript', 'tap'],

    // list of files / patterns to load in the browser
    files: ['./src/**/*.ts', './test/**/*.ts'],

    // list of files / patterns to exclude
    exclude: [],

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://www.npmjs.com/browse/keyword/karma-preprocessor

    preprocessors: {
      '**/*.ts': ['karma-typescript'],
    },
    karmaTypescriptConfig: {
      tsconfig: './tsconfig.json',
      bundlerOptions: {
        entrypoints: /\.spec\.ts$/,
        acornOptions: {
          ecmaVersion: 11,
        },
        resolve: {
          alias: {
            'bigint-crypto-utils': '../../node_modules/bigint-crypto-utils/dist/bundles/umd.js',
          },
        },
      },
    },
    reporters: ['dots'],
    browsers: ['FirefoxHeadless', 'ChromeHeadless'],
    singleRun: true,
    concurrency: 1,

    browserDisconnectTimeout: 100000,
    browserNoActivityTimeout: 100000,
  })
}
