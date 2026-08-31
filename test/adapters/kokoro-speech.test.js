/**
 * The Kokoro adapter, against a fake KokoroTTS model and a fake `<audio>` element.
 *
 * Kokoro is a fundamentally different shape of engine from Web Speech: instead of handing text
 * to the OS and getting a callback, this generates an audio clip per sentence and plays it.
 * What is tested here is that the seams that difference introduces — the model loading lazily,
 * generation for the next sentence overlapping playback of the current one, and a stop() during
 * either generation or playback landing cleanly — behave the same way web-speech's do: at most
 * one thing ever plays, and nothing left over from a cancelled slide can still speak.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKokoroSpeech, isKokoroSupported } from '../../src/adapters/kokoro-speech.js';

/** A fake KokoroTTS: generation resolves on demand, so a test can control ordering exactly. */
function fakeModel() {
  const pending = [];
  return {
    generateCalls: [],
    list_voices: () => ['af_heart', 'am_adam'],
    generate(text, options) {
      this.generateCalls.push({ text, voice: options?.voice });
      let resolveIt;
      const promise = new Promise((resolve) => {
        resolveIt = () => resolve({ toBlob: () => ({ text, voice: options?.voice }) });
      });
      pending.push(resolveIt);
      return promise;
    },
    /** Resolves the oldest still-pending generate() call. */
    resolveNext() {
      pending.shift()?.();
    }
  };
}

/** A fake `<audio>` element good enough to drive play/pause/ended/error by hand. */
function fakeAudioElement() {
  const el = {
    played: [],
    paused: true,
    play: vi.fn(() => {
      el.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    set src(value) {
      el.played.push(value.text ?? value);
    }
  };
  return el;
}

function fakeImporter(model) {
  const KokoroTTS = { from_pretrained: vi.fn(async () => model) };
  return async () => ({ KokoroTTS });
}

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: (b) => b, revokeObjectURL: () => {} });
});

describe('generating and playing a slide', () => {
  it('plays chunks in order, one at a time', async () => {
    const model = fakeModel();
    const elements = [];
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: () => {
        const el = fakeAudioElement();
        elements.push(el);
        return el;
      }
    });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    const done = speech.speak({ chunks: ['One.', 'Two.'], epoch: 1, settings: {} }, handlers);
    await flush();

    // Generation for "Two." has not started yet — it only begins once "One." is ready to play.
    expect(model.generateCalls.map((c) => c.text)).toEqual(['One.']);
    expect(elements).toHaveLength(0);

    model.resolveNext(); // "One." finishes generating
    await flush();
    expect(elements).toHaveLength(1);
    expect(elements[0].played).toEqual(['One.']);
    // Starting "One." also kicked off generation for "Two." in the background.
    expect(model.generateCalls.map((c) => c.text)).toEqual(['One.', 'Two.']);

    model.resolveNext(); // "Two." finishes generating while "One." is still playing
    elements[0].onended();
    await flush();
    expect(elements).toHaveLength(2);
    expect(elements[1].played).toEqual(['Two.']);

    elements[1].onended();
    await done;
    expect(handlers.onFinished).toHaveBeenCalledWith(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it('starts generating the next sentence as soon as the current one begins, not after', async () => {
    const model = fakeModel();
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: fakeAudioElement
    });

    speech.speak(
      { chunks: ['One.', 'Two.', 'Three.'], epoch: 1, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();
    expect(model.generateCalls).toHaveLength(1); // only "One." — nothing plays yet to overlap

    model.resolveNext(); // "One." ready; it starts playing
    await flush();
    // "Two." is now being generated in the background, well before "One." has finished playing.
    expect(model.generateCalls.map((c) => c.text)).toEqual(['One.', 'Two.']);
  });

  it('passes the resolved voice id to the model', async () => {
    const model = fakeModel();
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: fakeAudioElement
    });

    speech.speak(
      { chunks: ['Hi.'], epoch: 1, settings: { voice: 'adam' } },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();

    expect(model.generateCalls[0].voice).toBe('am_adam'); // partial match, like web-speech
  });

  it('loads the model only once across multiple speak() calls', async () => {
    const model = fakeModel();
    const importer = fakeImporter(model);
    const speech = createKokoroSpeech({ importModule: importer, audioFactory: fakeAudioElement });

    speech.speak({ chunks: ['A.'], epoch: 1, settings: {} }, { onFinished() {}, onFailed() {} });
    await flush();
    model.resolveNext();
    await flush();

    speech.speak({ chunks: ['B.'], epoch: 2, settings: {} }, { onFinished() {}, onFailed() {} });
    await flush();

    const { KokoroTTS } = await importer();
    expect(KokoroTTS.from_pretrained).toHaveBeenCalledTimes(1);
  });
});

describe('being interrupted', () => {
  it('does not play a chunk that finished generating after stop() was called', async () => {
    const model = fakeModel();
    const elements = [];
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: () => {
        const el = fakeAudioElement();
        elements.push(el);
        return el;
      }
    });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['One.', 'Two.'], epoch: 1, settings: {} }, handlers);
    await flush();

    speech.stop();
    model.resolveNext(); // "One." arrives after the stop
    await flush();

    expect(elements).toHaveLength(0);
    expect(handlers.onFinished).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
  });

  it('pauses whatever is currently playing', async () => {
    const model = fakeModel();
    let element;
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: () => (element = fakeAudioElement())
    });

    speech.speak(
      { chunks: ['One.', 'Two.'], epoch: 1, settings: {} },
      { onFinished: vi.fn(), onFailed: vi.fn() }
    );
    await flush();
    model.resolveNext();
    await flush();

    speech.stop();

    expect(element.pause).toHaveBeenCalledOnce();
  });

  it('ignores a stale generation from a slide the presenter already left', async () => {
    const model = fakeModel();
    const elements = [];
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: () => {
        const el = fakeAudioElement();
        elements.push(el);
        return el;
      }
    });

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

    model.resolveNext(); // "Old." — arrives late
    model.resolveNext(); // "New."
    await flush();

    expect(elements.map((e) => e.played[0])).toEqual(['New.']);
  });
});

describe('when something genuinely fails', () => {
  it('reports a model load failure rather than hanging silently', async () => {
    const speech = createKokoroSpeech({
      importModule: async () => {
        throw new Error('network down');
      },
      audioFactory: fakeAudioElement
    });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    await speech.speak({ chunks: ['Hi.'], epoch: 1, settings: {} }, handlers);

    expect(handlers.onFailed).toHaveBeenCalledWith(1, 'network down');
  });

  it('reports a playback failure', async () => {
    const model = fakeModel();
    let element;
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: () => (element = fakeAudioElement())
    });
    const handlers = { onFinished: vi.fn(), onFailed: vi.fn() };

    speech.speak({ chunks: ['Hi.'], epoch: 1, settings: {} }, handlers);
    await flush();
    model.resolveNext();
    await flush();

    element.onerror();
    await flush();

    expect(handlers.onFailed).toHaveBeenCalledWith(1, 'kokoro-audio-playback-failed');
  });
});

describe('discovering voices before the model has loaded', () => {
  it('lists a known set of voices without triggering a download', () => {
    const importModule = vi.fn();
    const speech = createKokoroSpeech({ importModule });

    const voices = speech.listVoices();

    expect(voices.length).toBeGreaterThan(0);
    expect(voices.map((v) => v.name)).toContain('af_bella');
    expect(importModule).not.toHaveBeenCalled();
  });

  it('switches to the model’s own list once it has loaded', async () => {
    const model = fakeModel();
    const speech = createKokoroSpeech({
      importModule: fakeImporter(model),
      audioFactory: fakeAudioElement
    });

    speech.speak({ chunks: ['Hi.'], epoch: 1, settings: {} }, { onFinished() {}, onFailed() {} });
    await flush();
    model.resolveNext();
    await flush();

    expect(speech.listVoices().map((v) => v.name)).toEqual(['af_heart', 'am_adam']);
  });

  it('falls back to a usable voice, same as web-speech, when none is configured', () => {
    const speech = createKokoroSpeech({ importModule: vi.fn() });

    const { voice, warning } = speech.resolveVoice({});

    expect(voice).not.toBeNull();
    expect(warning).toBeNull();
  });
});

describe('support detection', () => {
  it('requires WebAssembly and an Audio constructor', () => {
    expect(isKokoroSupported({ WebAssembly: {}, Audio: function () {} })).toBe(true);
    expect(isKokoroSupported({})).toBe(false);
    expect(isKokoroSupported({ WebAssembly: {} })).toBe(false);
  });
});

/** Lets pending microtasks (the promise chains inside speak()) settle before asserting. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
