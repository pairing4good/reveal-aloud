import { describe, expect, it } from 'vitest';

import {
  SYSTEM_DEFAULT_VOICE,
  isNamedVoice,
  parseVoiceList,
  toVoiceCatalog
} from '../../src/core/say-voices.js';

const SAMPLE = [
  'Alex                en_US    # Most people recognize me by my voice.',
  'Ava (Premium)       en_US    # Hello, my name is Ava.',
  'Daniel              en_GB    # Hello, my name is Daniel.',
  'Amelie              fr_FR    # Bonjour, je m’appelle Amelie.'
].join('\n');

describe('parseVoiceList', () => {
  it('reads name and language, keeping say’s order', () => {
    expect(parseVoiceList(SAMPLE)).toEqual([
      { name: 'Alex', lang: 'en-US' },
      { name: 'Ava (Premium)', lang: 'en-US' },
      { name: 'Daniel', lang: 'en-GB' },
      { name: 'Amelie', lang: 'fr-FR' }
    ]);
  });

  it('keeps spaces and parentheses in names, anchoring on the language tag', () => {
    expect(parseVoiceList('Grandma (Premium)  en_US  # Hi.')[0].name).toBe('Grandma (Premium)');
  });

  it('skips lines that carry no language tag', () => {
    expect(parseVoiceList('\n# a comment\n\nAlex   en_US   # Hi.')).toEqual([
      { name: 'Alex', lang: 'en-US' }
    ]);
  });

  it('does not prepend the system default — toVoiceCatalog does that', () => {
    expect(parseVoiceList(SAMPLE).some((v) => v.name === SYSTEM_DEFAULT_VOICE)).toBe(false);
  });

  it('survives empty output', () => {
    expect(parseVoiceList('')).toEqual([]);
  });
});

describe('toVoiceCatalog', () => {
  it('puts the system default first and marks it, so an unset voice resolves there', () => {
    const catalog = toVoiceCatalog(SAMPLE);
    expect(catalog[0]).toEqual({ name: SYSTEM_DEFAULT_VOICE, lang: '', default: true });
    expect(catalog).toHaveLength(5);
  });
});

describe('isNamedVoice', () => {
  it('is false for the system default, which must be the absence of -v', () => {
    expect(isNamedVoice(SYSTEM_DEFAULT_VOICE)).toBe(false);
  });

  it('is false for nothing configured', () => {
    expect(isNamedVoice('')).toBe(false);
    expect(isNamedVoice(undefined)).toBe(false);
  });

  it('is true for a real voice name', () => {
    expect(isNamedVoice('Ava (Premium)')).toBe(true);
  });
});
