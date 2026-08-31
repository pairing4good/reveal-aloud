/**
 * The driving adapter: reveal.js and the browser on one side, plain events on the other.
 *
 * It also owns the one piece of DOM reading in the project — turning a slide's speaker notes
 * into `Block`s. Doing that here rather than in the core is what lets every rule about what
 * gets spoken be tested without a DOM.
 */

import { Event } from '../core/narrator.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Tags whose contents are symbols, not prose. */
const CODE_TAGS = new Set(['PRE', 'CODE', 'SAMP', 'KBD', 'VAR']);

/** Tags that should make the narrator take a breath. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR'
]);

/**
 * Reads the speaker notes of one slide as plain data.
 *
 * The resolution order matches reveal's own notes plugin, so what the narrator says and what
 * the speaker view shows never disagree:
 *   1. a `data-notes` attribute on the slide
 *   2. otherwise every `aside.notes` belonging to *this* slide
 *
 * Notes inside a fragment are skipped — reveal reveals those as the fragment appears, and
 * reading them up front would give away the slide.
 *
 * @param {Element|null} slide
 * @returns {Array<{kind: string, text?: string}>}
 */
export function slideToBlocks(slide) {
  if (!slide || slide.nodeType !== ELEMENT_NODE) return [];

  if (slide.hasAttribute('data-notes')) {
    return tidy([{ kind: 'text', text: unwrap(slide.getAttribute('data-notes')) }]);
  }

  const asides = Array.from(slide.querySelectorAll('aside.notes')).filter(
    // A vertical stack must not inherit its children's notes, and fragment notes wait.
    (aside) => aside.closest('section') === slide && !aside.closest('.fragment')
  );

  const blocks = [];
  asides.forEach((aside, index) => {
    if (index > 0) pushBreak(blocks);
    appendChildren(aside, blocks);
  });
  return tidy(blocks);
}

function appendChildren(node, blocks) {
  for (const child of node.childNodes) {
    if (child.nodeType === TEXT_NODE) {
      pushText(blocks, child.nodeValue);
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue; // comments and the like are not spoken

    const tag = child.tagName.toUpperCase();

    if (CODE_TAGS.has(tag)) {
      pushBreak(blocks);
      blocks.push({ kind: 'code', text: child.textContent });
      pushBreak(blocks);
      continue;
    }
    if (tag === 'BR') {
      pushBreak(blocks);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      pushBreak(blocks);
      appendChildren(child, blocks);
      pushBreak(blocks);
      continue;
    }
    appendChildren(child, blocks); // inline markup: em, strong, a, span…
  }
}

function pushText(blocks, text) {
  const unwrapped = unwrap(text);
  if (!unwrapped) return;
  const last = blocks[blocks.length - 1];
  if (last && last.kind === 'text') last.text += unwrapped;
  else blocks.push({ kind: 'text', text: unwrapped });
}

/**
 * Collapses the line breaks an author used to wrap their HTML source.
 *
 * In HTML a newline in the middle of a sentence is ordinary whitespace, so it must not become
 * a pause — otherwise notes wrapped at eighty columns get read with a hiccup in the middle of
 * every line. Real pauses come from `<br>` and from block elements, which become breaks above.
 */
function unwrap(text) {
  return typeof text === 'string' ? text.replace(/\s*\n\s*/g, ' ') : '';
}

function pushBreak(blocks) {
  const last = blocks[blocks.length - 1];
  if (!last || last.kind === 'break') return; // no leading or doubled breaks
  blocks.push({ kind: 'break' });
}

function tidy(blocks) {
  const kept = blocks.filter(
    (block) => block.kind !== 'text' || block.text.trim() !== ''
  );
  while (kept.length > 0 && kept[kept.length - 1].kind === 'break') kept.pop();
  return kept;
}

/**
 * Subscribes to everything that should change what the narrator is doing.
 *
 * @param {object} options
 * @param {object} options.deck the reveal.js instance
 * @param {(event: object) => void} options.dispatch
 * @param {{key: string, pauseWhenHidden: boolean}} options.config
 * @param {() => void} options.onUnload
 * @param {Window} [options.scope]
 * @returns {{listen: () => void, currentBlocks: () => Array, armGesture: () => void, destroy: () => void}}
 */
export function createDeckAdapter({ deck, dispatch, config, onUnload, scope = globalThis }) {
  const teardown = [];
  const currentBlocks = () => slideToBlocks(deck.getCurrentSlide?.() ?? null);
  const enter = () => dispatch({ type: Event.SLIDE_ENTERED, blocks: currentBlocks() });

  function on(target, name, handler) {
    target.addEventListener(name, handler);
    teardown.push(() => target.removeEventListener(name, handler));
  }

  function listen() {
    // `ready` covers the opening slide, including a deep link such as `#/4`.
    deck.on('ready', enter);
    // One handler for next, previous, jumping, the menu and back/forward — they are all
    // "you are now on a different slide", and all behave identically.
    deck.on('slidechanged', enter);
    deck.on('overviewshown', () => dispatch({ type: Event.OVERVIEW_SHOWN }));
    deck.on('overviewhidden', () => dispatch({ type: Event.OVERVIEW_HIDDEN }));
    deck.on('paused', () => dispatch({ type: Event.DECK_PAUSED }));
    deck.on('resumed', () => dispatch({ type: Event.DECK_RESUMED }));
    // Fragments are deliberately not wired: revealing a bullet is not a new slide.

    deck.addKeyBinding(
      {
        keyCode: config.key.toUpperCase().charCodeAt(0),
        key: config.key.toUpperCase(),
        description: 'Toggle narration (read speaker notes aloud)'
      },
      () => dispatch({ type: Event.TOGGLE_PRESSED })
    );

    if (config.pauseWhenHidden && scope.document) {
      on(scope.document, 'visibilitychange', () => {
        dispatch({
          type: scope.document.hidden ? Event.PAGE_HIDDEN : Event.PAGE_VISIBLE
        });
      });
    }

    // Chrome happily keeps talking after the page has gone.
    on(scope, 'beforeunload', onUnload);
    on(scope, 'pagehide', onUnload);
  }

  /** Waits for the first interaction, which is when browsers start allowing audio. */
  function armGesture() {
    const fire = () => {
      release();
      dispatch({ type: Event.USER_GESTURE });
    };
    const release = () => {
      scope.removeEventListener('keydown', fire);
      scope.removeEventListener('pointerdown', fire);
    };
    scope.addEventListener('keydown', fire, { once: true });
    scope.addEventListener('pointerdown', fire, { once: true });
    teardown.push(release);
  }

  function destroy() {
    while (teardown.length > 0) teardown.pop()();
  }

  return { listen, currentBlocks, armGesture, destroy };
}

/** @returns {boolean} true when the deck is being rendered for PDF export, not presented. */
export function isPrintView(deck, scope = globalThis) {
  if (typeof deck?.isPrintingPDF === 'function' && deck.isPrintingPDF()) return true;
  return /print-pdf/gi.test(scope.location?.search ?? '');
}
