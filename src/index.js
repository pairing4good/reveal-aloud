/**
 * reveal-aloud — read your reveal.js speaker notes aloud.
 *
 *   <script src="reveal-aloud.js"></script>
 *   Reveal.initialize({ plugins: [ RevealAloud ] });
 *
 * Then press R.
 */

import { createPlugin, DEFAULTS } from './app/plugin.js';
import { createWebSpeech, isSpeechSupported } from './adapters/web-speech.js';
import { slideToBlocks } from './adapters/reveal-deck.js';
import { toSpeech } from './core/notes.js';

/** reveal.js calls this to get a fresh plugin, so two decks on a page cannot collide. */
function RevealAloud() {
  return createPlugin();
}

/**
 * Lists the voices installed on this machine.
 * Handy from the browser console: `RevealAloud.listVoices()`.
 */
RevealAloud.listVoices = function listVoices() {
  if (!isSpeechSupported()) return [];
  return createWebSpeech()
    .listVoices()
    .map((voice) => ({ name: voice.name, lang: voice.lang, default: Boolean(voice.default) }));
};

/**
 * Shows what would be spoken for a slide, without speaking it.
 *
 * Useful for checking your stage directions came out right:
 * `RevealAloud.preview(Reveal.getCurrentSlide())`
 *
 * @param {Element} slide a reveal.js `<section>`
 * @param {object} [options] the same options as the `aloud` config block
 * @returns {{chunks: string[], unclosedBracket: boolean}}
 */
RevealAloud.preview = function preview(slide, options = {}) {
  return toSpeech(slideToBlocks(slide), { ...DEFAULTS, ...options });
};

RevealAloud.defaults = DEFAULTS;

export default RevealAloud;
export { createPlugin, DEFAULTS };
