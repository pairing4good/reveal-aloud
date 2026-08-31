/**
 * The composition root: does the wiring actually deliver the core's decisions to the adapters?
 *
 * The behaviour tests prove the decisions are right and the adapter tests prove each effect
 * works. What is only visible here is the seam between them — in particular the delayed start,
 * which is what stops a held-down arrow key from stuttering the first syllable of ten slides,
 * and which must be cancelled when the presenter moves on again before it fires.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlugin, DEFAULTS } from '../../src/app/plugin.js';

/** A reveal.js deck, reduced to the parts this plugin uses. */
function fakeDeck(config = {}) {
  return {
    handlers: {},
    binding: null,
    slide: null,
    getConfig: () => ({ aloud: config }),
    getCurrentSlide() {
      return this.slide;
    },
    on(name, handler) {
      this.handlers[name] = handler;
    },
    addKeyBinding(binding, handler) {
      this.binding = { binding, handler };
    },
    emit(name) {
      this.handlers[name]?.();
    },
    /** Puts the presenter on a slide with these notes and tells the plugin about it. */
    goTo(notes) {
      const section = document.createElement('section');
      if (notes !== null) {
        const aside = document.createElement('aside');
        aside.className = 'notes';
        aside.textContent = notes;
        section.appendChild(aside);
      }
      document.body.appendChild(section);
      this.slide = section;
      this.emit('slidechanged');
    }
  };
}

/** A clock the test advances by hand. */
function manualClock() {
  let pending = null;
  return {
    delay: (_ms, fn) => {
      pending = fn;
    },
    cancel: () => {
      pending = null;
    },
    tick: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    get hasPending() {
      return pending !== null;
    }
  };
}

function recordingSpeech() {
  return {
    said: [],
    stops: 0,
    live: null,
    speak(request, handlers) {
      this.said.push(request.chunks);
      this.live = { request, handlers };
    },
    stop() {
      this.stops++;
      this.live = null;
    },
    finish() {
      const { request, handlers } = this.live ?? {};
      this.live = null;
      if (request) handlers.onFinished(request.epoch);
    },
    listVoices: () => [],
    resolveVoice: () => ({ voice: null, warning: null }),
    onVoicesChanged: () => () => {}
  };
}

describe('wiring the core to the adapters', () => {
  let deck;
  let clock;
  let speech;
  let indicator;
  let plugin;

  beforeEach(() => {
    document.body.innerHTML = '';
    deck = fakeDeck();
    clock = manualClock();
    speech = recordingSpeech();
    indicator = { show: vi.fn(), warn: vi.fn(), destroy: vi.fn() };
    plugin = createPlugin({ clock, speech, indicator, scope: window });
    plugin.init(deck);
  });

  it('speaks the slide the presenter is actually on when the key is pressed', () => {
    deck.goTo('Notes for this slide.');

    deck.binding.handler();
    clock.tick();

    expect(speech.said).toEqual([['Notes for this slide.']]);
  });

  it('waits before speaking, so holding the arrow key does not stutter every slide', () => {
    deck.binding.handler();
    deck.goTo('First.');

    expect(speech.said).toEqual([]); // nothing said yet — the start is still pending
    clock.tick();
    expect(speech.said).toEqual([['First.']]);
  });

  it('never speaks a slide the presenter has already skipped past', () => {
    deck.binding.handler();

    deck.goTo('First.');
    deck.goTo('Second.');
    deck.goTo('Third.');
    clock.tick();

    // Only the slide they landed on is read, not the ones they raced through.
    expect(speech.said).toEqual([['Third.']]);
  });

  it('silences the engine the instant the presenter advances', () => {
    deck.binding.handler();
    deck.goTo('First.');
    clock.tick();

    deck.goTo('Second.');

    expect(speech.stops).toBe(1);
  });

  it('drops a pending start when narration is switched off before it fires', () => {
    deck.binding.handler();
    deck.goTo('First.');
    expect(clock.hasPending).toBe(true);

    deck.binding.handler(); // off again
    clock.tick();

    expect(speech.said).toEqual([]);
  });

  it('reads the following slide after the engine reports it has finished', () => {
    deck.binding.handler();
    deck.goTo('First.');
    clock.tick();
    speech.finish();

    deck.goTo('Second.');
    clock.tick();

    expect(speech.said).toEqual([['First.'], ['Second.']]);
  });

  it('says nothing on a slide with no notes, and stays on for the next one', () => {
    deck.binding.handler();

    deck.goTo(null);
    clock.tick();
    expect(speech.said).toEqual([]);
    expect(plugin.isOn()).toBe(true);

    deck.goTo('Notes are back.');
    clock.tick();
    expect(speech.said).toEqual([['Notes are back.']]);
  });

  it('keeps stage directions silent all the way through the wiring', () => {
    deck.binding.handler();

    deck.goTo('Say this. [but not this] And this.');
    clock.tick();

    expect(speech.said).toEqual([['Say this.', 'And this.']]);
  });

  it('tells the indicator what is going on', () => {
    deck.binding.handler();
    deck.goTo('Notes.');

    expect(indicator.show).toHaveBeenCalledWith('speaking', undefined);
  });
});

describe('the public API on Reveal.getPlugin("aloud")', () => {
  let deck;
  let clock;
  let speech;
  let plugin;

  beforeEach(() => {
    document.body.innerHTML = '';
    deck = fakeDeck();
    clock = manualClock();
    speech = recordingSpeech();
    plugin = createPlugin({ clock, speech, indicator: { show() {}, warn() {}, destroy() {} }, scope: window });
    plugin.init(deck);
    deck.goTo('Some notes.');
  });

  it('starts and stops narration', () => {
    plugin.start();
    clock.tick();
    expect(plugin.isOn()).toBe(true);
    expect(speech.said).toEqual([['Some notes.']]);

    plugin.stop();
    expect(plugin.isOn()).toBe(false);
    expect(speech.stops).toBe(1);
  });

  it('changes the speaking rate for what is said next', () => {
    plugin.start();
    clock.tick();

    plugin.setRate(1.6);
    clock.tick();

    expect(speech.live.request.settings.rate).toBe(1.6);
  });

  it('re-reads the current slide on demand', () => {
    plugin.start();
    clock.tick();
    speech.finish();

    plugin.replay();
    clock.tick();

    expect(speech.said).toEqual([['Some notes.'], ['Some notes.']]);
  });
});

describe('when the plugin should keep out of the way', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing at all when the deck is being exported to PDF', () => {
    const deck = fakeDeck();
    const speech = recordingSpeech();
    const plugin = createPlugin({
      speech,
      clock: manualClock(),
      indicator: { show() {}, warn() {}, destroy() {} },
      scope: { ...window, location: { search: '?print-pdf' } }
    });

    plugin.init(deck);

    expect(deck.binding).toBeNull();
    expect(deck.handlers).toEqual({});
  });

  it('does nothing when the browser cannot speak', () => {
    const deck = fakeDeck();
    const plugin = createPlugin({
      scope: { console: { warn: vi.fn() }, location: { search: '' } }
    });

    plugin.init(deck);

    expect(deck.binding).toBeNull();
  });
});

describe('configuration', () => {
  it('uses R as the shortcut, which reveal.js leaves free', () => {
    expect(DEFAULTS.key).toBe('R');
  });

  it('lets the deck override any default', () => {
    document.body.innerHTML = '';
    const deck = fakeDeck({ key: 'T', rate: 1.25 });
    const speech = recordingSpeech();
    const clock = manualClock();
    const plugin = createPlugin({
      speech,
      clock,
      indicator: { show() {}, warn() {}, destroy() {} },
      scope: window
    });

    plugin.init(deck);
    deck.goTo('Notes.');
    deck.binding.handler();
    clock.tick();

    expect(deck.binding.binding.key).toBe('T');
    expect(speech.live.request.settings.rate).toBe(1.25);
  });
});

describe('when the configured voice is not one the browser can use', () => {
  /**
   * The case that prompted this: a presenter picks a Siri voice in macOS System Settings and
   * names it in their config. Apple reserves those voices and never offers them to a browser,
   * so narration quietly runs in some other voice. Failing silently here is the worst outcome —
   * everything works, it just sounds wrong, and there is nothing on screen to explain why.
   */
  function pluginWith(voiceName, installed) {
    document.body.innerHTML = '';
    const deck = fakeDeck({ voice: voiceName });
    const indicator = { show: vi.fn(), warn: vi.fn(), destroy: vi.fn() };
    const speech = {
      ...recordingSpeech(),
      listVoices: () => installed,
      resolveVoice: () => ({
        voice: installed[0] ?? null,
        warning: installed.some((v) => v.name === voiceName) ? null : 'voice-not-found'
      })
    };
    const warnings = [];
    // Spy on the real window's console rather than passing a stand-in object: spreading
    // `window` drops its prototype methods, and the adapter needs addEventListener.
    const spy = vi.spyOn(console, 'warn').mockImplementation((m) => warnings.push(m));
    const plugin = createPlugin({ speech, indicator, clock: manualClock(), scope: window });
    plugin.init(deck);
    spy.mockRestore();
    return { indicator, warnings };
  }

  const installed = [{ name: 'Samantha', lang: 'en-US' }];

  it('says so on screen, not only in a console nobody has open', () => {
    const { indicator } = pluginWith('Siri (Voice 2)', installed);

    expect(indicator.warn).toHaveBeenCalledOnce();
    expect(indicator.warn.mock.calls[0][0]).toContain('Siri (Voice 2)');
  });

  it('names the voice it fell back to, so the presenter knows what they will hear', () => {
    const { indicator } = pluginWith('Siri (Voice 2)', installed);

    expect(indicator.warn.mock.calls[0][0]).toContain('Samantha');
  });

  it('points at listVoices() and explains the Siri restriction in the console', () => {
    const { warnings } = pluginWith('Siri (Voice 2)', installed);

    expect(warnings.join(' ')).toMatch(/listVoices/);
    expect(warnings.join(' ')).toMatch(/Siri/i);
  });

  it('stays quiet when the configured voice is available', () => {
    const { indicator, warnings } = pluginWith('Samantha', installed);

    expect(indicator.warn).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it('stays quiet when no voice was configured at all', () => {
    const { indicator } = pluginWith('', installed);

    expect(indicator.warn).not.toHaveBeenCalled();
  });
});

describe('changing the voice while presenting', () => {
  it('warns again when the new voice is not one the browser can use', () => {
    document.body.innerHTML = '';
    const deck = fakeDeck();
    const indicator = { show: vi.fn(), warn: vi.fn(), destroy: vi.fn() };
    const plugin = createPlugin({
      indicator,
      clock: manualClock(),
      scope: window,
      speech: {
        ...recordingSpeech(),
        listVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
        resolveVoice: (settings) => ({
          voice: { name: 'Samantha' },
          warning: settings.voice === 'Samantha' ? null : 'voice-not-found'
        })
      }
    });
    plugin.init(deck);
    expect(indicator.warn).not.toHaveBeenCalled();

    plugin.setVoice('Siri (Voice 2)');

    expect(indicator.warn).toHaveBeenCalledOnce();
    expect(indicator.warn.mock.calls[0][0]).toContain('Siri (Voice 2)');
  });

  it('does not warn when only the speed changes', () => {
    document.body.innerHTML = '';
    const deck = fakeDeck({ voice: 'Nonexistent' });
    const indicator = { show: vi.fn(), warn: vi.fn(), destroy: vi.fn() };
    const plugin = createPlugin({
      indicator,
      clock: manualClock(),
      scope: window,
      speech: {
        ...recordingSpeech(),
        listVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
        resolveVoice: () => ({ voice: { name: 'Samantha' }, warning: 'voice-not-found' })
      }
    });
    plugin.init(deck);
    indicator.warn.mockClear();

    plugin.setRate(1.5);

    expect(indicator.warn).not.toHaveBeenCalled();
  });
});

describe('choosing the speech engine', () => {
  it('defaults to Web Speech', () => {
    document.body.innerHTML = '';
    const deck = fakeDeck();
    // Spreading `window` drops its prototype methods (addEventListener among them), which the
    // deck adapter needs — so stub speechSynthesis on the real window instead.
    const define = (name, value) =>
      Object.defineProperty(window, name, { value, configurable: true, writable: true });
    define('speechSynthesis', { getVoices: () => [], addEventListener() {}, removeEventListener() {} });
    define('SpeechSynthesisUtterance', function () {});

    const plugin = createPlugin({
      indicator: { show() {}, warn() {}, progress() {}, destroy() {} },
      clock: manualClock(),
      scope: window
    });

    plugin.init(deck);

    // Reaching init() without throwing, with the browser's speech globals present and no
    // `engine` configured, proves the Web Speech path was taken — createKokoroSpeech never
    // touches speechSynthesis at all.
    expect(deck.binding).not.toBeNull();
  });

  it('does nothing when Kokoro is requested on a browser with no WebAssembly', () => {
    document.body.innerHTML = '';
    const deck = fakeDeck({ engine: 'kokoro' });
    const warnings = [];
    const plugin = createPlugin({
      scope: { ...window, WebAssembly: undefined, console: { warn: (m) => warnings.push(m) } }
    });

    plugin.init(deck);

    expect(deck.binding).toBeNull();
    expect(warnings.join(' ')).toMatch(/Kokoro/);
  });

  it('reports Kokoro download progress through the indicator', async () => {
    document.body.innerHTML = '';
    const deck = fakeDeck({ engine: 'kokoro' });
    const indicator = { show: vi.fn(), warn: vi.fn(), progress: vi.fn(), destroy: vi.fn() };
    let capturedOnProgress;
    const kokoroModule = await import('../../src/adapters/kokoro-speech.js');
    const spy = vi
      .spyOn(kokoroModule, 'createKokoroSpeech')
      .mockImplementation((options) => {
        capturedOnProgress = options.onProgress;
        return {
          speak() {},
          stop() {},
          listVoices: () => [],
          resolveVoice: () => ({ voice: null, warning: null }),
          onVoicesChanged: () => () => {}
        };
      });

    const plugin = createPlugin({ indicator, clock: manualClock(), scope: window });
    plugin.init(deck);
    capturedOnProgress({ loaded: 50, total: 100 });

    expect(indicator.progress).toHaveBeenCalledWith('Downloading voice model… 50%', false);
    spy.mockRestore();
  });
});
