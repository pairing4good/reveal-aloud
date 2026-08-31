/**
 * Composition root. Builds the adapters, feeds their events to the core, and carries out the
 * commands the core returns. There is deliberately no decision-making here — if you find
 * yourself adding an `if` about *what should be spoken*, it belongs in `src/core/narrator.js`
 * where it can be tested without a browser.
 */

import { Command, Event, Status, initialState, isOn, reduce } from '../core/narrator.js';
import { createWebSpeech, isSpeechSupported } from '../adapters/web-speech.js';
import { createDeckAdapter, isPrintView } from '../adapters/reveal-deck.js';
import { createDomIndicator, createNullIndicator } from '../adapters/dom-indicator.js';
import { createBrowserClock } from '../adapters/browser-clock.js';

export const DEFAULTS = Object.freeze({
  /** Voice name as the operating system reports it. Substring matches are fine. */
  voice: '',
  lang: '',
  /** Web Speech scale: 1 is normal, 0.5 half speed, 2 double. */
  rate: 1,
  pitch: 1,
  volume: 1,
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

  function warnIfVoiceMissing() {
    if (!config.voice) return;
    const { warning } = speech.resolveVoice(settingsFrom(config));
    if (warning === 'voice-not-found') {
      scope.console?.warn(
        `[reveal-aloud] Voice "${config.voice}" is not installed on this machine — using the ` +
          'default instead. Run RevealAloud.listVoices() to see what is available.'
      );
    }
  }

  const plugin = {
    id: 'aloud',

    init(deck) {
      config = { ...DEFAULTS, ...(deck.getConfig?.().aloud ?? {}), ...(overrides.config ?? {}) };

      speech = overrides.speech ?? (isSpeechSupported(scope) ? createWebSpeech() : null);
      if (!speech || isPrintView(deck, scope)) {
        // Exporting to PDF, or a browser with no speech engine: do nothing at all rather
        // than half-install and throw on the first keypress.
        if (!speech) {
          scope.console?.warn('[reveal-aloud] This browser has no speech synthesis; narration is off.');
        }
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
      const unsubscribe = speech.onVoicesChanged(() => {
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
    setVoice: (voice) => dispatch({ type: Event.SETTINGS_CHANGED, settings: { voice } }),
    setRate: (rate) => dispatch({ type: Event.SETTINGS_CHANGED, settings: { rate } }),
    configure: (settings) => dispatch({ type: Event.SETTINGS_CHANGED, settings }),
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
