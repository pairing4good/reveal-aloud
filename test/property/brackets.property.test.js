/**
 * Properties of stage-direction removal.
 *
 * The rule is small enough to state exactly: brackets are markup, so an unescaped bracket is
 * never spoken, everything outside brackets always is, and an author can escape a bracket to
 * get it back. Each property below is one of those sentences.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { stripSilent } from '../../src/core/brackets.js';
import { RUNS, noteText, params, plainText } from './arbitraries.js';

describe(`stripSilent, over ${RUNS} generated notes`, () => {
  it('never leaves an unescaped bracket in what will be spoken', () => {
    // Notes with no backslashes at all: every bracket in them is markup.
    const withoutEscapes = noteText.map((text) => text.replace(/\\/g, ''));

    fc.assert(
      fc.property(withoutEscapes, (text) => {
        expect(stripSilent(text).text).not.toMatch(/[[\]]/);
      }),
      params
    );
  });

  it('leaves text with no brackets in it completely alone', () => {
    fc.assert(
      fc.property(plainText, (text) => {
        expect(stripSilent(text)).toEqual({ text, unclosed: false });
      }),
      params
    );
  });

  it('is idempotent on notes that use no escapes', () => {
    // Escapes are deliberately excluded: unescaping cannot be idempotent, because
    // `\\[` is meant to *become* a literal `[`, and a literal `[` is markup again on a
    // second pass. Notes are only ever stripped once, so this is the invariant that matters.
    const withoutEscapes = noteText.map((text) => text.replace(/\\/g, ''));

    fc.assert(
      fc.property(withoutEscapes, (text) => {
        const once = stripSilent(text).text;

        expect(stripSilent(once).text).toBe(once);
      }),
      params
    );
  });

  it('keeps the spoken text in its original order', () => {
    fc.assert(
      fc.property(fc.array(plainText, { maxLength: 6 }), plainText, (spoken, hidden) => {
        const silent = `[${hidden.replace(/[[\]\\]/g, '')}]`;
        const note = spoken.join(silent);

        expect(stripSilent(note).text).toBe(spoken.join(''));
      }),
      params
    );
  });

  it('always gives an escaped bracket back to the voice', () => {
    fc.assert(
      fc.property(plainText, plainText, (before, after) => {
        const note = `${before}\\[${after}`;

        expect(stripSilent(note).text).toBe(`${before}[${after}`);
      }),
      params
    );
  });

  it('reports an unclosed bracket exactly when one was opened and never closed', () => {
    fc.assert(
      fc.property(noteText, (text) => {
        const opens = countUnescaped(text, '[');
        const closes = countUnescaped(text, ']');

        expect(stripSilent(text).unclosed).toBe(opens > closes);
      }),
      params
    );
  });
});

/** Counts brackets that are markup, ignoring escaped ones and already-closed nesting. */
function countUnescaped(text, bracket) {
  let depth = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && (text[i + 1] === '[' || text[i + 1] === ']')) {
      i++;
      continue;
    }
    if (text[i] === '[') {
      if (bracket === '[') count++;
      depth++;
    } else if (text[i] === ']') {
      if (depth > 0) {
        if (bracket === ']') count++;
        depth--;
      }
    }
  }
  return count;
}
