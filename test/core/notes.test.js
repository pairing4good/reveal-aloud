/**
 * The note-to-speech pipeline: what comes out of a slide's notes and in what pieces.
 */

import { describe, expect, it } from 'vitest';
import { toSpeech } from '../../src/core/notes.js';
import { stripSilent } from '../../src/core/brackets.js';
import { normalize } from '../../src/core/text.js';
import { chunk } from '../../src/core/chunk.js';

const speak = (text, options) => toSpeech([{ kind: 'text', text }], options).chunks;

describe('stage directions in brackets', () => {
  it('removes a bracketed aside and leaves the sentence intact', () => {
    expect(speak('Welcome. [pause here] Now the agenda.')).toEqual([
      'Welcome.',
      'Now the agenda.'
    ]);
  });

  it('removes a bracket that sits in the middle of a sentence', () => {
    expect(speak('The build takes [click run] about a minute.')).toEqual([
      'The build takes about a minute.'
    ]);
  });

  it('removes nested brackets as a single silent span', () => {
    expect(stripSilent('a [b [c] d] e').text).toBe('a  e');
  });

  it('removes a bracket that spans several lines', () => {
    expect(speak('Before.\n[skip this\nand this]\nAfter.')).toEqual(['Before.', 'After.']);
  });

  it('drops the rest of the note after an unclosed bracket, and says so', () => {
    const result = toSpeech([{ kind: 'text', text: 'Spoken. [never closed' }]);

    expect(result.chunks).toEqual(['Spoken.']);
    expect(result.unclosedBracket).toBe(true);
  });

  it('speaks brackets the author escaped with a backslash', () => {
    expect(speak('Press \\[esc\\] to exit.')).toEqual(['Press [esc] to exit.']);
  });

  it('does not speak a stray closing bracket', () => {
    expect(speak('A stray ] bracket.')).toEqual(['A stray bracket.']);
  });
});

describe('tidying up what bracket removal leaves behind', () => {
  it('closes up the gap before punctuation', () => {
    expect(normalize('Hello [name], welcome')).toBe('Hello [name], welcome');
    expect(speak('Hello [say their name], welcome.')).toEqual(['Hello, welcome.']);
  });

  it('collapses the double space left where a bracket used to be', () => {
    expect(speak('Done. [beat] Next.')).toEqual(['Done.', 'Next.']);
  });

  it('drops punctuation left stranded at the start of a line', () => {
    expect(speak('[greeting], everyone.')).toEqual(['everyone.']);
  });

  it('does not read markdown emphasis characters out loud', () => {
    expect(speak('This is *really* `important`.')).toEqual(['This is really important.']);
  });
});

describe('breaking notes into utterances', () => {
  it('gives each sentence its own utterance, so the narrator breathes', () => {
    expect(chunk('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does not split a decimal number or a domain name', () => {
    expect(chunk('Pi is 3.14 here. See example.com next.')).toEqual([
      'Pi is 3.14 here.',
      'See example.com next.'
    ]);
  });

  it('does not split on a common abbreviation', () => {
    expect(chunk('Dr. Smith spoke. Then e.g. this happened.')).toEqual([
      'Dr. Smith spoke.',
      'Then e.g. this happened.'
    ]);
  });

  it('splits a sentence that would outrun the engine, preferring a comma', () => {
    const pieces = chunk('alpha, beta, gamma, delta, epsilon, zeta', { maxChars: 20 });

    expect(pieces).toEqual(['alpha, beta, gamma,', 'delta, epsilon, zeta']);
  });

  it('keeps every utterance short enough that Chrome will not truncate it', () => {
    const long = 'word '.repeat(400);

    for (const piece of chunk(long)) expect(piece.length).toBeLessThanOrEqual(180);
  });

  it('treats a line break in the notes as a pause', () => {
    expect(chunk('First point\nSecond point')).toEqual(['First point', 'Second point']);
  });
});

describe('slides that produce no speech at all', () => {
  it.each([
    ['a slide with no notes element', []],
    ['an empty note', [{ kind: 'text', text: '' }]],
    ['a whitespace-only note', [{ kind: 'text', text: '  \n \t ' }]],
    ['a note that is entirely a stage direction', [{ kind: 'text', text: '[all of it]' }]],
    ['a note left as bare punctuation', [{ kind: 'text', text: '...' }]]
  ])('stays silent for %s', (_name, blocks) => {
    expect(toSpeech(blocks).chunks).toEqual([]);
  });
});

describe('code in speaker notes', () => {
  const blocks = [
    { kind: 'text', text: 'Run the installer.' },
    { kind: 'code', text: 'npm install reveal-aloud --save-dev' }
  ];

  it('skips code by default, because symbols read badly out loud', () => {
    expect(toSpeech(blocks).chunks).toEqual(['Run the installer.']);
  });

  it('reads code when the presenter asks for it', () => {
    expect(toSpeech(blocks, { speakCode: true }).chunks).toEqual([
      'Run the installer.',
      'npm install reveal-aloud --save-dev'
    ]);
  });
});
