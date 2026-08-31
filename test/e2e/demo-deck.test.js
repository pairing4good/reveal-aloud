/**
 * End-to-end: the real demo deck, real reveal.js, a real browser.
 *
 * The unit tests deliberately stop at the edges of each adapter. This one covers the part
 * nothing else can — that pressing R in an actual reveal.js deck ends up asking the browser to
 * say the right words, and that racing through slides never leaves two notes talking at once.
 *
 * The speech engine is replaced with a recorder before the page scripts run, because a
 * headless browser has no voices and because "what was it asked to say" is the thing worth
 * asserting.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/**
 * Uses Playwright's own browser where one is installed (`npx playwright install chromium`),
 * and falls back to a system Chromium named by CHROMIUM_PATH.
 *
 * Returns null when neither is available, so a contributor who has not downloaded a browser
 * gets a clear skip instead of a wall of failures. CI installs one, so there it must run.
 */
async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (process.env.CHROMIUM_PATH) {
      return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    if (process.env.CI) throw error;
    console.warn(
      '\n  Skipping the end-to-end suite: no browser available.' +
        '\n  Run `npx playwright install chromium`, or set CHROMIUM_PATH.\n'
    );
    return null;
  }
}

let server;
let browser;
let page;
let origin;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async (context) => {
  if (!browser) return context.skip();
  page = await browser.newPage();

  // This sandbox has no outbound network, so the deck's CDN links are served from
  // node_modules. The deck's own markup and the plugin under test are untouched.
  await page.route('https://cdn.jsdelivr.net/npm/reveal.js@*/**', async (route) => {
    const file = route.request().url().replace(/^.*reveal\.js@[^/]+\//, '');
    await route.fulfill({
      body: await readFile(join(ROOT, 'node_modules/reveal.js', file)),
      contentType: TYPES[extname(file)] ?? 'text/plain'
    });
  });

  // Record what the deck asks the browser to say, instead of saying it.
  await page.addInitScript(() => {
    window.__said = [];
    let live = null;
    const define = (name, value) =>
      Object.defineProperty(window, name, { value, configurable: true, writable: true });

    define(
      'SpeechSynthesisUtterance',
      class {
        constructor(text) {
          this.text = text;
        }
      }
    );
    // `speechSynthesis` is a read-only accessor on the real window, so it has to be redefined.
    define('speechSynthesis', {
      paused: false,
      getVoices: () => [{ name: 'Samantha', lang: 'en-US', default: true }],
      addEventListener() {},
      removeEventListener() {},
      resume() {},
      speak(utterance) {
        window.__said.push(utterance.text);
        live = utterance;
      },
      cancel() {
        const interrupted = live;
        live = null;
        interrupted?.onerror?.({ error: 'interrupted' });
      },
      /** Lets a test play an utterance through to its end. */
      __finish() {
        const utterance = live;
        live = null;
        utterance?.onend?.();
      }
    });
  });

  await page.goto(`${origin}/demo/index.html`);
  await page.waitForFunction(() => window.Reveal?.isReady?.());
});

/** Plays the queue out so the whole slide gets spoken. */
async function speakToTheEnd() {
  await page.waitForTimeout(200);
  for (let i = 0; i < 30; i++) {
    const more = await page.evaluate(() => {
      const before = window.__said.length;
      window.speechSynthesis.__finish();
      return window.__said.length > before;
    });
    if (!more) break;
  }
}

/** Lowercased, punctuation-free, single-spaced — so comparison is about words, not typography. */
function normalizeForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Overlapping three-word phrases from a stage direction.
 *
 * Whole-span matching would miss a partial leak, and single words produce false alarms — a
 * stage direction may legitimately share a word with the sentence around it ("[check the
 * clock, is it still morning?]" next to "Good morning, everyone"). Three words in a row
 * appearing in both is a leak, not a coincidence.
 */
function phrasesOf(span) {
  const words = normalizeForComparison(span).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  if (words.length < 3) return [words.join(' ')];
  return words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(' '));
}

const said = () => page.evaluate(() => window.__said);
const clearSaid = () => page.evaluate(() => (window.__said.length = 0));
const goToSlide = (index) => page.evaluate((i) => window.Reveal.slide(i), index);

describe('the demo deck in a real browser', () => {
  it('says nothing until the presenter presses the shortcut key', async () => {
    await page.waitForTimeout(400);

    expect(await said()).toEqual([]);
  });

  it('reads the current slide when R is pressed', async () => {
    await page.keyboard.press('r');
    await speakToTheEnd();

    expect((await said()).join(' ')).toContain('Welcome to the reveal aloud demo');
  });

  it('never speaks the text inside brackets', async () => {
    await goToSlide(2); // "Stage directions in [brackets]"
    await page.keyboard.press('r');
    await speakToTheEnd();

    const spoken = (await said()).join(' ');
    expect(spoken).toContain('It went up by forty percent last quarter.');
    expect(spoken).not.toContain('click to reveal the chart');
    expect(spoken).not.toContain('pause for effect');
  });

  it('stays silent on a slide whose notes are all stage direction', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    await goToSlide(3);
    await page.waitForTimeout(400);

    expect(await said()).toEqual([]);
  });

  it('stays silent on a slide with no notes, then reads the next one that has them', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    await goToSlide(4); // no notes at all
    await page.waitForTimeout(400);
    expect(await said()).toEqual([]);

    await goToSlide(5); // notes come back
    await speakToTheEnd();
    expect((await said()).join(' ')).toContain('Notes are back');
  });

  it('stops the current slide and starts the next one when the presenter advances', async () => {
    await goToSlide(1);
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    await clearSaid();

    await goToSlide(2); // advance while slide 1 is still being read
    await speakToTheEnd();

    const spoken = (await said()).join(' ');
    expect(spoken).toContain('Here is the headline number.');
    expect(spoken).not.toContain('This slide has ordinary speaker notes');
  });

  it('reads the previous slide just like the next one when navigating backwards', async () => {
    await goToSlide(2);
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    await clearSaid();

    await goToSlide(1);
    await speakToTheEnd();

    expect((await said()).join(' ')).toContain('This slide has ordinary speaker notes');
  });

  it('leaves only the final slide talking after racing through the deck', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    for (const index of [1, 2, 5, 6, 1]) await goToSlide(index);
    await speakToTheEnd();

    // Every utterance must belong to the slide the presenter actually stopped on.
    const spoken = (await said()).join(' ');
    expect(spoken).toContain('This slide has ordinary speaker notes');
    expect(spoken).not.toContain('headline number');
    expect(spoken).not.toContain('Notes are back');
  });

  it('stops immediately when the key is pressed again', async () => {
    await goToSlide(13); // the long note
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    const spokenSoFar = (await said()).length;

    await page.keyboard.press('r');
    await page.waitForTimeout(400);

    expect((await said()).length).toBe(spokenSoFar);
  });

  it('splits a long note into utterances short enough to survive Chrome', async () => {
    await goToSlide(13);
    await page.keyboard.press('r');
    await speakToTheEnd();

    const utterances = await said();
    expect(utterances.length).toBeGreaterThan(3);
    for (const utterance of utterances) expect(utterance.length).toBeLessThanOrEqual(180);
  });

  it('reads a data-notes attribute', async () => {
    await goToSlide(10);
    await page.keyboard.press('r');
    await speakToTheEnd();

    const spoken = (await said()).join(' ');
    expect(spoken).toContain('These notes live in a data-notes attribute');
    expect(spoken).not.toContain('both work exactly the same way');
  });

  it('reads only the vertical slide the presenter is on', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    await page.evaluate(() => window.Reveal.slide(11, 1));
    await speakToTheEnd();

    const spoken = (await said()).join(' ');
    expect(spoken).toContain('You are one level down now');
    expect(spoken).not.toContain('This is the top of a vertical stack');
  });

  it('leaves code out of the narration', async () => {
    await goToSlide(12);
    await page.keyboard.press('r');
    await speakToTheEnd();

    const spoken = (await said()).join(' ');
    expect(spoken).toContain('Run the installer while you are talking.');
    expect(spoken).not.toContain('npm install reveal-aloud');
  });

  it('goes quiet in the slide overview and picks up again on the way out', async () => {
    await goToSlide(1);
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    await clearSaid();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await said()).toEqual([]);

    await page.keyboard.press('Escape');
    await speakToTheEnd();
    expect((await said()).join(' ')).toContain('This slide has ordinary speaker notes');
  });

  it('registers its shortcut in reveal’s own help overlay', async () => {
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    const help = await page.evaluate(() => document.body.innerText);
    expect(help).toMatch(/narration/i);
  });

  it('leaves reveal’s own keys alone', async () => {
    await page.keyboard.press('b'); // blackout
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.Reveal.isPaused())).toBe(true);
  });
});

describe('what actually reaches the speech engine', () => {
  /**
   * The strongest statement this project can make, checked at the real boundary.
   *
   * `window.speechSynthesis.speak()` is the last thing the plugin touches before the operating
   * system does — past the core, past the adapter, past every layer. This walks the entire demo
   * deck, records every string handed to that call, and holds it against two independent checks:
   *
   *   1. the engine received exactly the utterances the plugin says it should, slide by slide;
   *   2. no stage direction — no bracketed span anywhere in the deck — appears in any of them.
   *
   * The second check reads the brackets straight out of the deck's HTML, so it stays honest
   * even if the plugin's own idea of what is silent were ever wrong, and any slide added to the
   * demo later is covered without touching this test.
   */
  it('is exactly the spoken text, and never one word of a stage direction', async () => {
    const slideCount = await page.evaluate(() => window.Reveal.getSlides().length);
    await page.keyboard.press('r');

    const findings = [];

    for (let index = 0; index < slideCount; index++) {
      await clearSaid();
      await page.evaluate((n) => {
        const slide = window.Reveal.getSlides()[n];
        const { h, v } = window.Reveal.getIndices(slide);
        window.Reveal.slide(h, v);
      }, index);
      await speakToTheEnd();

      findings.push(
        await page.evaluate((n) => {
          const slide = window.Reveal.getSlides()[n];

          /** The note exactly as the author wrote it in the HTML. */
          const raw = slide.hasAttribute('data-notes')
            ? slide.getAttribute('data-notes')
            : [...slide.querySelectorAll('aside.notes')]
                .filter((aside) => aside.closest('section') === slide)
                .map((aside) => aside.textContent)
                .join('\n');

          /** Every bracketed span, read out of the markup rather than from the plugin. */
          const silentSpans = [];
          let depth = 0;
          let current = '';
          for (let i = 0; i < raw.length; i++) {
            const char = raw[i];
            if (char === '\\' && (raw[i + 1] === '[' || raw[i + 1] === ']')) {
              if (depth > 0) current += raw[i + 1];
              i++;
              continue;
            }
            if (char === '[') {
              depth++;
              continue;
            }
            if (char === ']') {
              if (depth > 0 && --depth === 0) {
                silentSpans.push(current);
                current = '';
              }
              continue;
            }
            if (depth > 0) current += char;
          }
          if (depth > 0) silentSpans.push(current); // an unclosed bracket runs to the end

          return {
            title: slide.querySelector('h2')?.textContent?.trim() ?? '(title slide)',
            said: window.__said.slice(),
            expected: window.RevealAloud.preview(slide).chunks,
            silentSpans
          };
        }, index)
      );
    }

    expect(findings).toHaveLength(slideCount);

    for (const { title, said, expected, silentSpans } of findings) {
      // 1. The engine got exactly the utterances the plugin intends, in order.
      expect(said, `utterances handed to the engine on "${title}"`).toEqual(expected);

      // 2. No phrase from any stage direction survived into any of them.
      const spoken = normalizeForComparison(said.join(' '));
      for (const span of silentSpans) {
        for (const phrase of phrasesOf(span)) {
          expect(
            spoken.includes(phrase),
            `"${phrase}" is inside brackets on "${title}" but reached the speech engine`
          ).toBe(false);
        }
      }
    }

    // The sweep is worthless if the deck stopped speaking altogether, so prove it spoke.
    const totalUtterances = findings.reduce((sum, f) => sum + f.said.length, 0);
    expect(totalUtterances).toBeGreaterThan(20);
    expect(findings.filter((f) => f.silentSpans.length > 0).length).toBeGreaterThan(5);
  }, 90_000);

  it('hands the engine nothing at all on a slide that is pure stage direction', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    await goToSlide(3); // the note on this slide is one bracketed span and nothing else
    await speakToTheEnd();

    expect(await said()).toEqual([]);
  });

  it('does hand over a bracket the author escaped', async () => {
    await page.keyboard.press('r');
    await clearSaid();

    await goToSlide(8);
    await speakToTheEnd();

    expect((await said()).join(' ')).toContain('[optional]');
  });
});

describe('the demo deck explains itself on screen', () => {
  it('shows every slide what it will say and what it will skip', async () => {
    const panels = await page.evaluate(() =>
      window.Reveal.getSlides().map((slide) => ({
        hasPanel: Boolean(slide.querySelector('.aloud-panel')),
        heard: [...slide.querySelectorAll('.aloud-chunk')].map((c) => c.textContent),
        silent: [...slide.querySelectorAll('.aloud-silent')].map((c) => c.textContent)
      }))
    );

    expect(panels.every((panel) => panel.hasPanel)).toBe(true);
  });

  it('shows on the slide exactly what the narrator will say', async () => {
    await goToSlide(2);
    await page.keyboard.press('r');
    await speakToTheEnd();

    const onScreen = await page.evaluate(() =>
      [...window.Reveal.getCurrentSlide().querySelectorAll('.aloud-chunk')].map(
        (c) => c.textContent
      )
    );

    expect(await said()).toEqual(onScreen);
  });

  it('marks the bracketed parts as silent on screen', async () => {
    await goToSlide(2);

    const silent = await page.evaluate(() =>
      [...window.Reveal.getCurrentSlide().querySelectorAll('.aloud-silent')].map(
        (c) => c.textContent
      )
    );

    expect(silent).toEqual(['[click to reveal the chart]', '[pause for effect]']);
  });

  it('warns on the slide where a bracket was left unclosed', async () => {
    await goToSlide(9);

    const warning = await page.evaluate(
      () => window.Reveal.getCurrentSlide().querySelector('.aloud-panel__warning')?.textContent
    );

    expect(warning).toMatch(/unclosed/i);
  });
});
