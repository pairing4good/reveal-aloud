#!/usr/bin/env node
/**
 * Stands in for the real macOS `say` binary in tests, since this sandbox has no such binary to
 * run against. It honours the same two invocations `bin/say-server.js` makes:
 *
 *   fake-say.js -v ?                       — prints a voice list in `say`'s own format
 *   fake-say.js [-v NAME] -r RATE "text"   — "speaks": sleeps, then exits 0
 *   fake-say.js ... -o OUT.wav ...         — "renders": writes a real WAV, exits immediately
 *
 * FAKE_SAY_SPEAK_MS controls how long "speaking" takes, so a test can call /stop mid-utterance
 * and prove the underlying process really was killed rather than merely abandoned.
 * FAKE_SAY_EXIT_CODE lets a test simulate `say` itself failing.
 *
 * The `-o` branch writes a genuine, parseable WAV whose length is derived deterministically from
 * the text and any [[slnc N]] markers in it, at the rate `-r` asks for. That is what lets the
 * exporter's duration and concatenation logic be tested end to end on a machine with no `say`.
 */

import { writeFileSync } from 'node:fs';

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

const outIndex = args.indexOf('-o');
if (outIndex !== -1 && exitCode === 0) {
  writeFileSync(args[outIndex + 1], renderWav());
  process.exit(0);
}

setTimeout(() => process.exit(exitCode), delay);

/**
 * A WAV whose duration is a deterministic function of the input, so tests can assert on
 * durations without hardcoding whatever the real synthesiser happens to produce.
 *
 * Speech is modelled as 60ms per character at rate 1, scaled by the words-per-minute `-r` asks
 * for; [[slnc N]] markers contribute exactly N milliseconds of true silence, which is what lets
 * a test verify that padding lands in the file. Speech samples are non-zero so silence
 * detection has something to find.
 */
function renderWav() {
  const text = args.at(-1) ?? '';
  const rateIndex = args.indexOf('-r');
  const wpm = rateIndex === -1 ? 175 : Number(args[rateIndex + 1]);
  const sampleRate = Number(/--data-format=LEI16@(\d+)/.exec(args.join(' '))?.[1] ?? 22050);

  // Split into silence markers and the speech between them, preserving order.
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[\[slnc (\d+)\]\]/g)) {
    const spoken = text.slice(cursor, match.index).trim();
    if (spoken) segments.push({ silent: false, ms: spoken.length * 60 * (175 / wpm) });
    segments.push({ silent: true, ms: Number(match[1]) });
    cursor = match.index + match[0].length;
  }
  const trailing = text.slice(cursor).trim();
  if (trailing) segments.push({ silent: false, ms: trailing.length * 60 * (175 / wpm) });

  const frames = segments.map((segment) => ({
    silent: segment.silent,
    count: Math.round((segment.ms / 1000) * sampleRate)
  }));
  const total = frames.reduce((n, segment) => n + segment.count, 0);

  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + total * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(total * 2, 40);

  let offset = 44;
  for (const segment of frames) {
    for (let i = 0; i < segment.count; i++) {
      // A steady tone rather than a constant, so it looks like signal to silence detection.
      buffer.writeInt16LE(segment.silent ? 0 : Math.round(12000 * Math.sin(i / 8)), offset);
      offset += 2;
    }
  }
  return buffer;
}
