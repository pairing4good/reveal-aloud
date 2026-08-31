/**
 * The speech adapter, against a fake engine.
 *
 * Everything tested here is a workaround for how the browser's speech API actually behaves:
 * long utterances get truncated, cancelling raises an error that is not a failure, and
 * callbacks keep arriving after a cancel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSpeech, isSpeechSupported } from '../../src/adapters/web-speech.js';

/** A stand-in for `speechSynthesis` that lets a test decide when an utterance ends. */
function fakeEngine({ voices = [] } = {}) {
  const spoken = [];
  let current = null;

  return {
    spoken,
    paused: false,
    resumed: 0,
    cancels: 0,
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    resume() {
      this.resumed++;
      this.paused = false;
    },
    speak(utterance) {
      spoken.push(utterance);
      current = utterance;
    },
    cancel() {
      this.cancels++;
      const interrupted = current;
      current = null;
      // The real API reports an error on whatever was playing when you cancel it.
      interrupted?.onerror?.({ error: 'interrupted' });
    },
    /** Finishes the utterance the engine is currently on. */
    finishCurrent() {
      const utterance = current;
      current = null;
      utterance?.onend?.();
    },
    fail(error) {
      current?.onerror?.({ error });
    }
  };
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

const speechOver = (synth) => createWebSpeech({ synth, Utterance: FakeUtterance });

describe('speaking a slide', () => {
  let synth;
  let handlers;

  beforeEach(() => {
    synth = fakeEngine();
    handlers = { onFinished: vi.fn(), onFailed: vi.fn() };
  });

  it('speaks one short utterance at a time, so the engine cannot truncate a long note', () => {
    const speech = speechOver(synth);

    speech.speak({ chunks: ['One.', 'Two.', 'Three.'], epoch: 1, settings: {} }, handlers);

    // Only the first is queued; the next is created when the previous one ends.
    expect(synth.spoken.map((u) => u.text)).toEqual(['One.']);

    synth.finishCurrent();
    synth.finishCurrent();
    expect(synth.spoken.map((u) => u.text)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('reports completion once, after the last utterance', () => {
    const speech = speechOver(synth);
    speech.speak({ chunks: ['One.', 'Two.'], epoch: 7, settings: {} }, handlers);

    synth.finishCurrent();
    expect(handlers.onFinished).not.toHaveBeenCalled();

    synth.finishCurrent();
    expect(handlers.onFinished).toHaveBeenCalledOnce();
    expect(handlers.onFinished).toHaveBeenCalledWith(7);
  });

  it('applies the configured voice, speed, pitch and volume', () => {
    const voice = { name: 'Samantha', lang: 'en-US' };
    const engine = fakeEngine({ voices: [voice] });

    speechOver(engine).speak(
      {
        chunks: ['Hello.'],
        epoch: 1,
        settings: { voice: 'Samantha', lang: 'en-US', rate: 1.4, pitch: 0.9, volume: 0.8 }
      },
      handlers
    );

    expect(engine.spoken[0]).toMatchObject({
      voice,
      lang: 'en-US',
      rate: 1.4,
      pitch: 0.9,
      volume: 0.8
    });
  });

  it('wakes an engine that a previous cancel left paused', () => {
    synth.paused = true;
    const speech = speechOver(synth);

    speech.speak({ chunks: ['Hello.'], epoch: 1, settings: {} }, handlers);

    expect(synth.resumed).toBe(1);
    expect(synth.spoken).toHaveLength(1);
  });
});

describe('being interrupted', () => {
  let synth;
  let handlers;

  beforeEach(() => {
    synth = fakeEngine();
    handlers = { onFinished: vi.fn(), onFailed: vi.fn() };
  });

  it('does not report our own cancellation as a failure', () => {
    const speech = speechOver(synth);
    speech.speak({ chunks: ['One.', 'Two.'], epoch: 1, settings: {} }, handlers);

    speech.stop();

    expect(synth.cancels).toBe(1);
    expect(handlers.onFailed).not.toHaveBeenCalled();
    expect(handlers.onFinished).not.toHaveBeenCalled();
  });

  it('never speaks the rest of a queue that was cancelled', () => {
    const speech = speechOver(synth);
    speech.speak({ chunks: ['One.', 'Two.', 'Three.'], epoch: 1, settings: {} }, handlers);

    speech.stop();
    synth.finishCurrent(); // a late callback from the cancelled utterance

    expect(synth.spoken.map((u) => u.text)).toEqual(['One.']);
    expect(handlers.onFinished).not.toHaveBeenCalled();
  });

  it('ignores a late callback from the previous slide once the next one is speaking', () => {
    const speech = speechOver(synth);
    speech.speak({ chunks: ['Old.'], epoch: 1, settings: {} }, handlers);
    const staleUtterance = synth.spoken[0];

    speech.stop();
    speech.speak({ chunks: ['New.', 'Second.'], epoch: 2, settings: {} }, handlers);
    staleUtterance.onend(); // arrives from the engine after we had already moved on

    expect(synth.spoken.map((u) => u.text)).toEqual(['Old.', 'New.']);
    expect(handlers.onFinished).not.toHaveBeenCalled();
  });

  it('does report a genuine engine failure', () => {
    const speech = speechOver(synth);
    speech.speak({ chunks: ['One.'], epoch: 3, settings: {} }, handlers);

    synth.fail('synthesis-failed');

    expect(handlers.onFailed).toHaveBeenCalledOnce();
    expect(handlers.onFailed).toHaveBeenCalledWith(3, 'synthesis-failed');
  });
});

describe('discovering voices', () => {
  it('lists what the engine reports', () => {
    const voices = [{ name: 'Alex', lang: 'en-US' }];

    expect(speechOver(fakeEngine({ voices })).listVoices()).toEqual(voices);
  });

  it('subscribes to the late-arriving voice list Chrome sends', () => {
    const synth = fakeEngine();
    const listener = () => {};

    const unsubscribe = speechOver(synth).onVoicesChanged(listener);

    expect(synth.addEventListener).toHaveBeenCalledWith('voiceschanged', listener);
    unsubscribe();
    expect(synth.removeEventListener).toHaveBeenCalledWith('voiceschanged', listener);
  });

  it('reports when the configured voice is not installed', () => {
    const speech = speechOver(fakeEngine({ voices: [{ name: 'Alex', lang: 'en-US' }] }));

    expect(speech.resolveVoice({ voice: 'Nobody' }).warning).toBe('voice-not-found');
    expect(speech.resolveVoice({ voice: 'Alex' }).warning).toBeNull();
  });
});

describe('browsers with no speech engine', () => {
  it('are detected rather than crashed into', () => {
    expect(isSpeechSupported({})).toBe(false);
    expect(isSpeechSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} })).toBe(true);
  });
});
