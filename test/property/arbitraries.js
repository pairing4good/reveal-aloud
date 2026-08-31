/**
 * Shared generators and the run-count knob for the property suite.
 *
 * `FC_NUM_RUNS=20000 npm test` (or `npm run test:soak`) re-runs every property with far more
 * cases. The properties below are written so that a failure is always a real defect, not a
 * generator artefact, which is what makes turning the dial up worthwhile.
 */

import fc from 'fast-check';

export const RUNS = Number(process.env.FC_NUM_RUNS ?? 100);

/** @type {import('fast-check').Parameters} */
export const params = { numRuns: RUNS, verbose: true };

/** Ordinary note prose: never contains a bracket or a backslash. */
export const plainText = fc
  .stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?—\'"()\n\t'.split('')
    ),
    { maxLength: 200 }
  );

/** Text that certainly says something out loud. */
export const speakableText = fc
  .tuple(fc.stringMatching(/^[a-z]{1,12}$/), plainText)
  .map(([word, rest]) => `${word} ${rest}`);

/** A stage direction, brackets included. */
export const bracketedSpan = plainText.map((inner) => `[${inner.replace(/[[\]]/g, '')}]`);

/** Note text mixing prose, stage directions and escaped brackets. */
export const noteText = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: plainText },
      { weight: 3, arbitrary: bracketedSpan },
      { weight: 1, arbitrary: fc.constantFrom('\\[', '\\]', '[', ']', '\n') }
    ),
    { maxLength: 12 }
  )
  .map((parts) => parts.join(''));

/** Notes as the adapters hand them to the core. */
export const blocks = fc.array(
  fc.oneof(
    noteText.map((text) => ({ kind: 'text', text })),
    plainText.map((text) => ({ kind: 'code', text })),
    fc.constant({ kind: 'break' })
  ),
  { maxLength: 8 }
);

/** Installed voices, as an operating system might report them. */
export const voiceList = fc.array(
  fc.record({
    name: fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,10}$/),
    lang: fc.constantFrom('en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES', 'ja-JP'),
    default: fc.boolean()
  }),
  { maxLength: 8 }
);

/** Every whitespace character removed — used to prove no text was lost or invented. */
export const squeeze = (text) => text.replace(/\s+/g, '');
