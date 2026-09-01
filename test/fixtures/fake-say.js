#!/usr/bin/env node
/**
 * Stands in for the real macOS `say` binary in tests, since this sandbox has no such binary to
 * run against. It honours the same two invocations `bin/say-server.js` makes:
 *
 *   fake-say.js -v ?                       — prints a voice list in `say`'s own format
 *   fake-say.js [-v NAME] -r RATE "text"   — "speaks": sleeps, then exits 0
 *
 * FAKE_SAY_SPEAK_MS controls how long "speaking" takes, so a test can call /stop mid-utterance
 * and prove the underlying process really was killed rather than merely abandoned.
 * FAKE_SAY_EXIT_CODE lets a test simulate `say` itself failing.
 */

const args = process.argv.slice(2);

if (args[0] === '-v' && args[1] === '?') {
  process.stdout.write(
    [
      'Alex                en_US   # Most people recognize me by my voice.',
      'Ava (Premium)       en_US   # Hello, my name is Ava.',
      'Daniel              en_GB   # Hello, my name is Daniel.',
      'Amelie              fr_FR   # Bonjour, je m’appelle Amelie.'
    ].join('\n') + '\n'
  );
  process.exit(0);
}

const delay = Number(process.env.FAKE_SAY_SPEAK_MS ?? 20);
const exitCode = Number(process.env.FAKE_SAY_EXIT_CODE ?? 0);

setTimeout(() => process.exit(exitCode), delay);
