/**
 * Properties of the tidy-up pass.
 *
 * Its job is to make text that a voice can read without stumbling, while never changing what
 * the note actually says. Those two halves are the properties below.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { hasSpeakableContent, normalize } from '../../src/core/text.js';
import { RUNS, params, plainText, speakableText } from './arbitraries.js';

describe(`normalize, over ${RUNS} generated notes`, () => {
  it('is idempotent: tidy text is left alone', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        const once = normalize(text);

        expect(normalize(once)).toBe(once);
      }),
      params
    );
  });

  it('never leaves a double space or a space before punctuation for the voice to trip on', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        const result = normalize(text);

        expect(result).not.toMatch(/ {2}/);
        expect(result).not.toMatch(/ [,.;:!?]/);
      }),
      params
    );
  });

  it('never leaves blank or padded lines, so chunking cannot produce empty utterances', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        const result = normalize(text);
        if (result === '') return; // a silent note has no lines at all

        for (const line of result.split('\n')) {
          expect(line).toBe(line.trim());
          expect(line).not.toBe('');
        }
      }),
      params
    );
  });

  it('never silences a note that had something to say', () => {
    fc.assert(
      fc.property(speakableText, (text) => {
        expect(normalize(text)).not.toBe('');
      }),
      params
    );
  });

  it('never invents speech for a note with nothing to say', () => {
    const unspeakable = fc.stringOf(fc.constantFrom(...' \t\n.,;:!?-*`'.split('')), {
      maxLength: 40
    });

    fc.assert(
      fc.property(unspeakable, (text) => {
        expect(normalize(text)).toBe('');
      }),
      params
    );
  });

  it('keeps every word of the note, in order', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        const words = (input) => input.match(/[\p{L}\p{N}]+/gu) ?? [];

        expect(words(normalize(text))).toEqual(words(text));
      }),
      params
    );
  });

  it('agrees with hasSpeakableContent about whether there is anything to say', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        expect(normalize(text) === '').toBe(!hasSpeakableContent(text));
      }),
      params
    );
  });
});
