import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KOKORO_VOICE,
  KOKORO_VOICES,
  gradeRank,
  kokoroVoice,
  suggestVoices
} from '../../src/core/kokoro-voices.js';

describe('the roster', () => {
  it('carries all 28 voices kokoro-js ships', () => {
    // kokoro-js validates against a hardcoded table and throws on anything else, so a roster
    // that drifts from 28 means we are either offering a voice that cannot load or hiding one.
    expect(KOKORO_VOICES).toHaveLength(28);
  });

  it('includes am_santa, which is easy to miss', () => {
    expect(kokoroVoice('am_santa')).toBeDefined();
  });

  it('has no duplicate ids', () => {
    const names = KOKORO_VOICES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is sorted best-graded first, so any listing can just print it', () => {
    const ranks = KOKORO_VOICES.map((v) => gradeRank(v.overallGrade));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('defaults to the only A-graded voice', () => {
    expect(KOKORO_VOICES[0].name).toBe(DEFAULT_KOKORO_VOICE);
    expect(KOKORO_VOICES[0].overallGrade).toBe('A');
    expect(KOKORO_VOICES.filter((v) => v.default)).toHaveLength(1);
  });

  it('covers only the two accents kokoro-js can actually load', () => {
    expect(new Set(KOKORO_VOICES.map((v) => v.lang))).toEqual(new Set(['en-US', 'en-GB']));
  });

  it('grades every voice', () => {
    for (const voice of KOKORO_VOICES) {
      expect(gradeRank(voice.overallGrade)).toBeLessThan(12);
      expect(voice.gender).toMatch(/^(Female|Male)$/);
    }
  });

  it('is frozen, since callers hand it straight out of listVoices()', () => {
    expect(Object.isFrozen(KOKORO_VOICES)).toBe(true);
    expect(Object.isFrozen(KOKORO_VOICES[0])).toBe(true);
  });
});

describe('gradeRank', () => {
  it('orders A above C+ above F+', () => {
    expect(gradeRank('A')).toBeLessThan(gradeRank('C+'));
    expect(gradeRank('C+')).toBeLessThan(gradeRank('F+'));
  });

  it('sorts an unknown grade last rather than throwing', () => {
    expect(gradeRank('Z++')).toBeGreaterThanOrEqual(gradeRank('F'));
  });
});

describe('suggestVoices', () => {
  it('finds the same person under a different accent prefix', () => {
    expect(suggestVoices('af_daniel')).toContain('bm_daniel');
  });

  it('handles a bare name with no prefix', () => {
    expect(suggestVoices('bella')).toContain('af_bella');
  });

  it('recommends by quality when nothing resembles the request', () => {
    // e.g. jf_alpha — a real voice in the HuggingFace repo that kokoro-js cannot load.
    expect(suggestVoices('jf_alpha')[0]).toBe('af_heart');
  });

  it('respects the limit', () => {
    expect(suggestVoices('nonsense', 2)).toHaveLength(2);
  });

  it('only ever suggests loadable voices', () => {
    const ids = KOKORO_VOICES.map((v) => v.name);
    for (const query of ['zf_xiaobei', 'af_hart', '', 'george']) {
      for (const suggestion of suggestVoices(query)) expect(ids).toContain(suggestion);
    }
  });
});
