/**
 * Properties of splitting a note into utterances.
 *
 * Chunking exists to work around an engine limit, so the safety property is the important
 * one: whatever the input, no piece may be long enough for Chrome to truncate it, and no word
 * may be lost or invented on the way.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { chunk } from '../../src/core/chunk.js';
import { normalize } from '../../src/core/text.js';
import { RUNS, params, plainText, squeeze } from './arbitraries.js';

const maxChars = fc.integer({ min: 5, max: 200 });

describe(`chunk, over ${RUNS} generated notes`, () => {
  it('never produces an utterance the engine would truncate', () => {
    fc.assert(
      fc.property(plainText, maxChars, (text, limit) => {
        for (const piece of chunk(normalize(text), { maxChars: limit })) {
          expect(piece.length).toBeLessThanOrEqual(limit);
        }
      }),
      params
    );
  });

  it('never produces an empty utterance', () => {
    fc.assert(
      fc.property(plainText, maxChars, (text, limit) => {
        for (const piece of chunk(normalize(text), { maxChars: limit })) {
          expect(piece.trim()).not.toBe('');
        }
      }),
      params
    );
  });

  it('loses nothing and invents nothing: the pieces still spell out the note', () => {
    fc.assert(
      fc.property(plainText, maxChars, (text, limit) => {
        const normalized = normalize(text);

        expect(squeeze(chunk(normalized, { maxChars: limit }).join(''))).toBe(
          squeeze(normalized)
        );
      }),
      params
    );
  });

  it('keeps the words in order', () => {
    fc.assert(
      fc.property(plainText, maxChars, (text, limit) => {
        const normalized = normalize(text);
        const words = (input) => input.match(/[\p{L}\p{N}]+/gu) ?? [];

        // Splitting may cut a long unbroken token in half, so compare letters, not words.
        expect(words(chunk(normalized, { maxChars: limit }).join('')).join('')).toBe(
          words(normalized).join('')
        );
      }),
      params
    );
  });

  it('says nothing at all when there is nothing to say', () => {
    const blank = fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 20 });

    fc.assert(
      fc.property(blank, (text) => {
        expect(chunk(text)).toEqual([]);
      }),
      params
    );
  });

  it('makes progress on any input, however short the limit', () => {
    // A limit smaller than a single word must still terminate rather than loop forever.
    fc.assert(
      fc.property(plainText, fc.integer({ min: -5, max: 3 }), (text, limit) => {
        expect(Array.isArray(chunk(normalize(text), { maxChars: limit }))).toBe(true);
      }),
      params
    );
  });
});
