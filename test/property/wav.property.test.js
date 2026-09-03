/**
 * Properties of the WAV byte math.
 *
 * Duration is the number the whole export hangs on — it places every clip on the timeline — so
 * the property that matters is exactness. Not "close enough": `frames / sampleRate`, for any
 * header layout a real encoder might produce, including the extra chunks CoreAudio inserts.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { floatToInt16, readWavInfo, wavHeader } from '../../src/core/wav.js';
import { RUNS, params } from './arbitraries.js';

const sampleRate = fc.constantFrom(8000, 16000, 22050, 24000, 44100, 48000);
const channels = fc.constantFrom(1, 2);
const bitsPerSample = fc.constantFrom(8, 16, 24, 32);
const frameCount = fc.integer({ min: 0, max: 5000 });

/** Chunks a real encoder might slip in ahead of the samples. `FLLR` is the one `say -o` writes. */
const extraChunks = fc.array(
  fc.record({
    id: fc.constantFrom('FLLR', 'LIST', 'JUNK', 'fact', 'bext'),
    size: fc.integer({ min: 0, max: 200 })
  }),
  { maxLength: 4 }
);

function buildWav({ sampleRate, channels, bitsPerSample, frames, extras }) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = frames * blockAlign;
  const extraBytes = extras.reduce((n, c) => n + 8 + c.size + (c.size % 2), 0);

  const bytes = new Uint8Array(12 + 24 + extraBytes + 8 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  let offset = 36;
  for (const c of extras) {
    ascii(offset, c.id);
    view.setUint32(offset + 4, c.size, true);
    offset += 8 + c.size + (c.size % 2);
  }

  ascii(offset, 'data');
  view.setUint32(offset + 4, dataBytes, true);
  return { bytes, dataOffset: offset + 8, dataBytes };
}

const wavSpec = fc.record({
  sampleRate,
  channels,
  bitsPerSample,
  frames: frameCount,
  extras: extraChunks
});

describe(`readWavInfo, over ${RUNS} generated files`, () => {
  it('reports the duration exactly, whatever the header layout', () => {
    fc.assert(
      fc.property(wavSpec, (spec) => {
        const { bytes } = buildWav(spec);
        const info = readWavInfo(bytes, bytes.length);

        expect(info).not.toBeNull();
        expect(info.durationSec).toBe(spec.frames / spec.sampleRate);
      }),
      params
    );
  });

  it('finds the samples wherever the encoder put them', () => {
    fc.assert(
      fc.property(wavSpec, (spec) => {
        const { bytes, dataOffset, dataBytes } = buildWav(spec);
        const info = readWavInfo(bytes, bytes.length);

        expect(info.dataOffset).toBe(dataOffset);
        expect(info.dataBytes).toBe(dataBytes);
        // The payload must actually fit in the file — the check that catches an off-by-one
        // in the chunk walk, which would otherwise just shift the duration slightly.
        expect(info.dataOffset + info.dataBytes).toBeLessThanOrEqual(bytes.length);
      }),
      params
    );
  });

  it('recovers the format it was given', () => {
    fc.assert(
      fc.property(wavSpec, (spec) => {
        const info = readWavInfo(buildWav(spec).bytes, undefined);
        expect(info.sampleRate).toBe(spec.sampleRate);
        expect(info.channels).toBe(spec.channels);
        expect(info.bitsPerSample).toBe(spec.bitsPerSample);
      }),
      params
    );
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(() => readWavInfo(bytes, bytes.length)).not.toThrow();
      }),
      params
    );
  });
});

describe(`wavHeader, over ${RUNS} generated formats`, () => {
  it('is always readable by readWavInfo', () => {
    fc.assert(
      fc.property(sampleRate, channels, frameCount, (rate, ch, frames) => {
        const dataBytes = frames * ch * 2;
        const file = new Uint8Array(44 + dataBytes);
        file.set(wavHeader({ sampleRate: rate, channels: ch, dataBytes }), 0);

        const info = readWavInfo(file, file.length);
        expect(info.durationSec).toBe(frames / rate);
        expect(info.dataBytes).toBe(dataBytes);
      }),
      params
    );
  });
});

describe(`floatToInt16, over ${RUNS} generated buffers`, () => {
  it('round-trips within one least-significant bit', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { maxLength: 200 }),
        (values) => {
          const out = floatToInt16(Float32Array.from(values));
          for (let i = 0; i < values.length; i++) {
            expect(Math.abs(out[i] / 0x7fff - values[i])).toBeLessThan(2 / 0x7fff);
          }
        }
      ),
      params
    );
  });

  it('never wraps around, however far out of range the input is', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { maxLength: 100 }),
        (values) => {
          for (const sample of floatToInt16(Float32Array.from(values))) {
            expect(sample).toBeGreaterThanOrEqual(-32768);
            expect(sample).toBeLessThanOrEqual(32767);
          }
        }
      ),
      params
    );
  });
});
