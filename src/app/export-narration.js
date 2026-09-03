/**
 * Renders a deck's narration to audio files and a manifest.
 *
 * Composition only: every collaborator is injected, the same way createPlugin() takes its
 * adapters. That is what lets the entire export — offsets, concatenation, warnings, partial
 * failure — be tested with fakes, without macOS, a browser, or a 300MB model download.
 *
 * The order of operations matters and is deliberate:
 *   1. probe the renderer, so an unusable setup fails before any work
 *   2. read every slide, so an empty extraction is caught before rendering
 *   3. render slide by slide, tolerating individual failures
 *   4. measure each file, then build the manifest from the measurements
 *   5. concatenate last, since it needs every file's format to agree
 */

import { buildManifest, manifestToCsv } from '../core/manifest.js';
import { measureSilence, readWavInfo, sameFormat, wavHeader } from '../core/wav.js';

/** Plenty for a WAV header even with the filler chunks CoreAudio inserts. */
const HEADER_BYTES = 65536;

export const MANIFEST_FILE = 'manifest.json';
export const CSV_FILE = 'narration.csv';
export const MASTER_FILE = 'narration-full.wav';

/**
 * @param {object} args
 * @param {import('../ports.js').NarrationSourcePort} args.source
 * @param {import('../ports.js').AudioRenderPort} args.renderer
 * @param {import('../ports.js').FilesPort} args.files
 * @param {object} args.options see bin/export-narration.js for the CLI surface
 * @param {(message: string) => void} [args.log]
 * @returns {Promise<{manifest: object, failures: Array<{index: number, error: string}>,
 *   outDir: string}>}
 */
export async function exportNarration({ source, renderer, files, options, log = () => {} }) {
  const {
    deck,
    outDir,
    gapSilenceMs = 300,
    leadSilenceMs = 0,
    tailSilenceMs = 0,
    slideGapSec = 0.5,
    concat = true,
    analyze = true,
    dryRun = false,
    only = null,
    engineDetail = null,
    now = () => new Date(),
    /**
     * Settles the voice and rate once the deck's own `aloud` block is known. The CLI uses this
     * to honour a deck's configured voice when it targets the same engine, and to ignore it
     * when it does not — a Kokoro deck's `af_heart` means nothing to `say`.
     */
    resolveSettings = () => ({ voice: options.voice, rate: options.rate ?? 1 })
  } = options;

  if (!dryRun) await renderer.probe();

  const { config, slides } = await source.readDeck(deck);
  const { voice, rate = 1 } = resolveSettings(config ?? {});
  const narrated = slides.filter((slide) => slide.chunks.length > 0);

  log(`${slides.length} slides, ${narrated.length} with narration.`);
  if (narrated.length === 0) {
    // Almost always a deck whose notes never made it into the DOM the exporter saw, so say what
    // to check rather than silently writing an empty manifest.
    log(
      'No slide produced any speech. Check that the deck has <aside class="notes"> content and\n' +
        'that it is not all inside [brackets]. --dry-run shows what was extracted.'
    );
  }

  await files.mkdir(outDir);

  const measurements = new Map();
  const failures = [];
  let format = null;

  for (const slide of narrated) {
    const file = fileNameFor(slide);
    const outPath = join(outDir, file);

    if (only && !only.has(slide.index)) {
      // Not selected this run: reuse what is already on disk so the manifest stays whole.
      const reused = await measureExisting({ files, outPath, file, analyze });
      if (reused) {
        // Reused files need the same format check as freshly rendered ones. Re-rendering one
        // slide with a different engine leaves the rest at the old sample rate, and without
        // this they would be spliced into the master unchanged — playing at the wrong speed,
        // with every offset after the first slide wrong.
        if (format && !sameFormat(format, reused.format)) {
          const message =
            `${file} is ${describe(reused.format)} but this run is producing ` +
            `${describe(format)}. Re-render the whole deck, or export to a different --out.`;
          failures.push({ index: slide.index, error: message });
          measurements.set(slide.index, {
            file: null,
            durationSec: null,
            speechStartSec: null,
            speechEndSec: null,
            error: message
          });
          log(`  ! slide ${slide.index + 1} skipped: ${message}`);
          continue;
        }
        measurements.set(slide.index, reused.entry);
        format ??= reused.format;
      }
      continue;
    }

    if (dryRun) {
      measurements.set(slide.index, {
        file,
        durationSec: null,
        speechStartSec: null,
        speechEndSec: null
      });
      continue;
    }

    log(`  ${file}  ${preview(slide)}`);
    try {
      const written = await renderer.render({
        chunks: slide.chunks,
        voice,
        rate,
        outPath,
        gapSilenceMs,
        leadSilenceMs,
        tailSilenceMs
      });

      // Refusing early beats writing a master that drifts: mixing sample rates in one
      // concatenation would silently play parts of the deck at the wrong speed.
      if (format && !sameFormat(format, written)) {
        throw new Error(
          `format changed mid-export (${describe(format)} then ${describe(written)}); ` +
            'cannot combine these into one track'
        );
      }
      format ??= written;

      const measured = await measureExisting({ files, outPath, file, analyze });
      if (!measured) throw new Error('rendered file is not readable as a WAV');
      measurements.set(slide.index, measured.entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ index: slide.index, error: message });
      measurements.set(slide.index, {
        file: null,
        durationSec: null,
        speechStartSec: null,
        speechEndSec: null,
        error: message
      });
      log(`  ! slide ${slide.index + 1} failed: ${message}`);
    }
  }

  // The master track can only place a gap on a whole frame, so the manifest must use the same
  // rounded value. Using the raw one instead leaves every offset drifting a fraction of a
  // sample further out with each slide — small, but it accumulates in one direction.
  const alignedGapSec = format ? alignToFrame(slideGapSec, format) : slideGapSec;

  // Only claim a master exists if one will actually be written. concatenate() bails when there
  // are no clips, and a manifest pointing at a file that was never created is worse than one
  // that says nothing.
  const willConcat =
    concat && !dryRun && Boolean(format) && [...measurements.values()].some((m) => m.file);

  const manifest = buildManifest({
    slides,
    measurements,
    meta: {
      generatedAt: now().toISOString(),
      deck,
      engine: renderer.id,
      voice: voice ?? '',
      rate,
      ...(engineDetail ? { engineDetail } : {}),
      audio: {
        container: 'wav',
        codec: format ? codecFor(format) : 'pcm_s16le',
        sampleRate: format?.sampleRate ?? null,
        channels: format?.channels ?? null,
        bitsPerSample: format?.bitsPerSample ?? null
      },
      padding: { leadSilenceMs, gapSilenceMs, tailSilenceMs, slideGapSec: alignedGapSec },
      ...(willConcat ? { concatenated: MASTER_FILE } : {})
    }
  });

  await files.write(join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n');
  await files.write(join(outDir, CSV_FILE), manifestToCsv(manifest));

  if (willConcat) {
    await concatenate({ files, outDir, manifest, format, slideGapSec: alignedGapSec, log });
  }

  if (typeof source.close === 'function') await source.close();

  return { manifest, failures, outDir };
}

/** `NNN-hHH-vVV.wav` — index first so a lexical sort is presentation order. */
export function fileNameFor(slide) {
  const n = String(slide.index + 1).padStart(3, '0');
  const h = String(slide.h).padStart(2, '0');
  const v = String(slide.v).padStart(2, '0');
  return `${n}-h${h}-v${v}.wav`;
}

/** Reads a rendered file's header and, optionally, where the speech sits inside it. */
async function measureExisting({ files, outPath, file, analyze }) {
  if (!(await files.exists(outPath))) return null;

  const head = await files.readHead(outPath, HEADER_BYTES);
  const size = await files.size(outPath);
  const info = readWavInfo(head, size);
  if (!info) return null;

  let speechStartSec = null;
  let speechEndSec = null;
  let silent = false;
  if (analyze) {
    const pcm = await files.readRange(outPath, info.dataOffset, info.dataOffset + info.dataBytes);
    const measured = measureSilence(pcm, info);
    silent = measured.silent;
    speechStartSec = measured.leadSec;
    speechEndSec = info.durationSec - measured.tailSec;
  }

  return {
    entry: { file, durationSec: info.durationSec, speechStartSec, speechEndSec, silent },
    format: {
      sampleRate: info.sampleRate,
      channels: info.channels,
      bitsPerSample: info.bitsPerSample
    }
  };
}

/**
 * Writes every clip into one track, with silence between them.
 *
 * Streamed a clip at a time rather than assembled in memory — a long deck is hundreds of
 * megabytes of samples — which is only possible because every size is known up front, so the
 * header never needs patching afterwards.
 */
async function concatenate({ files, outDir, manifest, format, slideGapSec, log }) {
  const clips = manifest.slides.filter((slide) => slide.file !== null);
  if (clips.length === 0) return;

  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const byteRate = format.sampleRate * blockAlign;
  // Gaps must land on a frame boundary, or every clip after the first would be offset by a
  // fraction of a sample and the channels would swap in a stereo file.
  const gapBytes = Math.floor((slideGapSec * byteRate) / blockAlign) * blockAlign;
  const gap = new Uint8Array(gapBytes);

  const payloads = [];
  let dataBytes = 0;
  for (const clip of clips) {
    const path = join(outDir, clip.file);
    const head = await files.readHead(path, HEADER_BYTES);
    const info = readWavInfo(head, await files.size(path));
    payloads.push({ path, from: info.dataOffset, to: info.dataOffset + info.dataBytes });
    dataBytes += info.dataBytes;
  }
  dataBytes += gapBytes * (clips.length - 1);

  const masterPath = join(outDir, MASTER_FILE);
  const parts = [wavHeader({ ...format, dataBytes })];
  for (let i = 0; i < payloads.length; i++) {
    if (i > 0 && gapBytes > 0) parts.push(gap);
    parts.push(await files.readRange(payloads[i].path, payloads[i].from, payloads[i].to));
  }

  await files.write(masterPath, concatBytes(parts));
  log(`  ${MASTER_FILE}  ${manifest.totals.timelineSec.toFixed(1)}s`);
}

function concatBytes(parts) {
  const total = parts.reduce((n, part) => n + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** The largest whole number of frames that fits in `seconds`, expressed back as seconds. */
function alignToFrame(seconds, format) {
  if (!(seconds > 0)) return 0;
  return Math.floor(seconds * format.sampleRate) / format.sampleRate;
}

function codecFor(format) {
  return format.bitsPerSample === 16 ? 'pcm_s16le' : `pcm_s${format.bitsPerSample}le`;
}

function describe(format) {
  return `${format.sampleRate}Hz/${format.channels}ch/${format.bitsPerSample}bit`;
}

function preview(slide) {
  const text = slide.chunks.join(' ');
  return text.length > 56 ? `${text.slice(0, 53)}...` : text;
}

/** Kept local so this module stays free of node:path and can run anywhere. */
function join(dir, file) {
  return dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
}
