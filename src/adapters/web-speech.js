/**
 * SpeechPort over the browser's built-in speech synthesis.
 *
 * Free on every Mac, nothing to install, and the voices are whatever the operating system
 * has — which is why the README points presenters at System Settings to download better
 * ones. A `say`-command adapter can replace this file wholesale later; nothing outside it
 * knows the Web Speech API exists.
 *
 * Two quirks of the API are handled here and nowhere else:
 *
 *  - Utterances longer than roughly fifteen seconds are truncated by Chrome, so we speak a
 *    queue of short chunks rather than one long one. The next utterance is created inside
 *    the previous one's `end` callback, which also keeps us clear of the cancel/speak race.
 *  - `cancel()` fires `error: 'interrupted'` on whatever was playing. That is us doing our
 *    job, not a failure, so it must never reach the core as one.
 */

import { pickVoice } from '../core/voice.js';

/**
 * @param {object} [options]
 * @param {SpeechSynthesis} [options.synth]
 * @param {typeof SpeechSynthesisUtterance} [options.Utterance]
 * @returns {import('../ports.js').SpeechPort}
 */
export function createWebSpeech(options = {}) {
  const synth = options.synth ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;

  // The epoch of the queue we are currently allowed to speak for. `null` means silent.
  // Every callback checks it, so callbacks from a cancelled queue quietly disappear.
  let liveEpoch = null;

  function speak(request, handlers) {
    const { chunks, epoch, settings = {} } = request;
    liveEpoch = epoch;

    // Chrome can be left in a paused state by a previous cancel; speaking into it is silent.
    if (synth.paused) synth.resume();

    const { voice } = resolveVoice(settings);
    let index = 0;

    const next = () => {
      if (liveEpoch !== epoch) return;

      if (index >= chunks.length) {
        liveEpoch = null;
        handlers.onFinished(epoch);
        return;
      }

      const utterance = new Utterance(chunks[index++]);
      if (voice) utterance.voice = voice;
      if (settings.lang) utterance.lang = settings.lang;
      if (typeof settings.rate === 'number') utterance.rate = settings.rate;
      if (typeof settings.pitch === 'number') utterance.pitch = settings.pitch;
      if (typeof settings.volume === 'number') utterance.volume = settings.volume;

      utterance.onend = () => next();
      utterance.onerror = (event) => {
        if (liveEpoch !== epoch) return;
        if (isExpectedInterruption(event)) return;
        liveEpoch = null;
        handlers.onFailed(epoch, event?.error ?? 'speech-failed');
      };

      synth.speak(utterance);
    };

    next();
  }

  function stop() {
    liveEpoch = null;
    synth.cancel();
  }

  function listVoices() {
    const voices = synth.getVoices?.() ?? [];
    return Array.from(voices);
  }

  function resolveVoice(settings = {}) {
    return pickVoice(listVoices(), { name: settings.voice, lang: settings.lang });
  }

  function onVoicesChanged(listener) {
    // Chrome reports an empty voice list on first call and fills it in asynchronously.
    if (typeof synth.addEventListener !== 'function') return () => {};
    synth.addEventListener('voiceschanged', listener);
    return () => synth.removeEventListener('voiceschanged', listener);
  }

  return { speak, stop, listVoices, resolveVoice, onVoicesChanged };
}

/** @returns {boolean} whether this browser can speak at all */
export function isSpeechSupported(scope = globalThis) {
  return Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
}

function isExpectedInterruption(event) {
  return event?.error === 'interrupted' || event?.error === 'canceled';
}
