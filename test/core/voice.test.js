/**
 * Choosing a voice. The presenter names one in their config; the machine has whatever it has.
 * Picking must always produce a usable voice and must say when it could not honour the name.
 */

import { describe, expect, it } from 'vitest';
import { pickVoice } from '../../src/core/voice.js';

const VOICES = [
  { name: 'Alex', lang: 'en-US', default: true },
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Daniel', lang: 'fr-FR' },
  { name: 'Amélie', lang: 'fr-CA' }
];

describe('honouring the configured voice', () => {
  it('picks the voice named in the config', () => {
    expect(pickVoice(VOICES, { name: 'Samantha' }).voice.name).toBe('Samantha');
  });

  it('ignores capitalisation, so "samantha" works', () => {
    expect(pickVoice(VOICES, { name: 'samantha' }).voice.name).toBe('Samantha');
  });

  it('accepts a partial name, so "Ale" finds "Alex"', () => {
    expect(pickVoice(VOICES, { name: 'Ale' }).voice.name).toBe('Alex');
  });

  it('uses the language to choose between voices that share a name', () => {
    expect(pickVoice(VOICES, { name: 'Daniel', lang: 'fr-FR' }).voice.lang).toBe('fr-FR');
    expect(pickVoice(VOICES, { name: 'Daniel', lang: 'en-GB' }).voice.lang).toBe('en-GB');
  });
});

describe('when the configured voice is not installed', () => {
  it('still returns a usable voice rather than falling silent', () => {
    const { voice } = pickVoice(VOICES, { name: 'Sofia' });

    expect(voice).not.toBeNull();
  });

  it('reports the fallback, so the presenter finds out before they are on stage', () => {
    expect(pickVoice(VOICES, { name: 'Sofia' }).warning).toBe('voice-not-found');
  });

  it('falls back to a voice that at least speaks the right language', () => {
    const { voice } = pickVoice(VOICES, { name: 'Sofia', lang: 'fr-FR' });

    expect(voice.lang.startsWith('fr')).toBe(true);
  });
});

describe('when the config names no voice', () => {
  it('prefers the requested language', () => {
    expect(pickVoice(VOICES, { lang: 'fr-CA' }).voice.name).toBe('Amélie');
  });

  it("matches a base language, so 'en' finds 'en-US'", () => {
    expect(pickVoice(VOICES, { lang: 'en' }).voice.lang).toBe('en-US');
  });

  it("uses the system default when there is nothing else to go on", () => {
    expect(pickVoice(VOICES, {}).voice.name).toBe('Alex');
  });

  it('raises no warning, because nothing was asked for', () => {
    expect(pickVoice(VOICES, {}).warning).toBeNull();
  });
});

describe('when the browser reports no voices at all', () => {
  it('returns nothing to speak with and says why', () => {
    expect(pickVoice([], { name: 'Samantha' })).toEqual({ voice: null, warning: 'no-voices' });
  });
});
