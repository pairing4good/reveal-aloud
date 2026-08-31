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
    indicator = { show: vi.fn(), destroy: vi.fn() };
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
    plugin = createPlugin({ clock, speech, indicator: { show() {}, destroy() {} }, scope: window });
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
      indicator: { show() {}, destroy() {} },
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
      indicator: { show() {}, destroy() {} },
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
