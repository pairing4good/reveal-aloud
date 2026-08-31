/**
 * Properties of voice selection.
 *
 * Whatever the presenter writes in their config and whatever voices the machine happens to
 * have, choosing must never end in silence and must never quietly substitute a different
 * voice without saying so.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { pickVoice } from '../../src/core/voice.js';
import { RUNS, params, voiceList } from './arbitraries.js';

const preference = fc.record(
  {
    name: fc.option(fc.stringMatching(/^[A-Za-z ]{0,12}$/), { nil: undefined }),
    lang: fc.option(fc.constantFrom('en-US', 'en', 'fr-FR', 'zz-ZZ'), { nil: undefined })
  },
  { requiredKeys: [] }
);

describe(`pickVoice, over ${RUNS} generated voice lists`, () => {
  it('always finds something to speak with when the machine has any voice at all', () => {
    fc.assert(
      fc.property(voiceList.filter((v) => v.length > 0), preference, (voices, want) => {
        expect(pickVoice(voices, want).voice).not.toBeNull();
      }),
      params
    );
  });

  it('only ever returns a voice the machine actually has', () => {
    fc.assert(
      fc.property(voiceList, preference, (voices, want) => {
        const { voice } = pickVoice(voices, want);

        if (voice !== null) expect(voices).toContain(voice);
      }),
      params
    );
  });

  it('warns whenever it could not honour the requested name, and only then', () => {
    fc.assert(
      fc.property(voiceList, preference, (voices, want) => {
        const { voice, warning } = pickVoice(voices, want);

        if (voices.length === 0) {
          expect(warning).toBe('no-voices');
          return;
        }
        const asked = (want.name ?? '').trim().toLowerCase();
        const honoured = asked === '' || voice.name.toLowerCase().includes(asked);

        expect(warning === 'voice-not-found').toBe(!honoured);
      }),
      params
    );
  });

  it('prefers an exact name match over a partial one', () => {
    fc.assert(
      fc.property(voiceList, fc.stringMatching(/^[A-Za-z]{2,8}$/), (others, name) => {
        // Matching is case-insensitive, so any other voice with the same name spelled
        // differently is also an exact match. Keep the planted one unique.
        const noise = others.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
        const exact = { name, lang: 'en-US' };
        const voices = [{ name: `${name}ish`, lang: 'en-US' }, ...noise, exact];

        expect(pickVoice(voices, { name }).voice.name).toBe(name);
      }),
      params
    );
  });

  it('is deterministic: the same machine and the same config give the same voice', () => {
    fc.assert(
      fc.property(voiceList, preference, (voices, want) => {
        expect(pickVoice(voices, want)).toEqual(pickVoice(voices, want));
      }),
      params
    );
  });
});
