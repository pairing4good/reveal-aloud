/**
 * PURE. Turns rendered slide audio into the document a video editor actually needs.
 *
 * The exporter's real output is not the WAV files — it is the answer to "where does slide 7's
 * narration begin?". That arithmetic lives here, away from filesystems and subprocesses, so it
 * can be tested exhaustively: the offsets are what make a screen recording line up, and an
 * off-by-one in them is invisible until someone is halfway through editing.
 *
 * `startSec` is a position on the concatenated timeline — the one `narration-full.wav` lays out,
 * inter-slide gaps included. That is the single most misreadable field in the output, so it is
 * computed here in one place and documented in the README.
 */

export const MANIFEST_VERSION = 1;

/** Machine-readable reasons a slide may need attention. */
export const Warning = Object.freeze({
  /** A `[` in the notes was never closed, so more was silenced than intended. */
  UNCLOSED_BRACKET: 'unclosed-bracket',
  /** The slide has no speaker notes at all. */
  NO_NOTES: 'no-notes',
  /** It had notes, but every word was inside brackets or punctuation. */
  NOTES_ENTIRELY_SILENT: 'notes-entirely-silent',
  /** The engine failed on this slide; the rest of the export still completed. */
  RENDER_FAILED: 'render-failed',
  /**
   * The engine reported success but the file contains no audible signal. Worth surfacing:
   * otherwise a slide that silently synthesized nothing looks identical to a good one, and is
   * only discovered while editing.
   */
  SILENT_AUDIO: 'silent-audio'
});

/**
 * @param {import('../ports.js').SlideNarration} slide
 * @returns {string[]}
 */
export function warningsFor(slide) {
  const warnings = [];
  if (slide.unclosedBracket) warnings.push(Warning.UNCLOSED_BRACKET);
  if (!slide.hasNotes) warnings.push(Warning.NO_NOTES);
  else if (slide.chunks.length === 0) warnings.push(Warning.NOTES_ENTIRELY_SILENT);
  return warnings;
}

/**
 * @param {object} args
 * @param {import('../ports.js').SlideNarration[]} args.slides every slide, narrated or not
 * @param {Map<number, {file: string, durationSec: number|null, speechStartSec: number|null,
 *   speechEndSec: number|null, error?: string}>} args.measurements keyed by slide index; absent
 *   means the slide was silent and produced no file
 * @param {object} args.meta deck, engine, voice, rate, engineDetail, audio, padding, generatedAt
 * @returns {object} the manifest, ready to JSON.stringify
 */
export function buildManifest({ slides, measurements, meta }) {
  const slideGapSec = meta.padding?.slideGapSec ?? 0;

  let cursor = 0;
  let audioSec = 0;
  let narrated = 0;
  let previousWasNarrated = false;

  const entries = slides.map((slide) => {
    const measured = measurements.get(slide.index) ?? null;
    const warnings = warningsFor(slide);
    if (measured?.error) warnings.push(Warning.RENDER_FAILED);
    if (measured?.silent) warnings.push(Warning.SILENT_AUDIO);

    // A slide with nothing to say occupies no time and earns no gap — otherwise a deck with
    // several title slides would drift the whole timeline against the recording.
    if (!measured || measured.durationSec === null) {
      return {
        ...identity(slide),
        file: measured?.file ?? null,
        startSec: round(cursor),
        durationSec: measured ? null : 0,
        endSec: round(cursor),
        speechStartSec: null,
        speechEndSec: null,
        ...spoken(slide),
        warnings,
        ...(measured?.error ? { error: measured.error } : {})
      };
    }

    // The gap sits *between* narrated slides, so it is added before this one rather than after
    // the previous one. That keeps the first clip at 0 and leaves no trailing gap at the end.
    if (previousWasNarrated) cursor += slideGapSec;

    const startSec = round(cursor);
    const endSec = round(cursor + measured.durationSec);
    cursor += measured.durationSec;
    audioSec += measured.durationSec;
    narrated++;
    previousWasNarrated = true;

    return {
      ...identity(slide),
      file: measured.file,
      startSec,
      durationSec: round(measured.durationSec),
      endSec,
      speechStartSec: round(measured.speechStartSec),
      speechEndSec: round(measured.speechEndSec),
      ...spoken(slide),
      warnings
    };
  });

  return {
    version: MANIFEST_VERSION,
    generatedAt: meta.generatedAt,
    deck: meta.deck,
    engine: meta.engine,
    voice: meta.voice,
    rate: meta.rate,
    ...(meta.engineDetail ? { engineDetail: meta.engineDetail } : {}),
    audio: meta.audio,
    padding: meta.padding,
    totals: {
      slides: slides.length,
      narrated,
      silent: slides.length - narrated,
      audioSec: round(audioSec),
      timelineSec: round(cursor)
    },
    ...(meta.concatenated ? { concatenated: meta.concatenated } : {}),
    slides: entries
  };
}

function identity(slide) {
  return {
    index: slide.index,
    h: slide.h,
    v: slide.v,
    id: slide.id ?? null,
    title: slide.title ?? null
  };
}

function spoken(slide) {
  const text = slide.chunks.join(' ');
  return {
    chunks: slide.chunks,
    text,
    wordCount: text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  };
}

/** Milliseconds are the finest unit any editor cares about, and it keeps float noise out. */
function round(seconds) {
  if (seconds === null || seconds === undefined) return null;
  return Math.round(seconds * 1000) / 1000;
}

const CSV_COLUMNS = [
  'index',
  'h',
  'v',
  'file',
  'startSec',
  'durationSec',
  'endSec',
  'speechStartSec',
  'title',
  'text'
];

/**
 * The same data as a spreadsheet, which is what most editors' marker importers read.
 *
 * @param {object} manifest
 * @returns {string} CRLF-terminated, per RFC 4180, so Excel does not mangle it
 */
export function manifestToCsv(manifest) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const slide of manifest.slides) {
    rows.push(CSV_COLUMNS.map((column) => csvCell(slide[column])).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Quote when the value could otherwise break the row, doubling any embedded quote.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
