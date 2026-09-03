/**
 * Properties of the export timeline.
 *
 * The manifest's whole job is to say where each clip sits, and a mistake there is invisible until
 * someone is deep into editing a video. So the invariants are stated over arbitrary decks: clips
 * never overlap, the gap between narrated slides is exactly the configured one, silent slides are
 * free, and the totals agree with the per-slide numbers.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { Warning, buildManifest, manifestToCsv } from '../../src/core/manifest.js';
import { RUNS, params } from './arbitraries.js';

const slideSpec = fc.record({
  hasNotes: fc.boolean(),
  chunkCount: fc.integer({ min: 0, max: 4 }),
  unclosedBracket: fc.boolean(),
  durationSec: fc.double({ min: 0.05, max: 90, noNaN: true }),
  failed: fc.constantFrom(false, false, false, true)
});

const deckSpec = fc.record({
  slides: fc.array(slideSpec, { minLength: 0, maxLength: 25 }),
  slideGapSec: fc.constantFrom(0, 0.25, 0.5, 1, 2)
});

/** Builds the buildManifest() inputs from a generated deck. */
function inputs({ slides, slideGapSec }) {
  const narration = slides.map((spec, index) => ({
    index,
    h: index,
    v: 0,
    id: null,
    title: `Slide ${index}`,
    hasNotes: spec.hasNotes,
    chunks: spec.hasNotes ? Array.from({ length: spec.chunkCount }, (_, i) => `Chunk ${i}.`) : [],
    unclosedBracket: spec.unclosedBracket
  }));

  const measurements = new Map();
  slides.forEach((spec, index) => {
    const narrated = spec.hasNotes && spec.chunkCount > 0;
    if (!narrated) return;
    if (spec.failed) {
      measurements.set(index, {
        file: null,
        durationSec: null,
        speechStartSec: null,
        speechEndSec: null,
        error: 'boom'
      });
      return;
    }
    measurements.set(index, {
      file: `${String(index + 1).padStart(3, '0')}.wav`,
      durationSec: spec.durationSec,
      speechStartSec: 0,
      speechEndSec: spec.durationSec
    });
  });

  return {
    slides: narration,
    measurements,
    meta: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      deck: 'deck.html',
      engine: 'say',
      voice: '',
      rate: 1,
      audio: { container: 'wav', codec: 'pcm_s16le', sampleRate: 48000, channels: 1 },
      padding: { leadSilenceMs: 0, gapSilenceMs: 300, tailSilenceMs: 0, slideGapSec }
    }
  };
}

const withAudio = (manifest) => manifest.slides.filter((s) => s.file !== null);

describe(`buildManifest, over ${RUNS} generated decks`, () => {
  it('spaces consecutive narrated slides by exactly the slide gap', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        const clips = withAudio(manifest);

        for (let i = 0; i + 1 < clips.length; i++) {
          const gap = clips[i + 1].startSec - clips[i].endSec;
          expect(gap).toBeCloseTo(deck.slideGapSec, 3);
        }
      }),
      params
    );
  });

  it('never overlaps two clips', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const clips = withAudio(buildManifest(inputs(deck)));
        for (let i = 0; i + 1 < clips.length; i++) {
          expect(clips[i + 1].startSec).toBeGreaterThanOrEqual(clips[i].endSec);
        }
      }),
      params
    );
  });

  it('starts the first clip at zero and leaves no trailing gap', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        const clips = withAudio(manifest);
        if (clips.length === 0) {
          expect(manifest.totals.timelineSec).toBe(0);
          return;
        }
        expect(clips[0].startSec).toBe(0);
        expect(manifest.totals.timelineSec).toBeCloseTo(clips.at(-1).endSec, 3);
      }),
      params
    );
  });

  it('charges nothing to the timeline for a slide with no audio', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        for (const slide of buildManifest(inputs(deck)).slides) {
          if (slide.file === null) expect(slide.startSec).toBe(slide.endSec);
        }
      }),
      params
    );
  });

  it('keeps totals consistent with the per-slide entries', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        const clips = withAudio(manifest);

        expect(manifest.totals.slides).toBe(deck.slides.length);
        expect(manifest.totals.narrated).toBe(clips.length);
        expect(manifest.totals.silent).toBe(manifest.totals.slides - clips.length);
        expect(manifest.totals.audioSec).toBeCloseTo(
          clips.reduce((sum, s) => sum + s.durationSec, 0),
          2
        );
        expect(manifest.totals.timelineSec).toBeGreaterThanOrEqual(manifest.totals.audioSec - 1e-6);
      }),
      params
    );
  });

  it('lists every slide, in deck order, exactly once', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        expect(manifest.slides.map((s) => s.index)).toEqual(deck.slides.map((_, i) => i));
      }),
      params
    );
  });

  it('warns about every unclosed bracket and every failed render', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        manifest.slides.forEach((slide, i) => {
          const spec = deck.slides[i];
          if (spec.unclosedBracket) {
            expect(slide.warnings).toContain(Warning.UNCLOSED_BRACKET);
          }
          const narrated = spec.hasNotes && spec.chunkCount > 0;
          if (narrated && spec.failed) {
            expect(slide.warnings).toContain(Warning.RENDER_FAILED);
            expect(slide.file).toBeNull();
          }
        });
      }),
      params
    );
  });

  it('monotonically increases startSec down the deck', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const starts = buildManifest(inputs(deck)).slides.map((s) => s.startSec);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      }),
      params
    );
  });
});

describe(`manifestToCsv, over ${RUNS} generated decks`, () => {
  it('writes exactly one row per slide plus a header', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const manifest = buildManifest(inputs(deck));
        const rows = manifestToCsv(manifest).trimEnd();
        const lines = rows === '' ? [] : rows.split('\r\n');
        expect(lines.length).toBe(manifest.slides.length + 1);
      }),
      params
    );
  });

  it('never emits an unbalanced quote', () => {
    fc.assert(
      fc.property(deckSpec, (deck) => {
        const csv = manifestToCsv(buildManifest(inputs(deck)));
        expect((csv.match(/"/g) ?? []).length % 2).toBe(0);
      }),
      params
    );
  });
});
