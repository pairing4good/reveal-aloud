/**
 * SpeechPort over Kokoro (https://github.com/hexgrad/kokoro), an 82M-parameter open-weights
 * model that runs entirely in the browser via `kokoro-js` — no server, no account, no per-use
 * cost, and no ceiling on how much it can be used. This is the free option worth reaching for
 * when the operating system's own voices are not good enough.
 *
 * The tradeoff for that quality is a one-time model download (tens of megabytes) and a short
 * per-sentence generation delay, in exchange for audio nothing built into an OS can match at
 * this price. Both costs are minimized here: the model is fetched once and kept for the life of
 * the plugin instance, and generation for the next sentence starts while the current one is
 * still playing, so only the very first sentence of a slide carries a visible gap.
 *
 * kokoro-js is loaded on demand from a CDN rather than bundled, so choosing this engine costs
 * nothing for presenters who do not. `KokoroTTS`, `.generate()` and `RawAudio.toBlob()` are the
 * whole of the public API this file depends on — see https://www.npmjs.com/package/kokoro-js.
 */

import { pickVoice } from '../core/voice.js';

const DEFAULT_MODULE_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * The English voices this model ships with, so `listVoices()` has something to show before the
 * ~90MB model has been fetched. Once loaded, the model's own `list_voices()` is used instead —
 * this table only ever covers the gap before that, and is not consulted again afterward.
 */
const KNOWN_VOICES = [
  ['af_heart', 'en-US'], ['af_bella', 'en-US'], ['af_nicole', 'en-US'], ['af_aoede', 'en-US'],
  ['af_kore', 'en-US'], ['af_sarah', 'en-US'], ['af_nova', 'en-US'], ['af_sky', 'en-US'],
  ['af_alloy', 'en-US'], ['af_jessica', 'en-US'], ['af_river', 'en-US'],
  ['am_adam', 'en-US'], ['am_echo', 'en-US'], ['am_eric', 'en-US'], ['am_fenrir', 'en-US'],
  ['am_liam', 'en-US'], ['am_michael', 'en-US'], ['am_onyx', 'en-US'], ['am_puck', 'en-US'],
  ['bf_alice', 'en-GB'], ['bf_emma', 'en-GB'], ['bf_isabella', 'en-GB'], ['bf_lily', 'en-GB'],
  ['bm_daniel', 'en-GB'], ['bm_fable', 'en-GB'], ['bm_george', 'en-GB'], ['bm_lewis', 'en-GB']
].map(([name, lang]) => ({ name, lang, default: name === 'af_heart' }));

/**
 * @param {object} [options]
 * @param {string} [options.moduleUrl] where to load `kokoro-js` from. If you self-host
 *   this, use an absolute URL: a relative one resolves against the location of
 *   `dist/reveal-aloud.js` itself (per how dynamic `import()` resolves specifiers in a
 *   classic script), not against the presenter's page, which is rarely what is meant.
 * @param {string} [options.modelId] the Hugging Face model repo to fetch
 * @param {'fp32'|'fp16'|'q8'|'q4'|'q4f16'} [options.dtype] smaller = faster download, q8 is the
 *   package's own recommended default and is not noticeably worse than full precision
 * @param {'wasm'|'webgpu'} [options.device] webgpu is faster where it is available; wasm works
 *   everywhere, so it is the safer default for a plugin presenters may run on a machine they
 *   have not tested
 * @param {(update: {loaded: number, total: number}) => void} [options.onProgress] called
 *   repeatedly while the model downloads, so a presenter is not staring at silence
 * @param {(url: string) => Promise<any>} [options.importModule] injectable for tests
 * @param {() => HTMLAudioElement} [options.audioFactory] injectable for tests
 * @returns {import('../ports.js').SpeechPort}
 */
export function createKokoroSpeech(options = {}) {
  const {
    moduleUrl = DEFAULT_MODULE_URL,
    modelId = DEFAULT_MODEL_ID,
    dtype = 'q8',
    device = 'wasm',
    onProgress = () => {},
    importModule = (url) => import(/* webpackIgnore: true */ url),
    audioFactory = () => new Audio()
  } = options;

  let modelPromise = null;
  let liveVoices = null;
  // The epoch of the queue we are currently allowed to play. `null` means silent. Every step —
  // generation finishing, an element firing `ended` — checks this before acting, so work left
  // over from a slide the presenter already advanced past cannot start talking.
  let liveEpoch = null;
  let activePlayback = null;

  function loadModel() {
    if (modelPromise) return modelPromise;
    modelPromise = importModule(moduleUrl)
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(modelId, {
          dtype,
          device,
          progress_callback: (update) => {
            if (update && typeof update.loaded === 'number' && update.total) {
              onProgress({ loaded: update.loaded, total: update.total });
            }
          }
        })
      )
      .then((tts) => {
        if (typeof tts.list_voices === 'function') {
          const names = tts.list_voices();
          if (Array.isArray(names) && names.length > 0) {
            liveVoices = names.map((name) => voiceMetaFor(name));
          }
        }
        return tts;
      });
    return modelPromise;
  }

  async function speak(request, handlers) {
    const { chunks, epoch, settings = {} } = request;
    liveEpoch = epoch;

    let tts;
    try {
      tts = await loadModel();
    } catch (error) {
      if (liveEpoch !== epoch) return; // cancelled while the model was still loading
      liveEpoch = null;
      handlers.onFailed(epoch, describeError(error, 'kokoro-load-failed'));
      return;
    }
    if (liveEpoch !== epoch) return;

    const { voice } = resolveVoice(settings);
    const voiceId = voice ? voice.name : undefined;

    try {
      // Generating the next sentence starts as soon as the current one begins playing, so the
      // wait is paid once per slide rather than once per sentence.
      let pending = generate(tts, chunks[0], voiceId);

      for (let i = 0; i < chunks.length; i++) {
        const blob = await pending;
        if (liveEpoch !== epoch) return;

        pending = i + 1 < chunks.length ? generate(tts, chunks[i + 1], voiceId) : null;

        await play(blob, epoch, settings);
        if (liveEpoch !== epoch) return;
      }
    } catch (error) {
      if (liveEpoch !== epoch) return; // stop() during generation or playback, not a failure
      liveEpoch = null;
      handlers.onFailed(epoch, describeError(error, 'kokoro-speech-failed'));
      return;
    }

    if (liveEpoch === epoch) {
      liveEpoch = null;
      handlers.onFinished(epoch);
    }
  }

  async function generate(tts, text, voiceId) {
    const audio = await tts.generate(text, voiceId ? { voice: voiceId } : undefined);
    return audio.toBlob();
  }

  /** Plays one blob to completion, resolving on `ended` and settling early if `stop()` runs. */
  function play(blob, epoch, settings) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const el = audioFactory();
      el.src = url;
      if (typeof settings.rate === 'number') el.playbackRate = settings.rate;
      if (typeof settings.volume === 'number') el.volume = settings.volume;

      const finish = (fn, value) => {
        if (activePlayback?.el === el) activePlayback = null;
        URL.revokeObjectURL(url);
        el.onended = null;
        el.onerror = null;
        fn(value);
      };

      el.onended = () => finish(resolve);
      el.onerror = () => finish(reject, new Error('kokoro-audio-playback-failed'));
      activePlayback = { el, settle: () => finish(resolve) };

      const played = el.play();
      // `.play()` returns a promise in real browsers; guard for the fakes used in tests.
      if (played?.catch) played.catch((error) => finish(reject, error));
      if (liveEpoch !== epoch) activePlayback?.settle();
    });
  }

  function stop() {
    liveEpoch = null;
    if (activePlayback) {
      activePlayback.el.pause();
      activePlayback.settle();
    }
  }

  function listVoices() {
    return liveVoices ?? KNOWN_VOICES;
  }

  function resolveVoice(settings = {}) {
    return pickVoice(listVoices(), { name: settings.voice, lang: settings.lang });
  }

  /** Kokoro's roster is fixed for a given model, so there is no async arrival to wait for. */
  function onVoicesChanged(_listener) {
    return () => {};
  }

  return {
    speak,
    stop,
    listVoices,
    resolveVoice,
    onVoicesChanged,
    /** Starts the model download ahead of the first `speak()`, e.g. from a "load now" button. */
    preload: loadModel
  };
}

function voiceMetaFor(name) {
  const known = KNOWN_VOICES.find((v) => v.name === name);
  if (known) return known;
  // An unrecognised id from a future model version: guess the language from Kokoro's own
  // `{language}{gender}_{name}` convention (e.g. `jf_alpha` is Japanese) rather than drop it.
  const lang = { a: 'en-US', b: 'en-GB', j: 'ja-JP', z: 'zh-CN', e: 'es-ES', f: 'fr-FR', h: 'hi-IN', i: 'it-IT', p: 'pt-BR' }[
    name[0]
  ];
  return { name, lang };
}

function describeError(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

/** @returns {boolean} whether this browser can plausibly run Kokoro: WASM plus `<audio>`. */
export function isKokoroSupported(scope = globalThis) {
  return typeof scope.WebAssembly === 'object' && typeof scope.Audio === 'function';
}
