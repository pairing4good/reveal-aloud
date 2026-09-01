/**
 * PURE. Chooses which installed voice to use.
 *
 * The browser hands us whatever the operating system has; the presenter names one in their
 * config. Those two rarely line up exactly — the same name exists in several languages
 * ("Daniel" is both en-GB and fr-FR), names carry suffixes, and a deck opened on another
 * machine may not have the voice at all. Picking must therefore always succeed, and must
 * say when it fell back so the presenter finds out before they are on stage.
 */

/**
 * @typedef {{name: string, lang?: string, default?: boolean}} VoiceInfo
 * @typedef {{voice: VoiceInfo|null, warning: 'no-voices'|'voice-not-found'|null}} VoiceChoice
 */

/**
 * @param {VoiceInfo[]} voices voices the engine reports as installed
 * @param {{name?: string, lang?: string}} [preference]
 * @returns {VoiceChoice}
 */
export function pickVoice(voices, preference = {}) {
  const available = Array.isArray(voices) ? voices.filter(isVoice) : [];
  if (available.length === 0) return { voice: null, warning: 'no-voices' };

  const { name, lang } = preference;

  if (typeof name === 'string' && name.trim() !== '') {
    const wanted = name.trim().toLowerCase();
    const exact = available.filter((v) => v.name.toLowerCase() === wanted);
    const partial = available.filter((v) => v.name.toLowerCase().includes(wanted));
    const match = preferLanguage(exact, lang) ?? preferLanguage(partial, lang);
    if (match) return { voice: match, warning: null };
    // Named a voice this machine does not have: still speak, but say so.
    return { voice: fallback(available, lang), warning: 'voice-not-found' };
  }

  return { voice: fallback(available, lang), warning: null };
}

function fallback(available, lang) {
  return (
    preferLanguage(available, lang) ??
    available.find((v) => v.default === true) ??
    available[0]
  );
}

/** Exact language wins, then the base language ('en' matches 'en-GB'), then anything. */
function preferLanguage(candidates, lang) {
  if (candidates.length === 0) return null;
  if (typeof lang !== 'string' || lang === '') return candidates[0];

  const wanted = lang.toLowerCase();
  const base = wanted.split('-')[0];
  return (
    candidates.find((v) => (v.lang ?? '').toLowerCase() === wanted) ??
    candidates.find((v) => (v.lang ?? '').toLowerCase().split('-')[0] === base) ??
    candidates[0]
  );
}

function isVoice(voice) {
  return Boolean(voice) && typeof voice.name === 'string';
}
