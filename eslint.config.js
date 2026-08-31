import js from '@eslint/js';
import globals from 'globals';

/**
 * The architectural boundary of this project is enforced here, not just documented.
 *
 * `src/core/` is the pure hexagon: total functions over plain data. If a core module
 * ever reaches for the browser, the clock, or reveal.js, the build fails. That is what
 * keeps the core testable without a DOM, without audio, and without waiting on timers.
 */
const forbiddenInCore = [
  { name: 'window', message: 'src/core must stay pure — take this from an adapter instead.' },
  { name: 'document', message: 'src/core must stay pure — the DOM belongs in src/adapters.' },
  { name: 'navigator', message: 'src/core must stay pure — the DOM belongs in src/adapters.' },
  { name: 'speechSynthesis', message: 'src/core must stay pure — speech belongs behind SpeechPort.' },
  { name: 'SpeechSynthesisUtterance', message: 'src/core must stay pure — speech belongs behind SpeechPort.' },
  { name: 'localStorage', message: 'src/core must stay pure — storage belongs in src/adapters.' },
  { name: 'setTimeout', message: 'src/core must stay pure — timers belong behind ClockPort.' },
  { name: 'setInterval', message: 'src/core must stay pure — timers belong behind ClockPort.' },
  { name: 'Date', message: 'src/core must stay pure — time belongs behind ClockPort.' },
  { name: 'Reveal', message: 'src/core must not know about reveal.js — that is the adapter’s job.' },
  { name: 'console', message: 'src/core must stay pure — report through a returned value instead.' }
];

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always']
    }
  },
  {
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-globals': ['error', ...forbiddenInCore],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'src/core must stay deterministic.' }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../adapters/*', '../app/*', '**/adapters/*', '**/app/*'],
              message: 'Dependencies point inward: the core may not import an adapter.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['test/**/*.js', 'build.js', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    // The demo page loads these as plain scripts, so its entry point looks unused here.
    files: ['demo/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^annotateDeck$' }] }
  }
];
