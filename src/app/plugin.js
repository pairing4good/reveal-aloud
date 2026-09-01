/**
 * Composition root. Builds the adapters, feeds their events to the core, and carries out the
 * commands the core returns. There is deliberately no decision-making here — if you find
 * yourself adding an `if` about *what should be spoken*, it belongs in `src/core/narrator.js`
 * where it can be tested without a browser.
 */

import { Command, Event, Status, initialState, isOn, reduce } from '../core/narrator.js';
import { createWebSpeech, isSpeechSupported } from '../adapters/web-speech.js';
import { createKokoroSpeech, isKokoroSupported } from '../adapters/kokoro-speech.js';
import { createSaySpeech } from '../adapters/say-speech.js';
import { createDeckAdapter, isPrintView } from '../adapters/reveal-deck.js';
import { createDomIndicator, createNullIndicator } from '../adapters/dom-indicator.js';
import { createBrowserClock } from '../adapters/browser-clock.js';

export const DEFAULTS = Object.freeze({
  /**
   * Which engine speaks the notes.
   *   'webspeech' — the operating system's built-in voices. Free, instant, no download.
   *   'kokoro'    — an open-weights model that runs in the browser, sounds far less robotic,
   *                 and is also free — at the cost of a one-time model download (tens of MB)
   *                 and a short per-sentence generation delay. See demo/voices.html to compare.
   *   'say'       — a voice already installed on the presenter's Mac, including a Siri voice
   *                 that no browser can ever reach on its own. Needs `node bin/say-server.js`
   *                 running alongside the deck. See the README.
   */
  engine: 'webspeech',
  /** Voice name. For 'webspeech' this is whatever the OS reports; for 'kokoro' it is an id
   *  like 'af_bella' — run RevealAloud.listVoices() after switching engines to see the list. */
  voice: '',
  lang: '',
  /** Speaking speed: 1 is normal, 0.5 half speed, 2 double. */
  rate: 1,
  pitch: 1,
  volume: 1,
  /** kokoro only: where to load the `kokoro-js` library from. */
  kokoroModuleUrl: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm',
  /** kokoro only: which model to fetch. */
  kokoroModel: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  /** kokoro only: smaller downloads faster with no noticeable quality loss at 'q8'. */
  kokoroDtype: 'q8',
  /** kokoro only: 'webgpu' is faster where supported; 'wasm' works everywhere. */
  kokoroDevice: 'wasm',
  /** say only: where `bin/say-server.js` is listening. */
  sayServerUrl: 'http://127.0.0.1:5757',
  /** Start narrating as soon as the deck loads (after the first keypress or click). */
  autoStart: false,
  /** The shortcut that turns narration on and off. */
  key: 'R',
  /** Stop narrating while the tab is in the background. */
  pauseWhenHidden: true,
  /** Read `<code>` and `<pre>` inside notes. Off: symbols rarely read well. */
  speakCode: false,
  /** Longest utterance handed to the engine; Chrome truncates long ones. */
  maxChars: 180,
  /** Show the status badge in the corner. */
  indicator: true,
  /** Wait this long before starting, so holding an arrow key does not stutter. */
  startDelayMs: 120
});

/**
 * @param {object} [overrides] injected adapters, for tests
 * @returns {object} a reveal.js plugin
 */
export function createPlugin(overrides = {}) {
  const scope = overrides.scope ?? globalThis;
  let state;
  let speech;
  let clock;
  let indicator;
  let deckAdapter;
  let config = { ...DEFAULTS };

  function dispatch(event) {
    const result = reduce(state, event);
    state = result.state;
    for (const command of result.commands) run(command);
  }

  function run(command) {
    switch (command.type) {
      case Command.STOP:
        // Cancel the pending start too, or a superseded slide would speak after all.
        clock.cancel();
        speech.stop();
        break;

      case Command.SPEAK:
        clock.delay(config.startDelayMs, () => speech.speak(command, handlers));
        break;

      case Command.SHOW:
        indicator.show(command.status, command.detail);
        break;
    }
  }

  /**
   * Applies a settings change from the public API.
   *
   * Re-checks the voice whenever one is named: switching to an unavailable voice mid-talk is
   * exactly as silent a failure as configuring one, and deserves the same warning.
   */
  function applySettings(settings) {
    config = { ...config, ...settings };
    dispatch({ type: Event.SETTINGS_CHANGED, settings });
    if ('voice' in settings || 'lang' in settings) warnIfVoiceMissing();
  }

  const handlers = {
    onFinished: (epoch) => dispatch({ type: Event.SPEECH_FINISHED, epoch }),
    onFailed: (epoch, error) => dispatch({ type: Event.SPEECH_FAILED, epoch, error })
  };

  function settingsFrom(cfg) {
    return {
      voice: cfg.voice,
      lang: cfg.lang,
      rate: cfg.rate,
      pitch: cfg.pitch,
      volume: cfg.volume,
      speakCode: cfg.speakCode,
      maxChars: cfg.maxChars
    };
  }

  /**
   * Builds the speech engine named by `config.engine`, or null when this browser cannot run it
   * — init() treats a null engine as "do nothing" rather than crashing on the first keypress.
   */
  function createSpeech() {
    if (config.engine === 'say') {
      return createSaySpeech({ serverUrl: config.sayServerUrl });
    }

    if (config.engine === 'kokoro') {
      if (!isKokoroSupported(scope)) {
        scope.console?.warn(
          '[reveal-aloud] This browser cannot run Kokoro (no WebAssembly); narration is off.'
        );
        return null;
      }
      return createKokoroSpeech({
        moduleUrl: config.kokoroModuleUrl,
        modelId: config.kokoroModel,
        dtype: config.kokoroDtype,
        device: config.kokoroDevice,
        onProgress: ({ loaded, total }) => {
          const pct = Math.round((loaded / total) * 100);
          indicator?.progress(`Downloading voice model… ${pct}%`, pct >= 100);
        }
      });
    }

    if (!isSpeechSupported(scope)) {
      scope.console?.warn('[reveal-aloud] This browser has no speech synthesis; narration is off.');
      return null;
    }
    return createWebSpeech();
  }

  /**
   * Tells the presenter when the voice they asked for is not one this browser can use.
   *
   * This is the single most common way to be surprised by reveal-aloud, and it is silent by
   * nature: narration works, it just does not sound like what was configured. macOS makes it
   * especially easy to hit — the Siri voices in System Settings are reserved by Apple and are
   * never offered to a browser, so naming one always lands here.
   */
  function warnIfVoiceMissing() {
    if (!speech || !indicator || !config.voice) return;
    const { voice, warning } = speech.resolveVoice(settingsFrom(config));
    if (warning !== 'voice-not-found') return;

    const using = voice ? `using “${voice.name}” instead` : 'no voice available';
    indicator.warn(`Voice “${config.voice}” is not available — ${using}`);
    scope.console?.warn(
      `[reveal-aloud] Voice "${config.voice}" is not available to this browser — ${using}. ` +
        'Run RevealAloud.listVoices() for the exact names you can use. ' +
        'Note that macOS Siri voices are reserved by Apple and never appear in that list.'
    );
  }

  const plugin = {
    id: 'aloud',

    init(deck) {
      config = { ...DEFAULTS, ...(deck.getConfig?.().aloud ?? {}), ...(overrides.config ?? {}) };

      speech = overrides.speech ?? createSpeech();
      if (!speech || isPrintView(deck, scope)) {
        // Exporting to PDF, or a browser this engine cannot run on: do nothing at all rather
        // than half-install and throw on the first keypress.
        return;
      }

      clock = overrides.clock ?? createBrowserClock(scope);
      indicator =
        overrides.indicator ??
        (config.indicator ? createDomIndicator({ doc: scope.document }) : createNullIndicator());

      state = initialState({
        autoStart: config.autoStart,
        requiresGesture: true,
        settings: settingsFrom(config)
      });

      deckAdapter = createDeckAdapter({
        deck,
        dispatch,
        config,
        scope,
        onUnload: () => speech.stop()
      });
      deckAdapter.listen();
      if (config.autoStart) deckAdapter.armGesture();

      // Voices arrive asynchronously in Chrome, so the "no such voice" check waits for them.
      let unsubscribe = () => {};
      unsubscribe = speech.onVoicesChanged(() => {
        warnIfVoiceMissing();
        unsubscribe();
      });
      if (speech.listVoices().length > 0) warnIfVoiceMissing();
    },

    // ---- public API: Reveal.getPlugin('aloud') ----
    toggle: () => dispatch({ type: Event.TOGGLE_PRESSED }),
    start: () => dispatch({ type: Event.START_REQUESTED }),
    stop: () => dispatch({ type: Event.STOP_REQUESTED }),
    replay: () => dispatch({ type: Event.REPLAY_REQUESTED }),
    isOn: () => Boolean(state && isOn(state)),
    listVoices: () => (speech ? speech.listVoices().map(describeVoice) : []),
    setVoice: (voice) => applySettings({ voice }),
    setRate: (rate) => applySettings({ rate }),
    configure: (settings) => applySettings(settings),
    getState: () => state,
    destroy: () => {
      deckAdapter?.destroy();
      clock?.cancel();
      speech?.stop();
      indicator?.destroy();
    }
  };

  return plugin;
}

export { Status };

function describeVoice(voice) {
  return { name: voice.name, lang: voice.lang, default: Boolean(voice.default) };
}
