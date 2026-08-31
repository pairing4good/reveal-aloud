/**
 * Reading speaker notes out of a real slide, in a real DOM.
 *
 * This is the one place the project touches the page, so the rules about *which* notes belong
 * to the current slide are pinned down here rather than in the core.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeckAdapter, isPrintView, slideToBlocks } from '../../src/adapters/reveal-deck.js';
import { Event } from '../../src/core/narrator.js';
import { toSpeech } from '../../src/core/notes.js';

/** Builds a deck and returns the slide matching `selector`. */
function slideFrom(html, selector = 'section') {
  document.body.innerHTML = `<div class="reveal"><div class="slides">${html}</div></div>`;
  return document.querySelector(selector);
}

const spoken = (slide, options) => toSpeech(slideToBlocks(slide), options).chunks;

describe('finding the notes that belong to this slide', () => {
  it('reads an <aside class="notes"> element', () => {
    const slide = slideFrom('<section><h2>Title</h2><aside class="notes">Say this.</aside></section>');

    expect(spoken(slide)).toEqual(['Say this.']);
  });

  it('reads a data-notes attribute', () => {
    const slide = slideFrom('<section data-notes="Say this instead."><h2>Title</h2></section>');

    expect(spoken(slide)).toEqual(['Say this instead.']);
  });

  it('prefers data-notes over an aside, matching reveal.js itself', () => {
    const slide = slideFrom(
      '<section data-notes="From the attribute."><aside class="notes">From the aside.</aside></section>'
    );

    expect(spoken(slide)).toEqual(['From the attribute.']);
  });

  it('joins several aside elements in document order', () => {
    const slide = slideFrom(
      '<section><aside class="notes">First.</aside><aside class="notes">Second.</aside></section>'
    );

    expect(spoken(slide)).toEqual(['First.', 'Second.']);
  });

  it('says nothing for a slide with no notes', () => {
    const slide = slideFrom('<section><h2>Just a title</h2></section>');

    expect(spoken(slide)).toEqual([]);
  });

  it('does not read a vertical stack’s children when the stack itself is asked', () => {
    const stack = slideFrom(
      `<section id="stack">
         <section><aside class="notes">Child one.</aside></section>
         <section><aside class="notes">Child two.</aside></section>
       </section>`,
      '#stack'
    );

    expect(spoken(stack)).toEqual([]);
  });

  it('reads only the child slide the presenter is actually on', () => {
    const parent = slideFrom(
      `<section>
         <section id="first"><aside class="notes">Child one.</aside></section>
         <section id="second"><aside class="notes">Child two.</aside></section>
       </section>`,
      '#second'
    );

    expect(spoken(parent)).toEqual(['Child two.']);
  });

  it('skips notes attached to a fragment, which reveal shows later', () => {
    const slide = slideFrom(
      `<section>
         <aside class="notes">Slide notes.</aside>
         <div class="fragment">Later<aside class="notes">Fragment notes.</aside></div>
       </section>`
    );

    expect(spoken(slide)).toEqual(['Slide notes.']);
  });

  it('skips notes on a fragmented list item too', () => {
    const slide = slideFrom(
      `<section>
         <ul><li class="fragment">Point<aside class="notes">Fragment notes.</aside></li></ul>
         <aside class="notes">Slide notes.</aside>
       </section>`
    );

    expect(spoken(slide)).toEqual(['Slide notes.']);
  });
});

describe('turning note markup into something speakable', () => {
  it('treats paragraphs and list items as pauses rather than running them together', () => {
    const slide = slideFrom(
      '<section><aside class="notes"><p>First point</p><ul><li>Second</li><li>Third</li></ul></aside></section>'
    );

    expect(spoken(slide)).toEqual(['First point', 'Second', 'Third']);
  });

  it('treats a <br> as a pause', () => {
    const slide = slideFrom('<section><aside class="notes">One<br>Two</aside></section>');

    expect(spoken(slide)).toEqual(['One', 'Two']);
  });

  it('reads inline emphasis as part of the sentence', () => {
    const slide = slideFrom(
      '<section><aside class="notes">This is <em>very</em> <strong>important</strong>.</aside></section>'
    );

    expect(spoken(slide)).toEqual(['This is very important.']);
  });

  it('does not read HTML comments', () => {
    const slide = slideFrom(
      '<section><aside class="notes">Spoken.<!-- not spoken --></aside></section>'
    );

    expect(spoken(slide)).toEqual(['Spoken.']);
  });

  it('leaves code out by default and includes it on request', () => {
    const slide = slideFrom(
      '<section><aside class="notes">Run it.<pre><code>npm test</code></pre></aside></section>'
    );

    expect(spoken(slide)).toEqual(['Run it.']);
    expect(spoken(slide, { speakCode: true })).toEqual(['Run it.', 'npm test']);
  });

  it('still keeps stage directions silent when they are written in markup', () => {
    const slide = slideFrom(
      '<section><aside class="notes"><p>Welcome. [wait for laughs]</p><p>Now the agenda.</p></aside></section>'
    );

    expect(spoken(slide)).toEqual(['Welcome.', 'Now the agenda.']);
  });
});

describe('subscribing to the deck', () => {
  let deck;
  let dispatch;

  beforeEach(() => {
    document.body.innerHTML = '';
    dispatch = vi.fn();
    deck = {
      handlers: {},
      bindings: [],
      on(name, handler) {
        this.handlers[name] = handler;
      },
      addKeyBinding(binding, handler) {
        this.bindings.push({ binding, handler });
      },
      getCurrentSlide: () => null,
      emit(name) {
        this.handlers[name]?.();
      }
    };
  });

  const adapterFor = (config = {}) =>
    createDeckAdapter({
      deck,
      dispatch,
      config: { key: 'R', pauseWhenHidden: true, ...config },
      onUnload: () => {},
      scope: window
    });

  it('registers the shortcut so it appears in reveal’s own help overlay', () => {
    adapterFor().listen();

    expect(deck.bindings[0].binding).toMatchObject({ keyCode: 82, key: 'R' });
    expect(deck.bindings[0].binding.description).toMatch(/narration/i);
  });

  it('uses whichever key the presenter configured', () => {
    adapterFor({ key: 't' }).listen();

    expect(deck.bindings[0].binding).toMatchObject({ keyCode: 84, key: 'T' });
  });

  it.each([
    ['ready', Event.SLIDE_ENTERED],
    ['slidechanged', Event.SLIDE_ENTERED],
    ['overviewshown', Event.OVERVIEW_SHOWN],
    ['overviewhidden', Event.OVERVIEW_HIDDEN],
    ['paused', Event.DECK_PAUSED],
    ['resumed', Event.DECK_RESUMED]
  ])('turns the reveal.js "%s" event into %s', (revealEvent, coreEvent) => {
    adapterFor().listen();

    deck.emit(revealEvent);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: coreEvent }));
  });

  it('ignores fragments, because revealing a bullet is not a new slide', () => {
    adapterFor().listen();

    expect(deck.handlers.fragmentshown).toBeUndefined();
    expect(deck.handlers.fragmenthidden).toBeUndefined();
  });

  it('stops listening entirely once destroyed', () => {
    const adapter = adapterFor();
    adapter.listen();
    adapter.destroy();
    dispatch.mockClear();

    window.dispatchEvent(new window.Event('beforeunload'));
    document.dispatchEvent(new window.Event('visibilitychange'));

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('exporting to PDF', () => {
  it('is recognised so the plugin can stay out of the way', () => {
    expect(isPrintView({}, { location: { search: '?print-pdf' } })).toBe(true);
    expect(isPrintView({}, { location: { search: '' } })).toBe(false);
    expect(isPrintView({ isPrintingPDF: () => true }, { location: { search: '' } })).toBe(true);
  });
});

describe('line breaks in the author’s HTML source', () => {
  it('does not turn a wrapped line into a pause mid-sentence', () => {
    const slide = slideFrom(
      `<section><aside class="notes">Everyone gets that
       wrong the first time.</aside></section>`
    );

    expect(spoken(slide)).toEqual(['Everyone gets that wrong the first time.']);
  });

  it('still pauses where the author asked for a real break', () => {
    const slide = slideFrom(
      `<section><aside class="notes">First point<br>Second
       point</aside></section>`
    );

    expect(spoken(slide)).toEqual(['First point', 'Second point']);
  });

  it('treats a wrapped data-notes attribute the same way', () => {
    document.body.innerHTML = '';
    const section = document.createElement('section');
    section.setAttribute('data-notes', 'One sentence\n   wrapped in the source.');

    expect(spoken(section)).toEqual(['One sentence wrapped in the source.']);
  });
});
