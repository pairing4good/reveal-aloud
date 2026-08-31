/**
 * Integration test for `bin/say-server.js`: a real instance of it, spawned as a real child
 * process, hit with real `fetch()` calls exactly as the browser adapter does. Only the `say`
 * binary itself is substituted — `test/fixtures/fake-say.js` stands in for it, since this
 * sandbox has no macOS to run the real one on. Everything else here is genuine: the HTTP
 * server, CORS headers, JSON parsing, and — the part that matters most — that `/stop` really
 * kills the underlying process rather than just abandoning the HTTP response.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(new URL('../../bin/say-server.js', import.meta.url));
const FAKE_SAY = fileURLToPath(new URL('../fixtures/fake-say.js', import.meta.url));

let server;
let port;
let baseUrl;

/** Starts a fresh server on its own port, so tests never share process state. */
function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
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
    // PORT=0 asks the OS for a free port; the server always logs the one it actually bound to.
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

beforeEach(async () => {
  ({ child: server, port } = await startServer());
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await stopServer(server);
});

describe('discovering voices', () => {
  it('parses the voice list, with the current System Voice first and marked default', async () => {
    const res = await fetch(`${baseUrl}/voices`);
    const voices = await res.json();

    expect(res.status).toBe(200);
    expect(voices[0]).toEqual({ name: 'system-default', lang: '', default: true });
    expect(voices.slice(1)).toEqual([
      { name: 'Alex', lang: 'en-US' },
      { name: 'Ava (Premium)', lang: 'en-US' },
      { name: 'Daniel', lang: 'en-GB' },
      { name: 'Amelie', lang: 'fr-FR' }
    ]);
  });

  it('keeps a voice name that contains spaces intact', async () => {
    const voices = await (await fetch(`${baseUrl}/voices`)).json();

    expect(voices.map((v) => v.name)).toContain('Ava (Premium)');
  });
});

describe('speaking', () => {
  it('reports success once the utterance finishes', async () => {
    const res = await fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello.', voice: 'Alex', rate: 1 })
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: false });
  });

  it('rejects a request with no text', async () => {
    const res = await fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: 'Alex' })
    });

    expect(res.status).toBe(400);
  });

  it('reports a genuine failure of the underlying voice engine', async () => {
    await stopServer(server);
    ({ child: server, port } = await startServer({ FAKE_SAY_EXIT_CODE: '1' }));
    baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello.' })
    });

    expect(res.status).toBe(500);
  });
});

describe('stopping', () => {
  it('really kills the process, not just the HTTP response', async () => {
    await stopServer(server);
    ({ child: server, port } = await startServer({ FAKE_SAY_SPEAK_MS: '3000' }));
    baseUrl = `http://127.0.0.1:${port}`;

    const speaking = fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A very long thing to say.' })
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stopped = await (await fetch(`${baseUrl}/stop`, { method: 'POST' })).json();
    expect(stopped).toEqual({ stopped: true });

    // The original /speak call resolves quickly once killed, rather than waiting out the
    // full 3 seconds — proof the underlying `say` process was actually terminated.
    const started = Date.now();
    const result = await (await speaking).json();
    expect(Date.now() - started).toBeLessThan(2500);
    expect(result).toEqual({ stopped: true });
  });

  it('is harmless to call when nothing is speaking', async () => {
    const res = await fetch(`${baseUrl}/stop`, { method: 'POST' });

    expect(await res.json()).toEqual({ stopped: false });
  });

  it('never lets two utterances overlap: a new /speak cuts off the previous one', async () => {
    await stopServer(server);
    ({ child: server, port } = await startServer({ FAKE_SAY_SPEAK_MS: '3000' }));
    baseUrl = `http://127.0.0.1:${port}`;

    const first = fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'First.' })
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = fetch(`${baseUrl}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Second.' })
    });

    const firstResult = await (await first).json();
    expect(firstResult).toEqual({ stopped: true }); // cut off by the second request

    const secondResult = await (await second).json();
    expect(secondResult).toEqual({ stopped: false }); // ran to completion normally
  });
});

describe('cross-origin access', () => {
  it('allows any origin, since this is a personal, local-machine-only tool', async () => {
    const res = await fetch(`${baseUrl}/voices`, { headers: { origin: 'http://localhost:8000' } });

    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a CORS preflight request', async () => {
    const res = await fetch(`${baseUrl}/speak`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:8000',
        'access-control-request-method': 'POST'
      }
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('when the underlying binary does not exist at all', () => {
  it('fails with a clear message rather than hanging', async () => {
    await stopServer(server);
    ({ child: server, port } = await startServer({ SAY_BIN: '/nonexistent/not-say' }));
    baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/voices`);

    expect(res.status).toBe(500);
  });
});
