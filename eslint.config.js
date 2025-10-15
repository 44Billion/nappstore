import neostandard from 'neostandard'
import globals from 'globals'
import html from 'eslint-plugin-html'

export default [
  ...neostandard({
    // options
  }), {
    files: ['**/*.js', '**/*.html'],
    plugins: { html },
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    rules: {
      '@stylistic/comma-dangle': ['error', 'never'], // @stylistic/js/... isn't supported by neostandard yet
      '@stylistic/lines-between-class-members': 'off',
      '@stylistic/object-property-newline': 'off',
      'import/no-anonymous-default-export': 'off',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_$' }
      ]
    },
    ignores: [
      '.history',
      'dist',
      'node_modules'
    ]
  }
]
