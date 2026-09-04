/**
 * NarrationSourcePort that reads a deck the way a presenter's browser would.
 *
 * Parsing the HTML with a lightweight DOM instead would be cheaper, and wrong. `slideToBlocks()`
 * resolves notes by walking the live DOM — `closest('section') === slide`, skipping `.fragment`
 * — so a deck built from markdown, assembled by a script, or fetching its slides produces
 * *zero notes* under a static parser. Not an error: an empty export. Running the deck's own
 * `RevealAloud.preview()` in a real browser is the only way to be certain the exported audio
 * matches what the deck actually says.
 *
 * Playwright is imported lazily and stays a devDependency, so installing reveal-aloud does not
 * drag in a browser.
 */

import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { createStaticServer } from './static-server.js';

const PLAYWRIGHT_HINT =
  'Exporting reads your deck in a real browser, which needs Playwright:\n' +
  '  npm i -D playwright && npx playwright install chromium';

/**
 * @param {object} [options]
 * @param {number} [options.timeoutMs] how long to wait for reveal.js to signal ready
 * @param {string} [options.bundlePath] dist/reveal-aloud.js, injected when the deck loaded the
 *   plugin as a module and so never set `window.RevealAloud`
 * @param {() => Promise<any>} [options.importPlaywright] injectable for tests
 * @param {(message: string) => void} [options.log]
 * @returns {import('../ports.js').NarrationSourcePort}
 */
export function createPlaywrightSource(options = {}) {
  const {
    timeoutMs = 15000,
    bundlePath,
    importPlaywright = () => import('playwright'),
    log = () => {}
  } = options;

  let browser = null;
  let server = null;

  async function readDeck(target) {
    let playwright;
    try {
      playwright = await importPlaywright();
    } catch (error) {
      throw new Error(`${PLAYWRIGHT_HINT}\n\n(${error.message})`);
    }

    const url = await toUrl(target);

    // A deck that does not exist, or is not a reveal deck, throws below. Everything opened here
    // must be released on that path too: a listening server keeps Node's event loop alive, so
    // leaking one turns a clean error into a CLI that hangs forever.
    try {
      browser = await playwright.chromium.launch();
    } catch (error) {
      await close();
      throw error;
    }

    try {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });

      try {
        await page.waitForFunction(() => window.Reveal?.isReady?.() === true, null, {
          timeout: timeoutMs
        });
      } catch {
        throw new Error(await diagnoseNotReady(page, url, consoleErrors));
      }

      // A deck that imported the ESM build never set the global, so give it one to call.
      const hasGlobal = await page.evaluate(() => typeof window.RevealAloud === 'function');
      if (!hasGlobal) {
        if (!bundlePath) {
          throw new Error(
            `${url} does not expose RevealAloud.\n` +
              'Include dist/reveal-aloud.js in the deck, or run `npm run build` first.'
          );
        }
        log('  deck has no RevealAloud global; injecting dist/reveal-aloud.js');
        await page.addScriptTag({ path: bundlePath });
      }

      const result = await page.evaluate(extractSlides);

      if (result.error) throw new Error(result.error);
      return result;
    } finally {
      // Nothing here is needed once the slides are read, and releasing it now means the caller
      // cannot forget to — including when this throws.
      await close();
    }
  }

  /**
   * A path becomes a served URL rather than a `file://` one: external markdown and module
   * scripts fail CORS under `file://`, which would silently yield a deck with no notes.
   *
   * The root is the deck's project, not its own directory, because decks routinely reach
   * upwards — the bundled demo loads `../dist/reveal-aloud.js`. Serving only the deck's folder
   * would 404 that and leave the page with no plugin at all.
   */
  async function toUrl(target) {
    if (/^https?:\/\//i.test(target)) return target;

    const absolute = isAbsolute(target) ? target : resolve(process.cwd(), target);
    // Checked before a browser is launched: otherwise a typo surfaces 15 seconds later as
    // "reveal.js never became ready", which sends people looking in the wrong place entirely.
    if (!(await exists(absolute))) {
      throw new Error(`No such deck: ${target}\nGive the path to your deck's .html file, or a URL.`);
    }

    const root = await projectRoot(absolute);
    const path = absolute.slice(root.length).replace(/\\/g, '/');

    server = await createStaticServer({ root, index: path });
    log(`  serving ${root} at ${server.origin}`);
    return `${server.origin}${path}`;
  }

  async function close() {
    if (browser) await browser.close();
    if (server) await server.close();
    browser = null;
    server = null;
  }

  return { readDeck, close };
}

/**
 * Explains *why* reveal.js never reported ready.
 *
 * Worth the extra round trip: "use --timeout to wait longer" is actively misleading when the
 * page is not a deck at all, and sends people tuning a flag that can never help. The three
 * cases below fail for completely different reasons and deserve different advice.
 */
async function diagnoseNotReady(page, url, consoleErrors) {
  const seen = await page.evaluate(() => ({
    hasReveal: typeof window.Reveal !== 'undefined',
    hasContainer: Boolean(document.querySelector('.reveal')),
    sections: document.querySelectorAll('section').length,
    title: document.title
  }));

  const reported = consoleErrors.length ? `\n\nThe page reported: ${consoleErrors[0]}` : '';

  // Not a deck at all. Say so plainly rather than blaming the clock.
  if (!seen.hasReveal && !seen.hasContainer && seen.sections === 0) {
    return (
      `${url} does not look like a reveal.js presentation` +
      (seen.title ? ` ("${seen.title}")` : '') +
      '.\nIt has no reveal.js, no .reveal container and no <section> slides, so there are no\n' +
      'speaker notes to export. Check you pointed at the deck itself — a repo often has a\n' +
      'similarly named write-up next to the real deck.' +
      reported
    );
  }

  // Looks like a deck, but the library never loaded — usually a missing or blocked script.
  if (!seen.hasReveal) {
    return (
      `${url} looks like a deck (${seen.sections} <section> elements) but reveal.js never\n` +
      'loaded, so window.Reveal is undefined. Check the deck\'s <script> tags resolve — a\n' +
      'vendored copy under a path that does not exist, or a CDN blocked offline, does this.' +
      reported
    );
  }

  // reveal.js is present but initialize() never completed or was never called.
  return (
    `reveal.js loaded at ${url} but never finished initialising, so no slides could be read.\n` +
    'Check that Reveal.initialize() is actually called. If the deck is simply slow, raise\n' +
    '--timeout.' +
    reported
  );
}

/**
 * The nearest ancestor that looks like a project — where a deck's `../dist/...` or `../assets/...`
 * references will resolve. Falls back to the deck's own directory rather than ever serving `/`.
 */
async function projectRoot(deckPath) {
  let dir = dirname(deckPath);
  const stopAt = dirname(dir); // never climb past the deck's grandparent unmarked

  for (let candidate = dir; candidate !== dirname(candidate); candidate = dirname(candidate)) {
    for (const marker of ['package.json', '.git']) {
      if (await exists(join(candidate, marker))) return candidate;
    }
    if (candidate === stopAt) break;
  }
  return dir;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs inside the page. Kept as a standalone function so it serializes cleanly — it cannot
 * close over anything from this module.
 *
 * `Reveal.getSlides()` returns every leaf slide regardless of where the deck currently is, so
 * there is no need to navigate: no transitions to wait out and no risk of missing a slide.
 */
function extractSlides() {
  try {
    // The deck's own aloud config must be passed explicitly: RevealAloud.preview() merges only
    // DEFAULTS with what it is given, so a deck setting speakCode or maxChars would otherwise
    // export different chunks than it speaks.
    const config = window.Reveal.getConfig().aloud ?? {};

    const slides = window.Reveal.getSlides().map((slide, index) => {
      const indices = window.Reveal.getIndices(slide);
      const { chunks, unclosedBracket } = window.RevealAloud.preview(slide, config);

      const hasNotes =
        slide.hasAttribute('data-notes') ||
        Array.from(slide.querySelectorAll('aside.notes')).some(
          (aside) => aside.closest('section') === slide
        );

      const heading = slide.querySelector('h1, h2, h3, h4');

      return {
        index,
        h: indices.h ?? 0,
        v: indices.v ?? 0,
        id: slide.id || null,
        title: heading ? heading.textContent.trim().replace(/\s+/g, ' ') : null,
        hasNotes,
        chunks,
        unclosedBracket: Boolean(unclosedBracket)
      };
    });

    return { config, slides };
  } catch (error) {
    return { error: `Reading the deck failed: ${error.message}`, config: {}, slides: [] };
  }
}
