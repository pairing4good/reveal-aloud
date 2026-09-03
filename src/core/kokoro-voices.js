/**
 * PURE. Kokoro's voice roster, with the quality grades its authors publish.
 *
 * The grades are the whole point of this table. Kokoro ships 28 voices and they are *not*
 * interchangeable: two are genuinely excellent, a handful are usable, and the rest range down to
 * `am_adam` at F+. Picking blind means auditioning 28 voices by ear. Carrying the grades lets
 * every listing — the CLI, the demo audition page, `RevealAloud.listVoices()` — sort best-first
 * and say plainly which ones are worth your time.
 *
 * Grades are from the model authors' VOICES.md for hexgrad/Kokoro-82M. `targetQuality` reflects
 * the training data; `overallGrade` also accounts for how much of it there was, and is the one
 * that predicts how a voice actually sounds.
 *
 * This roster is exhaustive and fixed. `kokoro-js` hardcodes the same 28 and validates against
 * them, throwing on anything else — so although the HuggingFace repo also contains Japanese,
 * Chinese, Spanish, Hindi, Italian, Portuguese and French voice files, none of them can be
 * loaded through `kokoro-js` and none belong here.
 */

/** Best to worst. Anything below C+ is a noticeable step down. */
const GRADE_ORDER = ['A', 'A-', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F'];

/** `[id, lang, gender, targetQuality, overallGrade, traits]` */
const ROSTER = [
  ['af_heart', 'en-US', 'Female', 'A', 'A', '❤️'],
  ['af_bella', 'en-US', 'Female', 'A', 'A-', '🔥'],
  ['af_nicole', 'en-US', 'Female', 'B', 'B-', '🎧'],
  ['bf_emma', 'en-GB', 'Female', 'B', 'B-', ''],
  ['af_aoede', 'en-US', 'Female', 'B', 'C+', ''],
  ['af_kore', 'en-US', 'Female', 'B', 'C+', ''],
  ['af_sarah', 'en-US', 'Female', 'B', 'C+', ''],
  ['am_fenrir', 'en-US', 'Male', 'B', 'C+', ''],
  ['am_michael', 'en-US', 'Male', 'B', 'C+', ''],
  ['am_puck', 'en-US', 'Male', 'B', 'C+', ''],
  ['af_alloy', 'en-US', 'Female', 'B', 'C', ''],
  ['af_nova', 'en-US', 'Female', 'B', 'C', ''],
  ['bf_isabella', 'en-GB', 'Female', 'B', 'C', ''],
  ['bm_fable', 'en-GB', 'Male', 'B', 'C', ''],
  ['bm_george', 'en-GB', 'Male', 'B', 'C', ''],
  ['af_sky', 'en-US', 'Female', 'B', 'C-', ''],
  ['bm_lewis', 'en-GB', 'Male', 'C', 'D+', ''],
  ['af_jessica', 'en-US', 'Female', 'C', 'D', ''],
  ['af_river', 'en-US', 'Female', 'C', 'D', ''],
  ['am_echo', 'en-US', 'Male', 'C', 'D', ''],
  ['am_eric', 'en-US', 'Male', 'C', 'D', ''],
  ['am_liam', 'en-US', 'Male', 'C', 'D', ''],
  ['am_onyx', 'en-US', 'Male', 'C', 'D', ''],
  ['bf_alice', 'en-GB', 'Female', 'C', 'D', ''],
  ['bf_lily', 'en-GB', 'Female', 'C', 'D', ''],
  ['bm_daniel', 'en-GB', 'Male', 'C', 'D', ''],
  ['am_santa', 'en-US', 'Male', 'C', 'D-', '🎅'],
  ['am_adam', 'en-US', 'Male', 'D', 'F+', '']
];

/** The voice used when none is configured — the only one graded A. */
export const DEFAULT_KOKORO_VOICE = 'af_heart';

/**
 * Every Kokoro voice, already sorted best-graded first.
 * `name` rather than `id` because that is the key `pickVoice()` and the SpeechPort contract use.
 *
 * @type {ReadonlyArray<{name: string, lang: string, gender: string, targetQuality: string,
 *   overallGrade: string, traits: string, default: boolean}>}
 */
export const KOKORO_VOICES = Object.freeze(
  ROSTER.map(([name, lang, gender, targetQuality, overallGrade, traits]) =>
    Object.freeze({
      name,
      lang,
      gender,
      targetQuality,
      overallGrade,
      traits,
      default: name === DEFAULT_KOKORO_VOICE
    })
  )
);

/**
 * @param {string} name
 * @returns {object|undefined}
 */
export function kokoroVoice(name) {
  return KOKORO_VOICES.find((voice) => voice.name === name);
}

/**
 * Where a grade sits, for sorting. Unknown grades sort last rather than throwing, so a future
 * model revision adding a grade we do not know about degrades gracefully.
 *
 * @param {string} grade
 * @returns {number}
 */
export function gradeRank(grade) {
  const index = GRADE_ORDER.indexOf(grade);
  return index === -1 ? GRADE_ORDER.length : index;
}

/**
 * Suggestions for a voice id that is not in the roster. Catches the common cases — a typo, the
 * right voice with the wrong accent prefix, or one of the non-English ids that exist in the
 * HuggingFace repo but that `kokoro-js` cannot load.
 *
 * @param {string} name what the user asked for
 * @param {number} [limit]
 * @returns {string[]} voice ids, closest first
 */
export function suggestVoices(name, limit = 3) {
  const wanted = String(name ?? '').toLowerCase();
  const stem = wanted.includes('_') ? wanted.slice(wanted.indexOf('_') + 1) : wanted;

  const scored = KOKORO_VOICES.map((voice) => {
    const id = voice.name.toLowerCase();
    const voiceStem = id.slice(id.indexOf('_') + 1);
    let score = 0;
    if (voiceStem === stem) score += 100; // same person, different accent prefix
    else if (voiceStem.startsWith(stem) || stem.startsWith(voiceStem)) score += 50;
    else if (stem && voiceStem.includes(stem)) score += 25;
    return { name: voice.name, score, rank: gradeRank(voice.overallGrade) };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.rank - b.rank);
  const matches = scored.slice(0, limit).map((entry) => entry.name);

  // Nothing resembled it, so recommend by quality instead of leaving them with nothing.
  return matches.length > 0 ? matches : KOKORO_VOICES.slice(0, limit).map((v) => v.name);
}
