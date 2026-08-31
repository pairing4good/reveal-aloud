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

import { pickVoice } from '../core/voice.js';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:5757';

/**
 * @param {object} [options]
 * @param {string} [options.serverUrl] where `bin/say-server.js` is listening
 * @param {typeof fetch} [options.fetchImpl] injectable for tests
 * @returns {import('../ports.js').SpeechPort}
 */
export function createSaySpeech(options = {}) {
  const { serverUrl = DEFAULT_SERVER_URL, fetchImpl = fetch } = options;

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

    const { voice } = resolveVoice(settings);
    const voiceName = voice ? voice.name : '';

    for (const text of chunks) {
      if (liveEpoch !== epoch) return;

      abortController = new AbortController();
      let response;
      try {
        response = await fetchImpl(`${serverUrl}/speak`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, voice: voiceName, rate: settings.rate }),
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
