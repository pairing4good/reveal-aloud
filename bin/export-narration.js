#!/usr/bin/env node
/**
 * Renders a deck's speaker notes to audio files you can drop into a video editor.
 *
 * The problem this solves: you screen-record a deck, and now you need the narration as a track
 * you can line up against it. Recording the playback is the obvious approach and the worse one —
 * with the `say` engine the audio never even reaches the browser tab. Rendering offline instead
 * is lossless, repeatable, and much faster than sitting through the talk.
 *
 *   reveal-aloud-export deck.html --engine kokoro --voice af_heart
 *   reveal-aloud-export --list-voices say
 *
 * Output is one WAV per slide, a manifest of durations and timeline offsets, a CSV of the same,
 * and a single concatenated track.
 */

import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { exportNarration } from '../src/app/export-narration.js';
import {
  DEFAULT_KOKORO_DTYPE,
  DEFAULT_KOKORO_MODEL,
  createKokoroRenderer
} from '../src/adapters/kokoro-renderer.js';
import { createPlaywrightSource } from '../src/adapters/playwright-deck.js';
import { createSayRenderer } from '../src/adapters/say-renderer.js';
import { DEFAULT_KOKORO_VOICE, gradeRank } from '../src/core/kokoro-voices.js';

const BUNDLE = fileURLToPath(new URL('../dist/reveal-aloud.js', import.meta.url));

const USAGE = `
  reveal-aloud-export <deck.html|url> [options]

  Renders each slide's speaker notes to a WAV file, plus a manifest of durations and
  timeline offsets for lining the audio up with a screen recording.

  Engine
    --engine <say|kokoro>    default: kokoro
    --voice <id|name>        default: ${DEFAULT_KOKORO_VOICE} (kokoro) / your System Voice (say)
    --rate <n>               1 is normal, 0.5 half speed, 2 double. default: 1
    --list-voices [engine]   print every available voice, best first, and exit
    --sample [text]          render one clip with the chosen voice and exit

  Kokoro
    --dtype <fp32|fp16|q8>   default: ${DEFAULT_KOKORO_DTYPE} (highest quality; ~310MB one-time download)
    --model <id>             default: ${DEFAULT_KOKORO_MODEL}
    --cache-dir <path>       where the model is kept. default: ~/.cache/reveal-aloud/models

  Output
    --out <dir>              default: ./narration
    --sample-rate <hz>       say only. default: 48000
    --gap <sec>              silence between slides in the master track. default: 0.5
    --chunk-gap <ms>         silence between sentences. default: 300
    --lead <ms>              silence before the first word. default: 0
    --tail <ms>              silence after the last word. default: 0
    --no-concat              skip narration-full.wav
    --no-analyze             skip measuring where speech starts in each clip

  Choosing slides
    --slides 3-7,12          render only these (1-based); reuse existing files for the rest
    --dry-run                extract notes and write the manifest, render no audio

  Other
    --timeout <ms>           how long to wait for the deck to load. default: 15000
    -h, --help

  Web Speech API decks cannot be exported: browsers expose no way to capture synthesized
  speech to a file. Export with say or kokoro instead.
`;

const FLAGS_WITH_VALUES = new Set([
  '--engine', '--voice', '--rate', '--dtype', '--model', '--cache-dir', '--out',
  '--sample-rate', '--gap', '--chunk-gap', '--lead', '--tail', '--slides', '--timeout'
]);

const BOOLEAN_FLAGS = new Set(['--dry-run']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS_WITH_VALUES.has(arg)) {
      args[arg.slice(2)] = argv[++i];
    } else if (BOOLEAN_FLAGS.has(arg)) {
      args[arg.slice(2)] = true;
    } else if (arg === '--list-voices' || arg === '--sample') {
      // Both take an optional value, so only consume the next token if it is not a flag.
      const next = argv[i + 1];
      args[arg.slice(2)] = next && !next.startsWith('-') ? argv[++i] : true;
    } else if (arg.startsWith('--no-')) {
      args[arg.slice(5)] = false;
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}. Run --help to see what is available.`);
    } else {
      args._.push(arg);
    }
  }
  return args;
}

/**
 * A numeric flag, validated rather than coerced.
 *
 * `Number('abc')` is NaN, and a NaN flowing into the timeline arithmetic writes a manifest whose
 * offsets all serialize as `null` — the exporter silently producing exactly the thing it exists
 * to produce correctly. Better to stop at the argument.
 */
function num(args, flag, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = args[flag];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${flag} needs a number, not "${raw}".`);
  if (value < min || value > max) {
    throw new Error(`--${flag} must be between ${min} and ${max} (got ${value}).`);
  }
  return value;
}

/** `3-7,12` (1-based, as printed) becomes a Set of 0-based slide indices. */
function parseSlideSelection(spec) {
  const indices = new Set();
  for (const part of String(spec).split(',')) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Could not read --slides "${part.trim()}". Try 3-7,12`);
    const from = Number(range[1]);
    const to = range[2] ? Number(range[2]) : from;
    if (from < 1) throw new Error('--slides is 1-based, so the lowest is 1');
    // A backwards range selects nothing, and an empty selection means every slide takes the
    // "reuse what is on disk" path — which on a fresh directory quietly overwrites a good
    // manifest with an empty one.
    if (to < from) throw new Error(`--slides "${part.trim()}" runs backwards. Try ${to}-${from}.`);
    for (let n = from; n <= to; n++) indices.add(n - 1);
  }
  if (indices.size === 0) throw new Error('--slides selected no slides.');
  return indices;
}

function buildRenderer(engine, args) {
  if (engine === 'say') {
    return createSayRenderer({ sampleRate: num(args, 'sample-rate', 48000, { min: 8000, max: 192000 }) });
  }
  if (engine === 'kokoro') {
    return createKokoroRenderer({
      model: args.model ?? DEFAULT_KOKORO_MODEL,
      dtype: args.dtype ?? DEFAULT_KOKORO_DTYPE,
      ...(args['cache-dir'] ? { cacheDir: args['cache-dir'] } : {}),
      onProgress: reportDownload
    });
  }
  if (engine === 'webspeech') {
    throw new Error(
      'The Web Speech API cannot be exported: browsers give no access to synthesized audio,\n' +
        'only playback. Export with --engine say (macOS voices) or --engine kokoro (anywhere).'
    );
  }
  throw new Error(`Unknown engine "${engine}". Use say or kokoro.`);
}

let lastPercent = -1;
function reportDownload({ loaded, total }) {
  const percent = Math.floor((loaded / total) * 100);
  if (percent === lastPercent || percent % 10 !== 0) return;
  lastPercent = percent;
  process.stderr.write(`  downloading model… ${percent}%\r`);
  if (percent === 100) process.stderr.write('\n');
}

async function listVoices(engine, args) {
  const voices = await buildRenderer(engine, args).listVoices();

  if (engine === 'kokoro') {
    const sorted = [...voices].sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
    console.log('\n  ID            GRADE  GENDER  ACCENT');
    for (const voice of sorted) {
      const star = voice.grade === 'A' ? ' ★' : '  ';
      const accent = voice.lang === 'en-GB' ? 'British' : 'American';
      const note = noteForKokoro(voice, sorted);
      console.log(
        `  ${voice.name.padEnd(13)} ${(voice.grade + star).padEnd(6)} ` +
          `${voice.gender.padEnd(7)} ${accent.padEnd(10)} ${voice.traits ?? ''}${note}`
      );
    }
    console.log(`\n  ${sorted.length} voices. Only the top few are worth using; grades are the`);
    console.log('  model authors’ own. Audition them in a browser: npm run demo, then voices.html');
    console.log(`\n  Use one:  --voice ${sorted[0].name}`);
    console.log(`  Or in your deck:  aloud: { engine: 'kokoro', voice: '${sorted[0].name}' }\n`);
    return;
  }

  console.log('\n  VOICE                          LANGUAGE');
  for (const voice of voices) {
    const flag = voice.default ? '  (your System Voice — reaches Siri voices)' : '';
    console.log(`  ${voice.name.padEnd(30)} ${(voice.lang || '').padEnd(8)}${flag}`);
  }
  console.log(`\n  ${voices.length} voices installed.`);
  console.log('  Download higher-quality ones in System Settings → Accessibility →');
  console.log('  Spoken Content → System Voice → Manage Voices (look for Premium).');
  console.log('\n  Use one:  --voice "Ava (Premium)"\n');
}

function noteForKokoro(voice, sorted) {
  if (voice.grade === 'A') return '  best overall';
  const bestMale = sorted.find((v) => v.gender === 'Male');
  if (voice === bestMale) return '  best male voice';
  if (gradeRank(voice.grade) >= gradeRank('F+')) return '  not recommended';
  return '';
}

async function renderSample(engine, args, text) {
  const renderer = buildRenderer(engine, args);
  await renderer.probe();

  const outPath = args.out ? `${args.out}/voice-sample.wav` : 'voice-sample.wav';
  if (args.out) await mkdir(args.out, { recursive: true });

  const sentence =
    typeof text === 'string'
      ? text
      : 'This is how your narration will sound. Every slide is rendered at this quality.';

  await renderer.render({
    chunks: [sentence],
    voice: args.voice,
    rate: num(args, 'rate', 1, { min: 0.1, max: 10 }),
    outPath,
    gapSilenceMs: 0
  });

  console.log(`\n  Wrote ${outPath}`);
  console.log(`  Listen:  afplay ${outPath}\n`);
}

/** FilesPort over the real filesystem. */
const files = {
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => {}),
  write: (path, data) => writeFile(path, data),
  exists: (path) => stat(path).then(() => true).catch(() => false),
  size: (path) => stat(path).then((s) => s.size),
  readHead: async (path, bytes) => {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    } finally {
      await handle.close();
    }
  },
  readRange: async (path, from, to) => {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buffer, 0, to - from, from);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    } finally {
      await handle.close();
    }
  }
};

async function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const engine = args.engine ?? (typeof args['list-voices'] === 'string' ? args['list-voices'] : 'kokoro');

  if (args['list-voices']) {
    await listVoices(typeof args['list-voices'] === 'string' ? args['list-voices'] : engine, args);
    return 0;
  }

  if (args.sample) {
    await renderSample(engine, args, args.sample);
    return 0;
  }

  const deck = args._[0];
  if (!deck) {
    console.log(USAGE);
    return 1;
  }

  // Everything that can be rejected on the arguments alone is settled here, before a browser
  // starts or a single byte is written — a typo should cost a second, not a full deck read.
  const outDir = args.out ?? 'narration';
  const exportOptions = {
    deck,
    outDir,
    voice: args.voice,
    rate: num(args, 'rate', 1, { min: 0.1, max: 10 }),
    gapSilenceMs: num(args, 'chunk-gap', 300, { min: 0, max: 60000 }),
    leadSilenceMs: num(args, 'lead', 0, { min: 0, max: 60000 }),
    tailSilenceMs: num(args, 'tail', 0, { min: 0, max: 60000 }),
    slideGapSec: num(args, 'gap', 0.5, { min: 0, max: 60 }),
    concat: args.concat !== false,
    analyze: args.analyze !== false,
    dryRun: Boolean(args['dry-run']),
    only: args.slides ? parseSlideSelection(args.slides) : null,
    engineDetail: detailFor(engine, args),
    resolveSettings: (config) => settingsFrom(config, engine, args)
  };
  const timeoutMs = num(args, 'timeout', 15000, { min: 100, max: 600000 });

  const renderer = buildRenderer(engine, args);
  const source = createPlaywrightSource({
    timeoutMs,
    bundlePath: (await files.exists(BUNDLE)) ? BUNDLE : undefined,
    log: (message) => console.log(message)
  });

  console.log(`\n  Exporting ${deck} with ${engine}${args.voice ? ` (${args.voice})` : ''}\n`);

  const { manifest, failures } = await exportNarration({
    source,
    renderer,
    files,
    log: (message) => console.log(message),
    options: exportOptions
  });

  report(manifest, failures, outDir, Boolean(args['dry-run']));
  return failures.length > 0 ? 1 : 0;
}

/**
 * The deck's configured voice only applies when the export targets the same engine — a Kokoro
 * deck's `af_heart` means nothing to `say`, and vice versa. Text-shaping settings like
 * `speakCode` and `maxChars` always come from the deck, since they change *what* is spoken and
 * the exported audio must match the talk.
 */
function settingsFrom(config, engine, args) {
  const deckEngine = config.engine ?? 'webspeech';
  const matches = deckEngine === engine;

  if (args.voice === undefined && !matches && config.voice) {
    console.log(
      `  note: the deck's voice "${config.voice}" is for the ${deckEngine} engine, so it does` +
        ` not apply to ${engine}. Using the default; pass --voice to choose.`
    );
  }

  return {
    voice: args.voice ?? (matches ? config.voice : undefined) ?? undefined,
    rate: args.rate !== undefined ? num(args, 'rate', 1, { min: 0.1, max: 10 }) : (matches && config.rate) || 1
  };
}

function detailFor(engine, args) {
  if (engine !== 'kokoro') return null;
  return {
    model: args.model ?? DEFAULT_KOKORO_MODEL,
    dtype: args.dtype ?? DEFAULT_KOKORO_DTYPE,
    device: 'cpu'
  };
}

function report(manifest, failures, outDir, dryRun) {
  const { totals } = manifest;
  console.log('');
  if (dryRun) {
    // totals.narrated counts slides with measured audio, and a dry run measures none — so the
    // count that means something here is how many slides have anything to say.
    const speaking = manifest.slides.filter((slide) => slide.chunks.length > 0);
    const words = speaking.reduce((n, slide) => n + slide.wordCount, 0);
    console.log(`  Dry run: ${speaking.length} of ${totals.slides} slides have narration.`);
    console.log(`  ${words} words, roughly ${Math.round(words / 150)} min at a normal pace.`);
    console.log(`  Wrote ${outDir}/manifest.json — no audio rendered.\n`);
    return;
  }

  const minutes = Math.floor(totals.timelineSec / 60);
  const seconds = Math.round(totals.timelineSec % 60);
  console.log(`  ${totals.narrated} clips, ${minutes}m ${seconds}s of timeline → ${outDir}/`);

  const flagged = manifest.slides.filter((s) => s.warnings.includes('unclosed-bracket'));
  if (flagged.length > 0) {
    console.log(
      `\n  ${flagged.length} slide(s) have an unclosed "[" so more was silenced than intended: ` +
        flagged.map((s) => s.index + 1).join(', ')
    );
  }
  if (failures.length > 0) {
    console.log(`\n  ${failures.length} slide(s) failed to render:`);
    for (const failure of failures) console.log(`    slide ${failure.index + 1}: ${failure.error}`);
  }
  console.log('');
}

/**
 * Setting `exitCode` rather than calling `process.exit()` is deliberate. onnxruntime-node keeps
 * a native thread pool alive, and tearing the process down underneath it throws an unhandled
 * C++ exception ("mutex lock failed") *after* the export has already succeeded — alarming, and
 * it masks the real exit status. Letting Node drain normally lets ORT shut itself down.
 */
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    // Indent every line, not just the first — these messages are deliberately multi-line.
    console.error('\n' + String(error.message).replace(/^/gm, '  ') + '\n');
    process.exitCode = 2;
  });
