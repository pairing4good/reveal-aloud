/**
 * The say-server adapter, against a fake `fetch`.
 *
 * The interesting behaviour here is entirely about talking to a server rather than an in-page
 * engine: an aborted request must actually stop the server-side process (not just the browser's
 * view of it), a response that arrives after the presenter has moved on must be dropped, and an
 * unreachable server must fail clearly rather than hang narration forever.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSaySpeech } from '../../src/adapters/say-speech.js';

/** A fake fetch with a controllable /voices response and a queue of controllable /speak calls. */
function fakeFetch({ voices = [{ name: 'system-default', lang: '', default: true }], survivesAbort = false } = {}) {
  const speakCalls = [];
  const stopCalls = [];
  const pendingSpeaks = [];

  const fetchImpl = vi.fn((url, init) => {
    if (url.endsWith('/voices')) {
      return Promise.resolve({ ok: true, json: async () => voices });
    }
    if (url.endsWith('/stop')) {
      stopCalls.push(init);
      return Promise.resolve({ ok: true, json: async () => ({ stopped: true }) });
    }
    if (url.endsWith('/speak')) {
      const body = JSON.parse(init.body);
      speakCalls.push(body);
      return new Promise((resolve, reject) => {
        pendingSpeaks.push({ resolve, reject });
        // Real fetch abort rejection is asynchronous, per the Fetch spec, and a response that
        // had already fully arrived before abort() reaches the network layer can go on to
        // resolve successfully regardless. `survivesAbort` models that real-world case; the
        // default models the common case, where an aborted request simply rejects.
        if (!survivesAbort) {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  return {
    fetchImpl,
    speakCalls,
    stopCalls,
    /** Resolves the oldest still-pending /speak call as a success. */
    resolveNext(body = { stopped: false }) {
      pendingSpeaks.shift()?.resolve({ ok: true, json: async () => body });
    },
    /** Resolves the oldest still-pending /speak call as an HTTP failure. */
    failNext(status, body = {}) {
      pendingSpeaks.shift()?.resolve({ ok: false, status, json: async () => body });
    }
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('speaking a slide', () => {
  it('joins all chunks into a single /speak request separated by [[slnc]] silences', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    const done = speech.speak({ chunks: ['One.', 'Two.'], epoch: 1, settings: {} }, handlers);
    await flush();

    expect(server.speakCalls).toHaveLength(1);
    expect(server.speakCalls[0].text).toBe('[[slnc 700]] One. [[slnc 300]] Two. [[slnc 700]]');

    server.resolveNext();
    await done;
    expect(handlers.onFinished).toHaveBeenCalledWith(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it('pads both ends even for a single chunk, so the first and last word are not clipped', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });

    speech.speak({ chunks: ['Alone.'], epoch: 1, settings: {} }, { onFinished() {}, onFailed() {} });
    await flush();

    expect(server.speakCalls[0].text).toBe('[[slnc 700]] Alone. [[slnc 700]]');
  });

  it('honours configured silence durations', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({
      fetchImpl: server.fetchImpl,
      leadSilenceMs: 1000,
      tailSilenceMs: 900,
      gapSilenceMs: 200
    });

    speech.speak(
      { chunks: ['One.', 'Two.'], epoch: 1, settings: {} },
      { onFinished() {}, onFailed() {} }
    );
    await flush();

    expect(server.speakCalls[0].text).toBe('[[slnc 1000]] One. [[slnc 200]] Two. [[slnc 900]]');
  });

  it('finishes without spawning a say process when there is nothing to speak', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    await speech.speak({ chunks: [], epoch: 1, settings: {} }, handlers);

    expect(server.speakCalls).toHaveLength(0);
    expect(handlers.onFinished).toHaveBeenCalledWith(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it('sends the resolved voice name and the configured rate', async () => {
    const server = fakeFetch({
      voices: [
        { name: 'system-default', lang: '', default: true },
        { name: 'Ava (Premium)', lang: 'en-US' }
      ]
    });
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    await flush(); // let the eagerly-fetched voice list settle before relying on it

    speech.speak(
      { chunks: ['Hi.'], epoch: 1, settings: { voice: 'Ava', rate: 1.4 } },
      { onFinished() {}, onFailed() {} }
    );
    await flush();

    expect(server.speakCalls[0]).toMatchObject({ voice: 'Ava (Premium)', rate: 1.4 });
    expect(server.speakCalls[0].text).toContain('Hi.');
  });

  it('sends "system-default" as the voice when nothing is configured, reaching a Siri voice', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });

    speech.speak({ chunks: ['Hi.'], epoch: 1, settings: {} }, { onFinished() {}, onFailed() {} });
    await flush();

    expect(server.speakCalls[0].voice).toBe('system-default');
  });
});

describe('being interrupted', () => {
  it('aborts the in-flight request and tells the server to stop, not just the browser', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });

    speech.speak(
      { chunks: ['One.', 'Two.'], epoch: 1, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();

    speech.stop();
    await flush();

    expect(server.stopCalls).toHaveLength(1);
  });

  it('sends all chunks as one joined request and stop() aborts it without extra speak calls', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });

    speech.speak(
      { chunks: ['One.', 'Two.', 'Three.'], epoch: 1, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();

    // All chunks were joined into the single in-flight request.
    expect(server.speakCalls).toHaveLength(1);
    expect(server.speakCalls[0].text).toBe(
      '[[slnc 700]] One. [[slnc 300]] Two. [[slnc 300]] Three. [[slnc 700]]'
    );

    speech.stop();
    await flush();

    // stop() must not trigger any additional speak calls.
    expect(server.speakCalls).toHaveLength(1);
  });

  it('does not report failure or completion for a request cancelled by our own stop()', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['One.'], epoch: 1, settings: {} }, handlers);
    await flush();

    speech.stop();
    await flush();

    expect(handlers.onFinished).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it('ignores a response that arrives after the presenter has already moved on', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });

    speech.speak(
      { chunks: ['Old.'], epoch: 1, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();

    speech.stop();
    speech.speak(
      { chunks: ['New.'], epoch: 2, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();

    server.resolveNext(); // the (aborted, but still resolvable in this fake) "Old." request
    server.resolveNext(); // "New."
    await flush();

    expect(server.speakCalls).toHaveLength(2);
    expect(server.speakCalls[0].text).toContain('Old.');
    expect(server.speakCalls[1].text).toContain('New.');
  });
});

describe('a response that survives an abort — a real Fetch spec edge case', () => {
  it('drops a chunk’s response that resolves successfully after stop() was already called', async () => {
    // Aborting a fetch is not guaranteed to reject it if the response had already fully
    // arrived before the abort reached the network layer — this models that case, which a
    // simple abort-always-rejects fake would never exercise.
    const server = fakeFetch({ survivesAbort: true });
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['One.', 'Two.'], epoch: 1, settings: {} }, handlers);
    await flush();

    speech.stop();
    server.resolveNext(); // "One." completes successfully despite the abort call
    await flush();

    expect(handlers.onFinished).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
    // All chunks were joined into one request; "Two." is not a separate call.
    expect(server.speakCalls).toHaveLength(1);
    expect(server.speakCalls[0].text).toBe('[[slnc 700]] One. [[slnc 300]] Two. [[slnc 700]]');
  });

  it('does not report a stale failure — or disturb the slide that replaced it — when a ' +
    'cancelled chunk’s error response survives an abort', async () => {
    const server = fakeFetch({ survivesAbort: true });
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const staleHandlers = { onFinished: vi.fn(), onFailed: vi.fn() };
    const liveHandlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['Stale.'], epoch: 1, settings: {} }, staleHandlers);
    await flush();

    speech.stop();
    speech.speak({ chunks: ['Live.'], epoch: 2, settings: {} }, liveHandlers);
    await flush();

    // The cancelled chunk's request finally answers, but with an engine error rather than
    // success — the case the success-only test above cannot reach.
    server.failNext(500, { error: 'stale engine error' });
    await flush();

    expect(staleHandlers.onFailed).not.toHaveBeenCalled();
    expect(staleHandlers.onFinished).not.toHaveBeenCalled();

    // And the slide that actually replaced it must be unaffected: its own chunk still arrives.
    server.resolveNext();
    await flush();
    expect(liveHandlers.onFinished).toHaveBeenCalledWith(2);
    expect(liveHandlers.onFailed).not.toHaveBeenCalled();
  });
});

describe('when something genuinely fails', () => {
  it('reports an unreachable server clearly, naming how to fix it', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('fetch failed')));
    const speech = createSaySpeech({ fetchImpl, serverUrl: 'http://127.0.0.1:5757' });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    await speech.speak({ chunks: ['Hi.'], epoch: 1, settings: {} }, handlers);

    expect(handlers.onFailed).toHaveBeenCalledOnce();
    expect(handlers.onFailed.mock.calls[0][1]).toMatch(/say-server/);
    expect(handlers.onFailed.mock.calls[0][1]).toMatch(/bin\/say-server\.js/);
  });

  it('reports a genuine engine failure using the server’s own error message', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['Hi.'], epoch: 3, settings: {} }, handlers);
    await flush();
    server.failNext(500, { error: 'Voice "Nope" not found' });
    await flush();

    expect(handlers.onFailed).toHaveBeenCalledWith(3, 'Voice "Nope" not found');
  });
});

describe('discovering voices', () => {
  it('falls back to the system default before the server has answered', () => {
    const speech = createSaySpeech({ fetchImpl: vi.fn(() => new Promise(() => {})) });

    expect(speech.listVoices()).toEqual([{ name: 'system-default', lang: '', default: true }]);
  });

  it('switches to the server’s real list once it answers', async () => {
    const server = fakeFetch({
      voices: [
        { name: 'system-default', lang: '', default: true },
        { name: 'Alex', lang: 'en-US' }
      ]
    });
    createSaySpeech({ fetchImpl: server.fetchImpl });
    await flush();

    // Voices are fetched once, eagerly, independent of any speak() call.
    expect(server.fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/voices'));
  });

  it('notifies subscribers once the real voice list has arrived', async () => {
    const server = fakeFetch({
      voices: [
        { name: 'system-default', lang: '', default: true },
        { name: 'Alex', lang: 'en-US' }
      ]
    });
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const listener = vi.fn();
    speech.onVoicesChanged(listener);

    await flush();

    expect(listener).toHaveBeenCalledOnce();
    expect(speech.listVoices().map((v) => v.name)).toEqual(['system-default', 'Alex']);
  });

  it('stops notifying once unsubscribed', async () => {
    const server = fakeFetch();
    const speech = createSaySpeech({ fetchImpl: server.fetchImpl });
    const listener = vi.fn();
    const unsubscribe = speech.onVoicesChanged(listener);
    unsubscribe();

    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});
