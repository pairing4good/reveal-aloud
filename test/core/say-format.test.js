import { describe, expect, it } from 'vitest';

import { joinForSay, toWordsPerMinute } from '../../src/core/say-format.js';

describe('toWordsPerMinute', () => {
  it('maps rate 1 to the tuned baseline', () => {
    expect(toWordsPerMinute(1)).toBe(175);
  });

  it('scales linearly', () => {
    expect(toWordsPerMinute(2)).toBe(350);
    expect(toWordsPerMinute(0.5)).toBe(88); // 87.5 rounds up
  });

  it('clamps unintelligibly slow rates', () => {
    expect(toWordsPerMinute(0.1)).toBe(60);
  });

  it('treats a missing or nonsense rate as normal speed', () => {
    expect(toWordsPerMinute(undefined)).toBe(175);
    expect(toWordsPerMinute(0)).toBe(175);
    expect(toWordsPerMinute(-3)).toBe(175);
    expect(toWordsPerMinute('nope')).toBe(175);
  });

  it('always returns an integer, since `say -r` takes one', () => {
    for (const rate of [0.77, 1.003, 1.61, 2.49]) {
      expect(Number.isInteger(toWordsPerMinute(rate))).toBe(true);
    }
  });
});

describe('joinForSay', () => {
  it('returns empty for nothing to say, so callers can skip spawning', () => {
    expect(joinForSay([])).toBe('');
    expect(joinForSay(undefined)).toBe('');
  });

  it('pads both ends and separates chunks', () => {
    expect(
      joinForSay(['One.', 'Two.'], { leadSilenceMs: 700, gapSilenceMs: 300, tailSilenceMs: 700 })
    ).toBe('[[slnc 700]] One. [[slnc 300]] Two. [[slnc 700]]');
  });

  it('emits no gap marker for a single chunk', () => {
    const joined = joinForSay(['Only one.'], { leadSilenceMs: 10, tailSilenceMs: 20 });
    expect(joined).toBe('[[slnc 10]] Only one. [[slnc 20]]');
  });

  it('still emits a leading marker at zero silence, so text can never look like a flag', () => {
    // normalize() strips leading punctuation but not a hyphen, and the text is the last
    // positional argument to `say` — without this prefix, `say` would parse it as an option.
    const joined = joinForSay(['-- and that is the catch.']);
    expect(joined.startsWith('[[slnc 0]] ')).toBe(true);
  });

  it('defaults every silence to zero', () => {
    expect(joinForSay(['Hi.'])).toBe('[[slnc 0]] Hi. [[slnc 0]]');
  });

  it('treats negative and nonsense silences as zero', () => {
    expect(joinForSay(['Hi.'], { leadSilenceMs: -50, tailSilenceMs: NaN })).toBe(
      '[[slnc 0]] Hi. [[slnc 0]]'
    );
  });

  it('adds no brackets beyond the silence markers themselves', () => {
    const joined = joinForSay(['Alpha.', 'Beta.'], { gapSilenceMs: 300 });
    expect(joined.replace(/\[\[slnc \d+\]\]/g, '')).not.toMatch(/[[\]]/);
  });
});
