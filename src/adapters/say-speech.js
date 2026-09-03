/**
 * SpeechPort over `bin/say-server.js`, a tiny local helper that hands text to the macOS `say`
 * command. This is the way to use a voice already installed on the presenter's Mac — including
 * a Siri voice, which no browser can ever reach directly (see the README).
 *
 * A browser tab cannot run a native binary, so this talks to the helper over plain HTTP on
 * localhost rather than doing anything itself. That helper is the one piece of this engine that
 * only exists on macOS; everything in this file is ordinary browser code and behaves the same
 * everywhere `fetch` does.
 */

import { joinForSay } from '../core/say-format.js';
import { pickVoice } from '../core/voice.js';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:5757';

/**
 * Silence padding, in milliseconds, for the `[[slnc N]]` embedded commands below.
 *
 * `say` hands samples to a CoreAudio output device that is idle when the process starts, and it
 * exits as soon as the synthesiser is done — before the hardware buffer has drained. Left alone
 * that clips the first and last word of every slide. Leading silence gives the device time to
 * spin up before any speech, trailing silence keeps the process alive until the buffer flushes.
 *
 * Measured on macOS: the silence actually produced runs roughly 250ms shorter than the value
 * requested (and bottoms out around 250ms), so these are sized to buy ~450ms at each end. It is
 * rate-independent — the server's `-r` flag does not scale it.
 */
const DEFAULT_LEAD_SILENCE_MS = 700;
const DEFAULT_TAIL_SILENCE_MS = 700;
const DEFAULT_GAP_SILENCE_MS = 300;

/**
 * @param {object} [options]
 * @param {string} [options.serverUrl] where `bin/say-server.js` is listening
 * @param {typeof fetch} [options.fetchImpl] injectable for tests
 * @param {number} [options.leadSilenceMs] silence before the first word; raise it if a slow
 *   output device (Bluetooth especially) still clips the opening word
 * @param {number} [options.tailSilenceMs] silence after the last word
 * @param {number} [options.gapSilenceMs] silence between chunks
 * @returns {import('../ports.js').SpeechPort}
 */
export function createSaySpeech(options = {}) {
  const {
    serverUrl = DEFAULT_SERVER_URL,
    fetchImpl = fetch,
    leadSilenceMs = DEFAULT_LEAD_SILENCE_MS,
    tailSilenceMs = DEFAULT_TAIL_SILENCE_MS,
    gapSilenceMs = DEFAULT_GAP_SILENCE_MS
  } = options;

  // The server's own known-good voices are fetched once and kept for the life of the plugin —
  // the server queries `say -v ?` itself, so there is nothing to poll for on this side beyond
  // that one round trip.
  let liveVoices = null;
  const voicesListeners = new Set();
  fetchImpl(`${serverUrl}/voices`)
    .then((res) => (res.ok ? res.json() : null))
    .then((voices) => {
      if (!Array.isArray(voices)) return;
      liveVoices = voices;
      for (const listener of voicesListeners) listener();
    })
    .catch(() => {}); // reported properly the first time speak() actually needs the server

  // The epoch of the queue we are currently allowed to play. Every request checks it before
  // acting, so a response arriving after the presenter has moved on is dropped rather than
  // speaking over whatever slide they are on now.
  let liveEpoch = null;
  let abortController = null;

  async function speak(request, handlers) {
    const { chunks, epoch, settings = {} } = request;
    liveEpoch = epoch;

    if (chunks.length === 0) {
      // Nothing to say — padding alone would spawn a process just to play silence.
      liveEpoch = null;
      handlers.onFinished(epoch);
      return;
    }

    const { voice } = resolveVoice(settings);
    const voiceName = voice ? voice.name : '';

    // One utterance, padded at both ends. Speaking everything in a single subprocess removes the
    // per-sentence device init/teardown, and the padding covers the one remaining open and close
    // (see the DEFAULT_*_SILENCE_MS notes above). joinForSay() is shared with the server and the
    // offline file renderer so all three agree on exactly what `say` receives.
    const joined = joinForSay(chunks, { leadSilenceMs, gapSilenceMs, tailSilenceMs });

    abortController = new AbortController();
    let response;
    try {
      response = await fetchImpl(`${serverUrl}/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: joined, voice: voiceName, rate: settings.rate }),
        signal: abortController.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') return; // stop() during this request — expected
      if (liveEpoch !== epoch) return;
      liveEpoch = null;
      handlers.onFailed(epoch, unreachableMessage(serverUrl));
      return;
    }

    if (liveEpoch !== epoch) return; // stop() arrived while the response was in flight

    if (!response.ok) {
      liveEpoch = null;
      handlers.onFailed(epoch, await describeFailure(response));
      return;
    }

    if (liveEpoch === epoch) {
      liveEpoch = null;
      handlers.onFinished(epoch);
    }
  }

  function stop() {
    liveEpoch = null;
    abortController?.abort();
    // Aborting the fetch alone does not reliably stop the server-side `say` process — the
    // request may already have been fully sent and be executing by the time we abort here — so
    // tell the server explicitly rather than trusting a dropped connection to be noticed.
    fetchImpl(`${serverUrl}/stop`, { method: 'POST' }).catch(() => {});
  }

  function listVoices() {
    return liveVoices ?? [{ name: 'system-default', lang: '', default: true }];
  }

  function resolveVoice(settings = {}) {
    return pickVoice(listVoices(), { name: settings.voice, lang: settings.lang });
  }

  function onVoicesChanged(listener) {
    voicesListeners.add(listener);
    return () => voicesListeners.delete(listener);
  }

  return { speak, stop, listVoices, resolveVoice, onVoicesChanged };
}

async function describeFailure(response) {
  try {
    const body = await response.json();
    if (body?.error) return body.error;
  } catch {
    // fall through to the generic message below
  }
  return `say-server responded with ${response.status}`;
}

function unreachableMessage(serverUrl) {
  return `Could not reach the say-server at ${serverUrl}. Run "node bin/say-server.js" first.`;
}
