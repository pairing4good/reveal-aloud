import { describe, expect, it } from 'vitest';

import { Warning, buildManifest, manifestToCsv, warningsFor } from '../../src/core/manifest.js';

function slide(index, overrides = {}) {
  return {
    index,
    h: index,
    v: 0,
    id: null,
    title: `Slide ${index}`,
    hasNotes: true,
    chunks: ['Hello there.'],
    unclosedBracket: false,
    ...overrides
  };
}

function measured(file, durationSec, extra = {}) {
  return {
    file,
    durationSec,
    speechStartSec: 0.02,
    speechEndSec: durationSec - 0.03,
    ...extra
  };
}

const meta = {
  generatedAt: '2026-09-03T00:00:00.000Z',
  deck: 'http://127.0.0.1:8000/demo/index.html',
  engine: 'say',
  voice: 'Ava (Premium)',
  rate: 1,
  audio: { container: 'wav', codec: 'pcm_s16le', sampleRate: 48000, channels: 1 },
  padding: { leadSilenceMs: 0, gapSilenceMs: 300, tailSilenceMs: 0, slideGapSec: 0.5 }
};

describe('warningsFor', () => {
  it('flags an unclosed bracket', () => {
    expect(warningsFor(slide(0, { unclosedBracket: true }))).toContain(Warning.UNCLOSED_BRACKET);
  });

  it('distinguishes no notes from notes that were entirely silenced', () => {
    expect(warningsFor(slide(0, { hasNotes: false, chunks: [] }))).toEqual([Warning.NO_NOTES]);
    expect(warningsFor(slide(0, { hasNotes: true, chunks: [] }))).toEqual([
      Warning.NOTES_ENTIRELY_SILENT
    ]);
  });

  it('says nothing about a healthy slide', () => {
    expect(warningsFor(slide(0))).toEqual([]);
  });
});

describe('buildManifest offsets', () => {
  it('starts the first clip at zero', () => {
    const m = buildManifest({
      slides: [slide(0)],
      measurements: new Map([[0, measured('001.wav', 10)]]),
      meta
    });
    expect(m.slides[0].startSec).toBe(0);
    expect(m.slides[0].endSec).toBe(10);
  });

  it('separates consecutive narrated slides by exactly the slide gap', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1)],
      measurements: new Map([
        [0, measured('001.wav', 10)],
        [1, measured('002.wav', 5)]
      ]),
      meta
    });

    expect(m.slides[0].endSec).toBe(10);
    expect(m.slides[1].startSec).toBe(10.5);
    expect(m.slides[1].endSec).toBe(15.5);
  });

  it('leaves no trailing gap, so timelineSec is the end of the last clip', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1)],
      measurements: new Map([
        [0, measured('001.wav', 10)],
        [1, measured('002.wav', 5)]
      ]),
      meta
    });
    expect(m.totals.timelineSec).toBe(m.slides[1].endSec);
  });

  it('gives a silent slide no duration and no gap, so the timeline cannot drift', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1, { hasNotes: false, chunks: [] }), slide(2)],
      measurements: new Map([
        [0, measured('001.wav', 10)],
        [2, measured('003.wav', 4)]
      ]),
      meta
    });

    expect(m.slides[1]).toMatchObject({ file: null, durationSec: 0, startSec: 10, endSec: 10 });
    // Slide 2 follows slide 0 with a single gap between them — not two, and not zero.
    expect(m.slides[2].startSec).toBe(10.5);
    expect(m.totals).toMatchObject({ slides: 3, narrated: 2, silent: 1, timelineSec: 14.5 });
  });

  it('keeps every slide in the manifest so counts match the deck', () => {
    const m = buildManifest({
      slides: [slide(0, { hasNotes: false, chunks: [] }), slide(1, { hasNotes: false, chunks: [] })],
      measurements: new Map(),
      meta
    });
    expect(m.slides).toHaveLength(2);
    expect(m.totals).toMatchObject({ narrated: 0, silent: 2, audioSec: 0, timelineSec: 0 });
  });

  it('separates audio length from timeline length', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1), slide(2)],
      measurements: new Map([
        [0, measured('001.wav', 3)],
        [1, measured('002.wav', 3)],
        [2, measured('003.wav', 3)]
      ]),
      meta
    });
    expect(m.totals.audioSec).toBe(9); // just the speech
    expect(m.totals.timelineSec).toBe(10); // plus two 0.5s gaps
  });

  it('rounds to milliseconds rather than carrying float noise', () => {
    const m = buildManifest({
      slides: [slide(0)],
      measurements: new Map([[0, measured('001.wav', 1 / 3)]]),
      meta
    });
    expect(m.slides[0].durationSec).toBe(0.333);
  });

  it('handles a zero slide gap', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1)],
      measurements: new Map([
        [0, measured('001.wav', 2)],
        [1, measured('002.wav', 2)]
      ]),
      meta: { ...meta, padding: { ...meta.padding, slideGapSec: 0 } }
    });
    expect(m.slides[1].startSec).toBe(2);
  });
});

describe('buildManifest content', () => {
  it('records the spoken text and a word count', () => {
    const m = buildManifest({
      slides: [slide(0, { chunks: ['One two.', 'Three four five.'] })],
      measurements: new Map([[0, measured('001.wav', 4)]]),
      meta
    });
    expect(m.slides[0].text).toBe('One two. Three four five.');
    expect(m.slides[0].wordCount).toBe(5);
  });

  it('counts no words for a silent slide', () => {
    const m = buildManifest({
      slides: [slide(0, { hasNotes: false, chunks: [] })],
      measurements: new Map(),
      meta
    });
    expect(m.slides[0].wordCount).toBe(0);
  });

  it('marks a failed render and keeps its error, without consuming timeline', () => {
    const m = buildManifest({
      slides: [slide(0), slide(1)],
      measurements: new Map([
        [0, { file: null, durationSec: null, speechStartSec: null, speechEndSec: null, error: 'say exited with code 1' }],
        [1, measured('002.wav', 6)]
      ]),
      meta
    });

    expect(m.slides[0].warnings).toContain(Warning.RENDER_FAILED);
    expect(m.slides[0].error).toBe('say exited with code 1');
    expect(m.slides[1].startSec).toBe(0); // the failure did not shift the rest
    expect(m.totals.narrated).toBe(1);
  });

  it('carries engine detail and the master filename when given', () => {
    const m = buildManifest({
      slides: [slide(0)],
      measurements: new Map([[0, measured('001.wav', 1)]]),
      meta: {
        ...meta,
        engine: 'kokoro',
        engineDetail: { model: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'fp32', voiceGrade: 'A' },
        concatenated: 'narration-full.wav'
      }
    });
    expect(m.engineDetail.dtype).toBe('fp32');
    expect(m.concatenated).toBe('narration-full.wav');
  });

  it('omits engineDetail and concatenated when absent rather than writing nulls', () => {
    const m = buildManifest({
      slides: [slide(0)],
      measurements: new Map([[0, measured('001.wav', 1)]]),
      meta
    });
    expect('engineDetail' in m).toBe(false);
    expect('concatenated' in m).toBe(false);
  });

  it('stamps a version so a future format change is detectable', () => {
    const m = buildManifest({ slides: [], measurements: new Map(), meta });
    expect(m.version).toBe(1);
  });
});

describe('manifestToCsv', () => {
  const m = buildManifest({
    slides: [slide(0, { title: 'Intro, briefly' }), slide(1, { chunks: ['She said "hi".'] })],
    measurements: new Map([
      [0, measured('001.wav', 10)],
      [1, measured('002.wav', 5)]
    ]),
    meta
  });

  it('writes a header plus one row per slide', () => {
    const rows = manifestToCsv(m).trimEnd().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^index,h,v,file,startSec/);
  });

  it('quotes cells containing commas', () => {
    expect(manifestToCsv(m)).toContain('"Intro, briefly"');
  });

  it('doubles embedded quotes so the row stays parseable', () => {
    expect(manifestToCsv(m)).toContain('"She said ""hi""."');
  });

  it('writes empty cells for nulls rather than the string "null"', () => {
    const withSilent = buildManifest({
      slides: [slide(0, { hasNotes: false, chunks: [] })],
      measurements: new Map(),
      meta
    });
    expect(manifestToCsv(withSilent)).not.toContain('null');
  });
});
