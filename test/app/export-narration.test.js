/**
 * The whole export flow, driven entirely through fakes.
 *
 * No macOS, no browser, no model download — which is the point of injecting every collaborator.
 * These are the tests that have to catch a wrong offset or a corrupt master track, because the
 * real thing is slow enough that nobody runs it on every change.
 */

import { describe, expect, it, vi } from 'vitest';

import { MASTER_FILE, exportNarration, fileNameFor } from '../../src/app/export-narration.js';
import { readWavInfo, wavHeader } from '../../src/core/wav.js';

/** An in-memory FilesPort. */
function fakeFiles(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    mkdir: vi.fn(async () => {}),
    write: vi.fn(async (path, data) => {
      store.set(path, typeof data === 'string' ? data : new Uint8Array(data));
    }),
    exists: async (path) => store.has(path),
    size: async (path) => store.get(path).byteLength,
    readHead: async (path, bytes) => store.get(path).slice(0, bytes),
    readRange: async (path, from, to) => store.get(path).slice(from, to)
  };
}

/** Builds a valid 16-bit WAV whose samples are loud in the middle and silent at the edges. */
function wavBytes({ sampleRate = 48000, channels = 1, frames, leadFrames = 0, tailFrames = 0 }) {
  const dataBytes = frames * channels * 2;
  const file = new Uint8Array(44 + dataBytes);
  file.set(wavHeader({ sampleRate, channels, dataBytes }), 0);

  const samples = new Int16Array(file.buffer, 44, frames * channels);
  for (let f = leadFrames; f < frames - tailFrames; f++) {
    for (let c = 0; c < channels; c++) samples[f * channels + c] = 12000;
  }
  return file;
}

/** A renderer that writes deterministic audio of a length derived from the text. */
function fakeRenderer({ files, format = { sampleRate: 48000, channels: 1, bitsPerSample: 16 }, failOn = [], framesFor } = {}) {
  const calls = [];
  return {
    id: 'fake',
    calls,
    probe: vi.fn(async () => {}),
    listVoices: async () => [{ name: 'Test Voice' }],
    render: vi.fn(async (job) => {
      calls.push(job);
      if (failOn.includes(job.outPath)) throw new Error('synthetic render failure');
      const frames = framesFor
        ? framesFor(job)
        : job.chunks.join(' ').length * 100; // ~ deterministic, and different per slide
      files.store.set(
        job.outPath,
        wavBytes({ ...format, frames, leadFrames: 480, tailFrames: 960 })
      );
      return format;
    })
  };
}

function slide(index, overrides = {}) {
  return {
    index,
    h: index,
    v: 0,
    id: null,
    title: `Slide ${index}`,
    hasNotes: true,
    chunks: [`Narration for slide ${index}.`],
    unclosedBracket: false,
    ...overrides
  };
}

function fakeSource(slides, config = {}) {
  return { readDeck: vi.fn(async () => ({ config, slides })), close: vi.fn(async () => {}) };
}

const baseOptions = { deck: 'deck.html', outDir: 'out', rate: 1, now: () => new Date(0) };

async function run(slides, overrides = {}, rendererOptions = {}) {
  const files = fakeFiles();
  const renderer = fakeRenderer({ files, ...rendererOptions });
  const source = fakeSource(slides, overrides.deckConfig);
  const result = await exportNarration({
    source,
    renderer,
    files,
    options: { ...baseOptions, ...overrides }
  });
  return { ...result, files, renderer, source };
}

describe('rendering', () => {
  it('renders one file per narrated slide and skips the silent ones', async () => {
    const { renderer, files } = await run([
      slide(0),
      slide(1, { hasNotes: false, chunks: [] }),
      slide(2)
    ]);

    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(files.store.has('out/001-h00-v00.wav')).toBe(true);
    expect(files.store.has('out/002-h01-v00.wav')).toBe(false);
    expect(files.store.has('out/003-h02-v00.wav')).toBe(true);
  });

  it('probes the renderer before doing any work', async () => {
    const files = fakeFiles();
    const renderer = fakeRenderer({ files });
    renderer.probe.mockRejectedValueOnce(new Error('say is macOS only'));
    const source = fakeSource([slide(0)]);

    await expect(
      exportNarration({ source, renderer, files, options: baseOptions })
    ).rejects.toThrow('say is macOS only');
    expect(source.readDeck).not.toHaveBeenCalled();
  });

  it('passes chunks through unjoined, so each engine can combine them its own way', async () => {
    const { renderer } = await run([slide(0, { chunks: ['One.', 'Two.'] })]);
    expect(renderer.calls[0].chunks).toEqual(['One.', 'Two.']);
  });

  it('forwards the silence settings to the renderer', async () => {
    const { renderer } = await run([slide(0)], { gapSilenceMs: 250, leadSilenceMs: 0 });
    expect(renderer.calls[0]).toMatchObject({ gapSilenceMs: 250, leadSilenceMs: 0 });
  });

  it('closes the source when it is done', async () => {
    const { source } = await run([slide(0)]);
    expect(source.close).toHaveBeenCalled();
  });
});

describe('the manifest', () => {
  it('measures real durations off the rendered files', async () => {
    const { manifest } = await run([slide(0)], {}, { framesFor: () => 48000 });
    expect(manifest.slides[0].durationSec).toBe(1);
  });

  it('reports where the speech actually starts, so clips can be trimmed exactly', async () => {
    const { manifest } = await run([slide(0)], {}, { framesFor: () => 48000 });
    // The fake writes 480 silent frames (10ms) of lead and 960 (20ms) of tail.
    expect(manifest.slides[0].speechStartSec).toBeCloseTo(0.01, 3);
    expect(manifest.slides[0].speechEndSec).toBeCloseTo(0.98, 3);
  });

  it('skips silence analysis when asked, leaving the fields null', async () => {
    const { manifest } = await run([slide(0)], { analyze: false });
    expect(manifest.slides[0].speechStartSec).toBeNull();
    expect(manifest.slides[0].durationSec).toBeGreaterThan(0);
  });

  it('records the format the renderer actually produced', async () => {
    const { manifest } = await run(
      [slide(0)],
      {},
      { format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 } }
    );
    expect(manifest.audio).toMatchObject({ sampleRate: 24000, codec: 'pcm_s16le' });
  });

  it('is written to disk alongside a CSV', async () => {
    const { files } = await run([slide(0)]);
    expect(files.store.has('out/manifest.json')).toBe(true);
    expect(files.store.get('out/narration.csv')).toContain('index,h,v,file');
    expect(JSON.parse(files.store.get('out/manifest.json')).version).toBe(1);
  });
});

describe('partial failure', () => {
  it('keeps exporting after one slide fails', async () => {
    const { manifest, failures, files } = await run([slide(0), slide(1), slide(2)], {}, {
      failOn: ['out/002-h01-v00.wav']
    });

    expect(failures).toEqual([{ index: 1, error: 'synthetic render failure' }]);
    expect(manifest.slides[1].warnings).toContain('render-failed');
    expect(manifest.slides[1].file).toBeNull();
    expect(manifest.totals.narrated).toBe(2);
    expect(files.store.has('out/003-h02-v00.wav')).toBe(true);
  });

  it('does not let a failed slide occupy timeline', async () => {
    const { manifest } = await run([slide(0), slide(1)], {}, {
      failOn: ['out/001-h00-v00.wav']
    });
    expect(manifest.slides[1].startSec).toBe(0);
  });

  it('refuses to mix formats, rather than writing a master that plays at the wrong speed', async () => {
    const files = fakeFiles();
    const renderer = fakeRenderer({ files });
    let call = 0;
    renderer.render.mockImplementation(async (job) => {
      const format =
        call++ === 0
          ? { sampleRate: 48000, channels: 1, bitsPerSample: 16 }
          : { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
      files.store.set(job.outPath, wavBytes({ ...format, frames: 1000 }));
      return format;
    });

    const { failures } = await exportNarration({
      source: fakeSource([slide(0), slide(1)]),
      renderer,
      files,
      options: baseOptions
    });

    expect(failures[0].error).toMatch(/format changed mid-export/);
  });
});

describe('the concatenated master', () => {
  it('sums the clips plus one gap between each', async () => {
    const { files, manifest } = await run(
      [slide(0), slide(1)],
      { slideGapSec: 0.5 },
      { framesFor: () => 48000 }
    );

    const master = files.store.get(MASTER_FILE.replace(/^/, 'out/'));
    const info = readWavInfo(master, master.byteLength);

    // two 1s clips + one 0.5s gap
    expect(info.durationSec).toBeCloseTo(2.5, 6);
    expect(info.dataOffset + info.dataBytes).toBe(master.byteLength);
    expect(manifest.totals.timelineSec).toBeCloseTo(2.5, 3);
  });

  it('matches the manifest timeline to within the manifest’s millisecond rounding', async () => {
    const { files, manifest } = await run([slide(0), slide(1), slide(2)], { slideGapSec: 0.25 });
    const master = files.store.get('out/narration-full.wav');
    const info = readWavInfo(master, master.byteLength);

    // The master is sample-exact; the manifest rounds to milliseconds because that is the
    // finest unit any editor works in. They can never differ by a whole millisecond.
    expect(Math.abs(info.durationSec - manifest.totals.timelineSec)).toBeLessThan(0.001);
  });

  it('writes no gap for a single clip', async () => {
    const { files } = await run([slide(0)], { slideGapSec: 1 }, { framesFor: () => 48000 });
    const master = files.store.get('out/narration-full.wav');
    expect(readWavInfo(master, master.byteLength).durationSec).toBeCloseTo(1, 6);
  });

  it('aligns gaps to a frame boundary in stereo', async () => {
    const { files } = await run(
      [slide(0), slide(1)],
      { slideGapSec: 0.3333 },
      { format: { sampleRate: 44100, channels: 2, bitsPerSample: 16 }, framesFor: () => 4410 }
    );
    const master = files.store.get('out/narration-full.wav');
    const info = readWavInfo(master, master.byteLength);
    expect(info.dataBytes % 4).toBe(0); // 2 channels x 16 bit
  });

  it('is skipped when --no-concat is given', async () => {
    const { files, manifest } = await run([slide(0)], { concat: false });
    expect(files.store.has('out/narration-full.wav')).toBe(false);
    expect('concatenated' in manifest).toBe(false);
  });

  it('is skipped when nothing was narrated', async () => {
    const { files } = await run([slide(0, { hasNotes: false, chunks: [] })]);
    expect(files.store.has('out/narration-full.wav')).toBe(false);
  });

  it('is never advertised in the manifest unless it was actually written', async () => {
    // The renderer claims success and a format, but writes something unreadable — so every
    // slide fails and no master is produced. A manifest pointing at a file that does not
    // exist is worse than one that stays quiet about it.
    const files = fakeFiles();
    const renderer = fakeRenderer({ files });
    renderer.render.mockImplementation(async (job) => {
      files.store.set(job.outPath, new Uint8Array([1, 2, 3, 4, 5]));
      return { sampleRate: 48000, channels: 1, bitsPerSample: 16 };
    });

    const { manifest, failures } = await exportNarration({
      source: fakeSource([slide(0), slide(1)]),
      renderer,
      files,
      options: baseOptions
    });

    expect(failures).toHaveLength(2);
    expect('concatenated' in manifest).toBe(false);
    expect(files.store.has('out/narration-full.wav')).toBe(false);
  });
});

describe('flagging audio that came out empty', () => {
  it('warns when a clip rendered successfully but contains no sound', async () => {
    const files = fakeFiles();
    const renderer = fakeRenderer({ files });
    renderer.render.mockImplementation(async (job) => {
      const format = { sampleRate: 48000, channels: 1, bitsPerSample: 16 };
      // A valid WAV of pure silence — the engine reported success, but there is nothing to hear.
      files.store.set(job.outPath, wavBytes({ ...format, frames: 48000, leadFrames: 48000 }));
      return format;
    });

    const { manifest } = await exportNarration({
      source: fakeSource([slide(0)]),
      renderer,
      files,
      options: baseOptions
    });

    expect(manifest.slides[0].warnings).toContain('silent-audio');
  });

  it('does not warn about a normal clip', async () => {
    const { manifest } = await run([slide(0)]);
    expect(manifest.slides[0].warnings).not.toContain('silent-audio');
  });
});

describe('the slide gap and the master track agree', () => {
  it('rounds the manifest gap to a whole frame, so offsets cannot drift', async () => {
    // 0.3333s at 48kHz is 15998.4 frames. The master can only hold 15998, so the manifest has
    // to report that same rounded value — otherwise every slide's offset creeps further out.
    const { manifest, files } = await run(
      [slide(0), slide(1), slide(2)],
      { slideGapSec: 0.3333 },
      { framesFor: () => 48000 }
    );

    expect(manifest.padding.slideGapSec).toBeCloseTo(15998 / 48000, 10);

    const master = files.store.get('out/narration-full.wav');
    const info = readWavInfo(master, master.byteLength);
    // Exact, not approximate: three 1s clips plus two whole-frame gaps.
    expect(info.dataBytes).toBe((48000 * 3 + 15998 * 2) * 2);
    // The manifest still rounds to milliseconds for readability, so that is the only
    // discrepancy left — and it no longer grows with the number of slides.
    expect(Math.abs(info.durationSec - manifest.totals.timelineSec)).toBeLessThan(0.001);
  });
});

describe('--dry-run', () => {
  it('extracts and writes a manifest without rendering anything', async () => {
    const { manifest, renderer, files } = await run([slide(0), slide(1)], { dryRun: true });

    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.probe).not.toHaveBeenCalled();
    expect(manifest.slides[0].durationSec).toBeNull();
    expect(manifest.slides[0].chunks).toEqual(['Narration for slide 0.']);
    expect(files.store.has('out/manifest.json')).toBe(true);
    expect(files.store.has('out/narration-full.wav')).toBe(false);
  });
});

describe('--slides', () => {
  it('refuses to splice a reused clip whose format no longer matches', async () => {
    // Export with one engine, then re-render a single slide with another. The reused clips are
    // still at the old sample rate; without a check they would be spliced into the master
    // unchanged and play at the wrong speed, with every offset after the first slide wrong.
    const files = fakeFiles();
    const slides = [slide(0), slide(1), slide(2)];
    const source = fakeSource(slides);

    const first = fakeRenderer({
      files,
      format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
      framesFor: () => 24000
    });
    await exportNarration({ source, renderer: first, files, options: baseOptions });

    const second = fakeRenderer({
      files,
      format: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
      framesFor: () => 48000
    });
    const { manifest, failures } = await exportNarration({
      source,
      renderer: second,
      files,
      options: { ...baseOptions, only: new Set([0]) }
    });

    expect(failures).toHaveLength(2);
    expect(failures[0].error).toMatch(/24000Hz.*48000Hz|48000Hz.*24000Hz/);
    expect(manifest.slides[1].warnings).toContain('render-failed');
    // The one slide that did render is still usable, and the master is consistent with it.
    expect(manifest.totals.narrated).toBe(1);
    const master = files.store.get('out/narration-full.wav');
    expect(readWavInfo(master, master.byteLength).sampleRate).toBe(48000);
  });

  it('re-renders only the selected slides and reuses the rest', async () => {
    // First a full export, then a second run touching only slide 2.
    const files = fakeFiles();
    const renderer = fakeRenderer({ files, framesFor: () => 48000 });
    const slides = [slide(0), slide(1), slide(2)];
    const source = fakeSource(slides);

    await exportNarration({ source, renderer, files, options: baseOptions });
    renderer.render.mockClear();

    const { manifest } = await exportNarration({
      source,
      renderer,
      files,
      options: { ...baseOptions, only: new Set([1]) }
    });

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.calls.at(-1).outPath).toBe('out/002-h01-v00.wav');
    // The manifest is still whole: every slide has a duration read back off disk.
    expect(manifest.slides.map((s) => s.durationSec)).toEqual([1, 1, 1]);
    expect(manifest.totals.narrated).toBe(3);
  });
});

describe('deck config', () => {
  it('lets the caller settle voice and rate once the deck config is known', async () => {
    const resolveSettings = vi.fn(() => ({ voice: 'af_bella', rate: 1.2 }));
    const { renderer, manifest } = await run([slide(0)], {
      deckConfig: { engine: 'kokoro', voice: 'af_bella' },
      resolveSettings
    });

    expect(resolveSettings).toHaveBeenCalledWith({ engine: 'kokoro', voice: 'af_bella' });
    expect(renderer.calls[0]).toMatchObject({ voice: 'af_bella', rate: 1.2 });
    expect(manifest.voice).toBe('af_bella');
    expect(manifest.rate).toBe(1.2);
  });

  it('falls back to the options when no resolver is given', async () => {
    const { renderer } = await run([slide(0)], { voice: 'Ava (Premium)', rate: 0.9 });
    expect(renderer.calls[0]).toMatchObject({ voice: 'Ava (Premium)', rate: 0.9 });
  });
});

describe('fileNameFor', () => {
  it('sorts lexically into presentation order', () => {
    const names = [slide(0), slide(9), slide(10), slide(99)].map(fileNameFor);
    expect([...names].sort()).toEqual(names);
  });

  it('encodes the reveal.js coordinates', () => {
    expect(fileNameFor({ index: 4, h: 3, v: 2 })).toBe('005-h03-v02.wav');
  });
});
