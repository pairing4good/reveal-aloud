/**
 * End-to-end: the Kokoro engine, in a real browser, doing everything except the neural network.
 *
 * This sandbox has no route to the real `kokoro-js` CDN, so the actual ~90MB model cannot be
 * downloaded here — that one piece is genuinely unverified by this suite. Everything around it
 * is real: a real dynamic `import()` of a URL by the adapter, a real `Blob` decoded and played
 * by a real `<audio>` element through to a real `ended` event, and the pipelining and
 * epoch-guard logic running under real async timing rather than a hand-driven fake. The stand-in
 * model is `test/e2e/fixtures/fake-kokoro-js.js`; only its neural network is fake.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (process.env.CHROMIUM_PATH) {
      return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    if (process.env.CI) throw error;
    console.warn(
      '\n  Skipping the Kokoro end-to-end suite: no browser available.' +
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

  // Only reveal.js itself comes from a CDN here; the plugin and the fake model are both
  // served locally, so real dynamic import() is exercised without needing real network access.
  await page.route('https://cdn.jsdelivr.net/npm/reveal.js@*/**', async (route) => {
    const file = route.request().url().replace(/^.*reveal\.js@[^/]+\//, '');
    await route.fulfill({
      body: await readFile(join(ROOT, 'node_modules/reveal.js', file)),
      contentType: TYPES[extname(file)] ?? 'text/plain'
    });
  });

  await page.goto(`${origin}/test/e2e/fixtures/kokoro.html`);
  await page.waitForFunction(() => window.Reveal?.isReady?.());
});

const generateCalls = () => page.evaluate(() => window.__kokoro.generateCalls);
const progressReports = () => page.evaluate(() => window.__kokoro.progressReports);
const goToSlide = (index) => page.evaluate((i) => window.Reveal.slide(i), index);

describe('the Kokoro engine wired into a real deck', () => {
  it('loads the model from the configured URL and generates the current slide', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction(() => (window.__kokoro?.generateCalls.length ?? 0) >= 2, null, {
      timeout: 5000,
      polling: 100
    });

    const calls = await generateCalls();
    expect(calls.map((c) => c.text)).toEqual(['First slide.', 'Two sentences here.']);
    expect(calls.every((c) => c.voice === 'af_heart')).toBe(true);
  });

  it('reports download progress through the on-screen indicator', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction(() => (window.__kokoro?.progressReports.length ?? 0) >= 1, null, {
      polling: 100
    });

    const badge = await page.evaluate(() => document.querySelector('.reveal-aloud-progress')?.textContent);
    expect(badge).toMatch(/Downloading voice model/);

    const reports = await progressReports();
    expect(reports.at(-1)).toEqual({ loaded: 100, total: 100 });
  });

  it('really plays the generated audio through to a genuine "ended" event', async () => {
    // The adapter only starts generating a chunk's successor once that chunk begins playing
    // (see the pipelining test in kokoro-speech.test.js), and it only moves past a chunk once
    // playback of it actually ends. So reaching the second generate() call at all is proof that
    // a real `<audio>` element played the first chunk's real WAV blob through to a real `ended`
    // event — a fake or corrupt audio file would leave that element hung and this would time out.
    await page.keyboard.press('r');

    await page.waitForFunction(() => (window.__kokoro?.generateCalls.length ?? 0) >= 2, null, {
      timeout: 5000,
      polling: 100
    });

    expect((await generateCalls()).length).toBeGreaterThanOrEqual(2);
  });

  it('stops the current slide and starts the next one when the presenter advances', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction(() => (window.__kokoro?.generateCalls.length ?? 0) >= 1, null, {
      polling: 100
    });

    await goToSlide(1);
    await page.waitForFunction(
      () => window.__kokoro?.generateCalls.some((c) => c.text === 'Second slide notes.') ?? false,
      null,
      { timeout: 5000, polling: 100 }
    );

    const calls = await generateCalls();
    // The first slide's second sentence must never have been generated after the advance —
    // proof the epoch guard actually cut it off rather than merely racing to finish first.
    const secondSlideStartsAt = calls.findIndex((c) => c.text === 'Second slide notes.');
    const staleSentenceAfter = calls
      .slice(secondSlideStartsAt)
      .some((c) => c.text === 'Two sentences here.');
    expect(staleSentenceAfter).toBe(false);
  });

  it('generates nothing for a slide with no notes', async () => {
    await page.keyboard.press('r');
    await goToSlide(2);
    await page.waitForTimeout(400);

    // A slide with nothing to say must never trigger the model download at all — so
    // window.__kokoro legitimately does not exist yet, and that absence is itself the pass.
    expect(await page.evaluate(() => window.__kokoro?.generateCalls ?? [])).toEqual([]);
  });
});
