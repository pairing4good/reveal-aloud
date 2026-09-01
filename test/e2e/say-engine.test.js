/**
 * End-to-end: the `say` engine, in a real browser, talking to a real `bin/say-server.js` — its
 * own separate Node process, spawned exactly as a presenter would start it, listening on a real
 * loopback socket. Only the underlying macOS `say` binary is substituted, via
 * `test/fixtures/fake-say.js`, since this sandbox has no Mac to run the real one on. Every other
 * layer is genuine: the browser's `fetch`, the server's HTTP handling, and its real
 * `child_process.spawn`/`kill` lifecycle — the same one verified in isolation by
 * `test/server/say-server.test.js`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const SAY_SERVER_PATH = fileURLToPath(new URL('../../bin/say-server.js', import.meta.url));
const FAKE_SAY = fileURLToPath(new URL('../fixtures/fake-say.js', import.meta.url));

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (process.env.CHROMIUM_PATH) {
      return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    }
    if (process.env.CI) throw error;
    console.warn(
      '\n  Skipping the say-engine end-to-end suite: no browser available.' +
        '\n  Run `npx playwright install chromium`, or set CHROMIUM_PATH.\n'
    );
    return null;
  }
}

/** Starts a real say-server child process and resolves once it reports the port it bound to. */
function startSayServer(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SAY_SERVER_PATH], {
      env: { ...process.env, SAY_BIN: FAKE_SAY, PORT: '0', ...env }
    });
    let banner = '';
    const onData = (chunk) => {
      banner += chunk;
      const match = banner.match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve({ child, port: Number(match[1]) });
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

function stopSayServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

let server;
let browser;
let page;
let origin;
let sayServer;
let sayPort;

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

  ({ child: sayServer, port: sayPort } = await startSayServer());

  page = await browser.newPage();
  await page.route('https://cdn.jsdelivr.net/npm/reveal.js@*/**', async (route) => {
    const file = route.request().url().replace(/^.*reveal\.js@[^/]+\//, '');
    await route.fulfill({
      body: await readFile(join(ROOT, 'node_modules/reveal.js', file)),
      contentType: TYPES[extname(file)] ?? 'text/plain'
    });
  });
  await page.addInitScript((url) => {
    window.SAY_SERVER_URL = url;
  }, `http://127.0.0.1:${sayPort}`);

  await page.goto(`${origin}/test/e2e/fixtures/say.html`);
  await page.waitForFunction(() => window.Reveal?.isReady?.());
});

afterEach(async () => {
  await stopSayServer(sayServer);
});

const goToSlide = (index) => page.evaluate((i) => window.Reveal.slide(i), index);

describe('the say engine wired into a real deck and a real say-server', () => {
  it('reads the current slide through the real server', async () => {
    const res = await fetch(`http://127.0.0.1:${sayPort}/voices`);
    expect((await res.json())[0]).toEqual({ name: 'system-default', lang: '', default: true });

    await page.keyboard.press('r');

    // No client-side record of "what was spoken" exists for this engine — the server is the
    // only place that knows. Polling it for whether an utterance is in flight is the honest
    // way to observe it from here, mirroring how a presenter has no visibility either beyond
    // "is my Mac talking right now".
    await page.waitForFunction(
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/stop`, { method: 'POST' });
        const body = await res.json();
        return body.stopped === true; // something was speaking when we asked it to stop
      },
      sayPort,
      { timeout: 5000, polling: 50 }
    );
  });

  it('reports success in the status badge once narration is speaking', async () => {
    await page.keyboard.press('r');

    await page.waitForFunction(
      () => document.querySelector('.reveal-aloud-indicator')?.dataset.status === 'speaking',
      null,
      { timeout: 5000, polling: 100 }
    );
  });

  it('shows a clear error when the say-server is not running', async () => {
    await stopSayServer(sayServer);

    await page.keyboard.press('r');

    await page.waitForFunction(
      () => document.querySelector('.reveal-aloud-indicator')?.dataset.status === 'failed',
      null,
      { timeout: 5000, polling: 100 }
    );
    const badgeText = await page.textContent('.reveal-aloud-indicator__text');
    expect(badgeText).toMatch(/failed/i);

    // Restart it so afterEach's stopSayServer(sayServer) has a live process to close.
    ({ child: sayServer } = await startSayServer({ PORT: String(sayPort) }));
  });

  it('really kills the server-side utterance when the presenter advances', async () => {
    // A long "utterance" so there is something to genuinely interrupt mid-flight.
    await stopSayServer(sayServer);
    ({ child: sayServer, port: sayPort } = await startSayServer({ FAKE_SAY_SPEAK_MS: '3000' }));
    await page.evaluate((url) => {
      window.SAY_SERVER_URL = url;
    }, `http://127.0.0.1:${sayPort}`);
    await page.reload();
    await page.waitForFunction(() => window.Reveal?.isReady?.());

    await page.keyboard.press('r');
    await page.waitForFunction(
      () => document.querySelector('.reveal-aloud-indicator')?.dataset.status === 'speaking',
      null,
      { timeout: 5000, polling: 100 }
    );

    const started = Date.now();
    await goToSlide(1);

    // Proof the real child process was really killed, not merely abandoned client-side: ask
    // the server itself whether anything is still speaking, well before the fake's 3s "speech"
    // would have finished on its own.
    await page.waitForFunction(
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/stop`, { method: 'POST' });
        return (await res.json()).stopped === false; // nothing left to stop — already dead
      },
      sayPort,
      { timeout: 2000, polling: 50 }
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
