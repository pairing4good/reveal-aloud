/**
 * PURE. The two things everyone who drives macOS `say` has to get exactly right.
 *
 * Both live here rather than at the call sites because there are now three of them — the live
 * server, the browser adapter that talks to it, and the offline file renderer — and the moment
 * any two disagree, exported audio stops matching what the deck actually says out loud. That is
 * a silent failure: the files are fine, they are just the wrong length.
 */

/** `say -r` is words per minute, and this is the rate the voices are tuned around. */
const BASE_WORDS_PER_MINUTE = 175;

/** Below this `say` is unintelligible, and it clamps internally anyway. */
const MIN_WORDS_PER_MINUTE = 60;

/**
 * Converts reveal-aloud's rate multiplier into the words-per-minute `say -r` wants.
 *
 * Note the result is an integer, so 1.0 and 1.003 produce byte-identical audio. That is fine —
 * it just means the manifest should report the WPM it actually used rather than the rate asked
 * for, so a duration that looks "wrong" for the rate is explainable.
 *
 * @param {number} rate 1 is normal, 0.5 half speed, 2 double. Anything non-positive means 1.
 * @returns {number} integer words per minute, never below 60
 */
export function toWordsPerMinute(rate) {
  const multiplier = Number(rate) > 0 ? Number(rate) : 1;
  return Math.max(MIN_WORDS_PER_MINUTE, Math.round(BASE_WORDS_PER_MINUTE * multiplier));
}

/**
 * Joins chunks into the single utterance `say` receives, with `[[slnc N]]` — a native macOS
 * embedded command for N milliseconds of silence — marking the pauses.
 *
 * Injecting the markers here rather than upstream in the note pipeline is deliberate.
 * `stripSilent()` has already removed every bracket from the notes — a property test asserts
 * core output can never contain `[` or `]` — so these are the only embedded commands `say` will
 * ever see, and the chunk text needs no escaping. Moving this earlier would break that.
 *
 * The leading marker is emitted even when the silence is zero, and that is load-bearing: the
 * text is the last positional argument to `say`, and `normalize()` strips leading punctuation
 * but not a leading hyphen. A note opening with "-- and that's the catch" would otherwise be
 * parsed as a flag. `[[slnc 0]]` renders nothing and makes that impossible.
 *
 * @param {string[]} chunks already stripped and normalized, in order
 * @param {{leadSilenceMs?: number, gapSilenceMs?: number, tailSilenceMs?: number}} [options]
 *   milliseconds of silence before the first word, between chunks, and after the last word
 * @returns {string} empty when there is nothing to say, so callers can skip spawning entirely
 */
export function joinForSay(chunks, options = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return '';

  const lead = silence(options.leadSilenceMs);
  const gap = silence(options.gapSilenceMs);
  const tail = silence(options.tailSilenceMs);

  return `[[slnc ${lead}]] ` + chunks.join(` [[slnc ${gap}]] `) + ` [[slnc ${tail}]]`;
}

function silence(ms) {
  const value = Math.round(Number(ms));
  return Number.isFinite(value) && value > 0 ? value : 0;
}
