/**
 * The Kokoro file renderer, driven against a stub model.
 *
 * No download and no ONNX runtime: the point of injecting the imports is that the constraints
 * that actually break this adapter — the wrong device, a cache that a reinstall wipes, silently
 * truncated audio — can all be asserted in milliseconds.
 */

import { describe, expect, it, vi } from 'vitest';

import { createKokoroRenderer } from '../../src/adapters/kokoro-renderer.js';
import { readWavInfo } from '../../src/core/wav.js';

const SAMPLE_RATE = 24000;

/** A stand-in KokoroTTS: audio length is proportional to the text, so durations are checkable. */
function stubKokoro({ onGenerate } = {}) {
  const state = { fromPretrained: null, generateCalls: [] };
  const KokoroTTS = {
    from_pretrained: vi.fn(async (model, opts) => {
      state.fromPretrained = { model, ...opts };
      return {
        generate: vi.fn(async (text, options) => {
          state.generateCalls.push({ text, ...options });
          onGenerate?.(text, options);
          const frames = text.length * 100;
          const audio = new Float32Array(frames);
          for (let i = 0; i < frames; i++) audio[i] = Math.sin(i / 10) * 0.5;
          return { audio, sampling_rate: SAMPLE_RATE };
        })
      };
    })
  };
  return { state, module: { KokoroTTS } };
}

function makeRenderer(overrides = {}) {
  const written = new Map();
  const kokoro = overrides.kokoro ?? stubKokoro();
  const env = {};
  const renderer = createKokoroRenderer({
    write: async (path, data) => written.set(path, data),
    importKokoro: async () => kokoro.module,
    importTransformers: async () => ({ env }),
    nodeVersion: '22.0.0',
    ...overrides
  });
  return { renderer, written, state: kokoro.state, env };
}

const job = (overrides = {}) => ({
  chunks: ['Hello there.'],
  rate: 1,
  outPath: 'out/001.wav',
  ...overrides
});

describe('model loading', () => {
  it('asks for the CPU device — wasm is browser-only and throws in Node', async () => {
    const { renderer, state } = makeRenderer();
    await renderer.render(job());
    expect(state.fromPretrained.device).toBe('cpu');
  });

  it('defaults to fp32, the highest quality the model publishes', async () => {
    const { renderer, state } = makeRenderer();
    await renderer.render(job());
    expect(state.fromPretrained.dtype).toBe('fp32');
    expect(state.fromPretrained.model).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
  });

  it('honours an explicit dtype and model', async () => {
    const { renderer, state } = makeRenderer({ dtype: 'q8', model: 'someone/other-model' });
    await renderer.render(job());
    expect(state.fromPretrained).toMatchObject({ dtype: 'q8', model: 'someone/other-model' });
  });

  it('redirects the cache before loading, so npm ci cannot discard the download', async () => {
    const { renderer, env } = makeRenderer({ cacheDir: '/tmp/models' });
    await renderer.render(job());
    expect(env.cacheDir).toBe('/tmp/models');
  });

  it('still renders if transformers.js cannot be reached for the cache setting', async () => {
    const { renderer, written } = makeRenderer({
      importTransformers: async () => {
        throw new Error('not installed');
      }
    });
    await expect(renderer.render(job())).resolves.toBeDefined();
    expect(written.size).toBe(1);
  });

  it('loads the model once across many slides', async () => {
    const kokoro = stubKokoro();
    const { renderer } = makeRenderer({ kokoro });
    await renderer.render(job({ outPath: 'a.wav' }));
    await renderer.render(job({ outPath: 'b.wav' }));
    expect(kokoro.module.KokoroTTS.from_pretrained).toHaveBeenCalledTimes(1);
  });
});

describe('generation', () => {
  it('generates once per chunk, never one call per slide', async () => {
    // Kokoro truncates past ~510 phoneme tokens silently — audio just stops mid-sentence.
    // Sentence-sized chunks stay well under, so this is what keeps long notes intact.
    const { renderer, state } = makeRenderer();
    await renderer.render(job({ chunks: ['One.', 'Two.', 'Three.'] }));

    expect(state.generateCalls.map((c) => c.text)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('passes the voice and maps rate to speed', async () => {
    const { renderer, state } = makeRenderer();
    await renderer.render(job({ voice: 'af_bella', rate: 1.25 }));
    expect(state.generateCalls[0]).toMatchObject({ voice: 'af_bella', speed: 1.25 });
  });

  it('defaults to the only A-graded voice', async () => {
    const { renderer, state } = makeRenderer();
    await renderer.render(job());
    expect(state.generateCalls[0].voice).toBe('af_heart');
  });

  it('treats a nonsense rate as normal speed', async () => {
    const { renderer, state } = makeRenderer();
    await renderer.render(job({ rate: 0 }));
    expect(state.generateCalls[0].speed).toBe(1);
  });
});

describe('the written file', () => {
  it('is 16-bit PCM, not the 32-bit float kokoro-js would save', async () => {
    const { renderer, written } = makeRenderer();
    const format = await renderer.render(job());

    expect(format).toEqual({ sampleRate: SAMPLE_RATE, channels: 1, bitsPerSample: 16 });
    const bytes = written.get('out/001.wav');
    const info = readWavInfo(bytes, bytes.byteLength);
    expect(info).toMatchObject({ audioFormat: 1, bitsPerSample: 16, channels: 1 });
    expect(info.dataOffset + info.dataBytes).toBe(bytes.byteLength);
  });

  it('reports a duration matching the samples generated', async () => {
    const { renderer, written } = makeRenderer();
    await renderer.render(job({ chunks: ['abcde'] })); // 5 chars -> 500 frames

    const bytes = written.get('out/001.wav');
    expect(readWavInfo(bytes, bytes.byteLength).durationSec).toBeCloseTo(500 / SAMPLE_RATE, 6);
  });

  it('inserts the gap silence between chunks but not around them', async () => {
    const { renderer, written } = makeRenderer();
    await renderer.render(job({ chunks: ['ab', 'cd'], gapSilenceMs: 100 }));

    const bytes = written.get('out/001.wav');
    const info = readWavInfo(bytes, bytes.byteLength);
    // 200 + 200 speech frames + one 100ms gap
    const expected = (200 + 200 + 0.1 * SAMPLE_RATE) / SAMPLE_RATE;
    expect(info.durationSec).toBeCloseTo(expected, 6);
  });

  it('adds no lead or tail padding by default', async () => {
    const { renderer, written } = makeRenderer();
    await renderer.render(job({ chunks: ['ab'] }));
    const bytes = written.get('out/001.wav');
    expect(readWavInfo(bytes, bytes.byteLength).durationSec).toBeCloseTo(200 / SAMPLE_RATE, 6);
  });

  it('adds padding when it is asked for', async () => {
    const { renderer, written } = makeRenderer();
    await renderer.render(job({ chunks: ['ab'], leadSilenceMs: 500, tailSilenceMs: 500 }));
    const bytes = written.get('out/001.wav');
    const expected = (200 + SAMPLE_RATE) / SAMPLE_RATE;
    expect(readWavInfo(bytes, bytes.byteLength).durationSec).toBeCloseTo(expected, 6);
  });
});

describe('guardrails', () => {
  it('rejects an unknown voice with suggestions, before kokoro-js dumps its table', async () => {
    const { renderer, state } = makeRenderer();
    await expect(renderer.render(job({ voice: 'af_danielle' }))).rejects.toThrow(/bm_daniel/);
    expect(state.generateCalls).toHaveLength(0);
  });

  it('explains that a non-English voice cannot be loaded', async () => {
    const { renderer } = makeRenderer();
    // jf_alpha exists in the HuggingFace repo but kokoro-js cannot load it.
    await expect(renderer.render(job({ voice: 'jf_alpha' }))).rejects.toThrow(
      /not a Kokoro voice/
    );
  });

  it('refuses to render nothing', async () => {
    const { renderer } = makeRenderer();
    await expect(renderer.render(job({ chunks: [] }))).rejects.toThrow('nothing to render');
  });

  it('names the install command when kokoro-js is missing', async () => {
    const renderer = createKokoroRenderer({
      importKokoro: async () => {
        throw new Error("Cannot find package 'kokoro-js'");
      },
      nodeVersion: '22.0.0'
    });
    await expect(renderer.probe()).rejects.toThrow(/npm i -D kokoro-js/);
  });

  it('rejects a Node too old to locate kokoro-js’s voice files', async () => {
    const { renderer } = makeRenderer({ nodeVersion: '20.9.0' });
    await expect(renderer.probe()).rejects.toThrow(/Node 20\.11 or newer/);
  });

  it('accepts the minimum supported Node', async () => {
    const { renderer } = makeRenderer({ nodeVersion: '20.11.0' });
    await expect(renderer.probe()).resolves.toBeUndefined();
  });
});

describe('listVoices', () => {
  it('lists all 28 without touching the model', async () => {
    const kokoro = stubKokoro();
    const { renderer } = makeRenderer({ kokoro });
    const voices = await renderer.listVoices();

    expect(voices).toHaveLength(28);
    expect(kokoro.module.KokoroTTS.from_pretrained).not.toHaveBeenCalled();
  });

  it('reports grades, best first', async () => {
    const { renderer } = makeRenderer();
    const voices = await renderer.listVoices();
    expect(voices[0]).toMatchObject({ name: 'af_heart', grade: 'A', default: true });
  });
});
