import { describe, expect, it } from 'vitest';

import {
  floatToInt16,
  measureSilence,
  readWavInfo,
  sameFormat,
  wavHeader
} from '../../src/core/wav.js';

/**
 * Builds a WAV byte-for-byte, optionally inserting extra chunks before `data` — which is what
 * CoreAudio does, and the reason the reader cannot assume the samples start at byte 44.
 */
function buildWav({
  sampleRate = 48000,
  channels = 1,
  bitsPerSample = 16,
  frames = 100,
  extraChunks = [],
  dataSizeOverride = null
} = {}) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = frames * blockAlign;
  const extraBytes = extraChunks.reduce((n, c) => n + 8 + c.size + (c.size % 2), 0);

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
  for (const chunk of extraChunks) {
    ascii(offset, chunk.id);
    view.setUint32(offset + 4, chunk.size, true);
    offset += 8 + chunk.size + (chunk.size % 2);
  }

  ascii(offset, 'data');
  view.setUint32(offset + 4, dataSizeOverride ?? dataBytes, true);
  return { bytes, dataOffset: offset + 8, dataBytes };
}

describe('readWavInfo', () => {
  it('reads format and duration from a canonical header', () => {
    const { bytes } = buildWav({ sampleRate: 48000, frames: 48000 });
    const info = readWavInfo(bytes, bytes.length);

    expect(info).toMatchObject({
      sampleRate: 48000,
      channels: 1,
      bitsPerSample: 16,
      byteRate: 96000,
      dataOffset: 44
    });
    expect(info.durationSec).toBe(1);
  });

  it('walks past a FLLR chunk, which is what `say -o` actually writes', () => {
    // CoreAudio page-aligns the audio, so `data` is NOT at byte 44. Assuming 44 here would read
    // filler as samples and report a wrong duration.
    const { bytes, dataOffset } = buildWav({
      frames: 24000,
      extraChunks: [{ id: 'FLLR', size: 4020 }]
    });
    const info = readWavInfo(bytes, bytes.length);

    expect(info.dataOffset).toBe(dataOffset);
    expect(info.dataOffset).toBeGreaterThan(44);
    expect(info.durationSec).toBe(0.5);
  });

  it('honours the pad byte after an odd-sized chunk', () => {
    const { bytes, dataOffset } = buildWav({
      frames: 10,
      extraChunks: [{ id: 'LIST', size: 7 }]
    });
    const info = readWavInfo(bytes, bytes.length);

    expect(info.dataOffset).toBe(dataOffset);
    expect(info.dataBytes).toBe(20);
  });

  it('handles several chunks before the data', () => {
    const { bytes, dataOffset } = buildWav({
      frames: 5,
      extraChunks: [{ id: 'LIST', size: 3 }, { id: 'FLLR', size: 16 }, { id: 'JUNK', size: 1 }]
    });
    expect(readWavInfo(bytes, bytes.length).dataOffset).toBe(dataOffset);
  });

  it('falls back to the file length when the data size was never patched', () => {
    const { bytes, dataOffset, dataBytes } = buildWav({ frames: 100, dataSizeOverride: 0 });
    const info = readWavInfo(bytes, dataOffset + dataBytes);

    expect(info.dataBytes).toBe(dataBytes);
  });

  it('clamps a declared size larger than the file, rather than inventing audio', () => {
    // An export interrupted after the header was patched leaves exactly this. Trusting the
    // header would report a duration for samples that are not there, and anything splicing the
    // clip into a longer track would place everything after it too early.
    const { bytes, dataOffset } = buildWav({ frames: 50, dataSizeOverride: 999999 });
    const info = readWavInfo(bytes, bytes.length);

    expect(info.dataBytes).toBe(bytes.length - dataOffset);
    expect(info.durationSec).toBe(50 / 48000);
  });

  it('also falls back when the size field is 0xFFFFFFFF', () => {
    const { bytes, dataOffset, dataBytes } = buildWav({
      frames: 100,
      dataSizeOverride: 0xffffffff
    });
    expect(readWavInfo(bytes, dataOffset + dataBytes).dataBytes).toBe(dataBytes);
  });

  it('reads stereo and 8-bit correctly', () => {
    const { bytes } = buildWav({ channels: 2, sampleRate: 24000, frames: 24000 });
    expect(readWavInfo(bytes, bytes.length)).toMatchObject({ channels: 2, byteRate: 96000 });
    expect(readWavInfo(bytes, bytes.length).durationSec).toBe(1);
  });

  it('returns null for things that are not WAVs', () => {
    expect(readWavInfo(new Uint8Array(0))).toBeNull();
    expect(readWavInfo(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readWavInfo(new Uint8Array(64))).toBeNull(); // zeroes: no RIFF magic
    expect(readWavInfo(null)).toBeNull();
  });

  it('returns null when there is a header but no data chunk', () => {
    const { bytes } = buildWav({ frames: 4 });
    expect(readWavInfo(bytes.slice(0, 36), bytes.length)).toBeNull();
  });
});

describe('wavHeader', () => {
  it('round-trips through readWavInfo', () => {
    const header = wavHeader({ sampleRate: 24000, channels: 1, dataBytes: 48000 });
    const file = new Uint8Array(44 + 48000);
    file.set(header, 0);

    expect(readWavInfo(file, file.length)).toMatchObject({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      byteRate: 48000,
      dataOffset: 44,
      dataBytes: 48000,
      durationSec: 1
    });
  });

  it('is exactly 44 bytes', () => {
    expect(wavHeader({ sampleRate: 48000, dataBytes: 0 })).toHaveLength(44);
  });
});

describe('floatToInt16', () => {
  it('maps full scale symmetrically without clipping', () => {
    expect(Array.from(floatToInt16(new Float32Array([1, -1, 0])))).toEqual([32767, -32768, 0]);
  });

  it('clamps out-of-range input rather than wrapping', () => {
    expect(Array.from(floatToInt16(new Float32Array([2, -2])))).toEqual([32767, -32768]);
  });

  it('round-trips within one least-significant bit', () => {
    const input = new Float32Array([0.5, -0.25, 0.125, 0.0001, -0.9]);
    const out = floatToInt16(input);
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i] / 0x7fff - input[i])).toBeLessThan(1 / 0x7fff + 1e-7);
    }
  });
});

describe('measureSilence', () => {
  const info = { sampleRate: 1000, channels: 1, bitsPerSample: 16 };

  /** frames of int16 → the `data` payload bytes */
  function pcm(values) {
    const arr = new Int16Array(values);
    return new Uint8Array(arr.buffer);
  }

  it('finds silence at both ends', () => {
    // 100 silent, 200 loud, 300 silent, at 1000 Hz
    const values = [
      ...new Array(100).fill(0),
      ...new Array(200).fill(20000),
      ...new Array(300).fill(0)
    ];
    expect(measureSilence(pcm(values), info)).toEqual({
      leadSec: 0.1,
      tailSec: 0.3,
      silent: false
    });
  });

  it('distinguishes an entirely silent file from one that speaks edge to edge', () => {
    // Both have zero lead and zero tail, but only one of them is a problem — so the flag is
    // the only thing that tells a failed synthesis apart from a perfectly full clip.
    const allQuiet = measureSilence(pcm(new Array(500).fill(0)), info);
    const allLoud = measureSilence(pcm(new Array(500).fill(9000)), info);

    expect(allQuiet).toEqual({ leadSec: 0, tailSec: 0, silent: true });
    expect(allLoud).toEqual({ leadSec: 0, tailSec: 0, silent: false });
  });

  it('ignores a lone blip, which is why a minimum run is required', () => {
    const values = [...new Array(100).fill(0), 30000, ...new Array(100).fill(0)];
    values.push(...new Array(50).fill(25000));
    // The single spike at frame 100 is below the 5ms run, so speech starts at frame 201.
    expect(measureSilence(pcm(values), info).leadSec).toBeCloseTo(0.201, 5);
  });

  it('ignores low-level noise under the floor', () => {
    const quiet = Math.round(0.001 * 32767);
    const values = [...new Array(100).fill(quiet), ...new Array(100).fill(20000)];
    expect(measureSilence(pcm(values), info).leadSec).toBe(0.1);
  });

  it('declines to guess for bit depths it cannot read', () => {
    expect(measureSilence(pcm([1, 2]), { ...info, bitsPerSample: 32 })).toEqual({
      leadSec: 0,
      tailSec: 0,
      silent: false
    });
  });
});

describe('sameFormat', () => {
  const base = { sampleRate: 48000, channels: 1, bitsPerSample: 16 };

  it('accepts identical formats', () => {
    expect(sameFormat(base, { ...base })).toBe(true);
  });

  it('rejects a sample-rate mismatch, which would desync a concatenated master', () => {
    expect(sameFormat(base, { ...base, sampleRate: 24000 })).toBe(false);
    expect(sameFormat(base, { ...base, channels: 2 })).toBe(false);
  });
});
