module.exports = {
  extends: '../../config/eslint.js',
  ignorePatterns: ['examples', 'karma.conf.js', 'test-build'],
  rules: {
    'no-dupe-class-members': 'off',
  },
}
