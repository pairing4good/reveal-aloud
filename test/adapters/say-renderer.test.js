/**
 * The `say -o` renderer, driven against the fake `say` in test/fixtures.
 *
 * The argv assertions matter as much as the audio ones: a wrong flag order or a missing
 * `--data-format` silently produces a file in a different format, which the exporter would then
 * refuse to concatenate — or worse, would concatenate at the wrong rate.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSayRenderer } from '../../src/adapters/say-renderer.js';
import { readWavInfo } from '../../src/core/wav.js';

const FAKE_SAY = fileURLToPath(new URL('../fixtures/fake-say.js', import.meta.url));

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reveal-aloud-render-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The fake is a Node script, so `say` becomes `node fixtures/fake-say.js ...`. */
function renderer(options = {}) {
  return createSayRenderer({
    sayBin: process.execPath,
    spawnImpl: (bin, args, opts) => realSpawn(bin, [FAKE_SAY, ...args], opts),
    ...options
  });
}

const { spawn: realSpawn } = await import('node:child_process');

async function read(path) {
  const bytes = new Uint8Array(await readFile(path));
  return { bytes, info: readWavInfo(bytes, bytes.length) };
}

describe('render', () => {
  it('writes a real, parseable WAV in the requested format', async () => {
    const outPath = join(dir, 'one.wav');
    const format = await renderer().render({
      chunks: ['Hello there.'],
      rate: 1,
      outPath
    });

    expect(format).toEqual({ sampleRate: 48000, channels: 1, bitsPerSample: 16 });
    const { info } = await read(outPath);
    expect(info).toMatchObject({ sampleRate: 48000, channels: 1, bitsPerSample: 16 });
    expect(info.durationSec).toBeGreaterThan(0);
  });

  it('honours a non-default sample rate', async () => {
    const outPath = join(dir, 'rate.wav');
    const format = await renderer({ sampleRate: 22050 }).render({
      chunks: ['Hello.'],
      rate: 1,
      outPath
    });

    expect(format.sampleRate).toBe(22050);
    expect((await read(outPath)).info.sampleRate).toBe(22050);
  });

  it('builds the argv `say` needs, with the text last', async () => {
    const spawnImpl = vi.fn((bin, args, opts) => realSpawn(bin, [FAKE_SAY, ...args], opts));
    await createSayRenderer({ sayBin: process.execPath, spawnImpl }).render({
      chunks: ['Alpha.', 'Beta.'],
      voice: 'Ava (Premium)',
      rate: 1.5,
      outPath: join(dir, 'argv.wav'),
      gapSilenceMs: 300
    });

    const args = spawnImpl.mock.calls[0][1];
    expect(args).toContain('--file-format=WAVE');
    expect(args).toContain('--data-format=LEI16@48000');
    expect(args).toContain('--channels=1');
    expect(args[args.indexOf('-r') + 1]).toBe('263'); // 175 * 1.5, rounded
    expect(args[args.indexOf('-v') + 1]).toBe('Ava (Premium)');
    expect(args.at(-1)).toBe('[[slnc 0]] Alpha. [[slnc 300]] Beta. [[slnc 0]]');
  });

  it('omits -v for the system default, which must be the absence of the flag', async () => {
    const spawnImpl = vi.fn((bin, args, opts) => realSpawn(bin, [FAKE_SAY, ...args], opts));
    await createSayRenderer({ sayBin: process.execPath, spawnImpl }).render({
      chunks: ['Hi.'],
      voice: 'system-default',
      rate: 1,
      outPath: join(dir, 'default-voice.wav')
    });

    expect(spawnImpl.mock.calls[0][1]).not.toContain('-v');
  });

  it('adds no lead or tail silence by default', async () => {
    // With -o there is no audio device to spin up, so the live engine's padding would only
    // force the presenter to trim every clip by hand.
    const spawnImpl = vi.fn((bin, args, opts) => realSpawn(bin, [FAKE_SAY, ...args], opts));
    await createSayRenderer({ sayBin: process.execPath, spawnImpl }).render({
      chunks: ['Hi.'],
      rate: 1,
      outPath: join(dir, 'nopad.wav')
    });

    expect(spawnImpl.mock.calls[0][1].at(-1)).toBe('[[slnc 0]] Hi. [[slnc 0]]');
  });

  it('bakes in padding when it is explicitly asked for', async () => {
    const outPath = join(dir, 'padded.wav');
    await renderer().render({
      chunks: ['Hi.'],
      rate: 1,
      outPath,
      leadSilenceMs: 500,
      tailSilenceMs: 500
    });

    const { info } = await read(outPath);
    expect(info.durationSec).toBeGreaterThan(1); // the two 500ms pads at minimum
  });

  it('renders longer audio for longer notes', async () => {
    const shortPath = join(dir, 'short.wav');
    const longPath = join(dir, 'long.wav');
    await renderer().render({ chunks: ['Hi.'], rate: 1, outPath: shortPath });
    await renderer().render({
      chunks: ['This is a considerably longer sentence to narrate.'],
      rate: 1,
      outPath: longPath
    });

    expect((await read(longPath)).info.durationSec).toBeGreaterThan(
      (await read(shortPath)).info.durationSec
    );
  });

  it('renders faster audio at a higher rate', async () => {
    const slowPath = join(dir, 'slow.wav');
    const fastPath = join(dir, 'fast.wav');
    const chunks = ['The same sentence at two different speeds.'];
    await renderer().render({ chunks, rate: 1, outPath: slowPath });
    await renderer().render({ chunks, rate: 2, outPath: fastPath });

    expect((await read(fastPath)).info.durationSec).toBeLessThan(
      (await read(slowPath)).info.durationSec
    );
  });

  it('refuses to render nothing rather than spawning a doomed process', async () => {
    await expect(
      renderer().render({ chunks: [], rate: 1, outPath: join(dir, 'never.wav') })
    ).rejects.toThrow('nothing to render');
  });

  it('surfaces a failing say with its own message', async () => {
    const failing = createSayRenderer({
      sayBin: process.execPath,
      spawnImpl: (bin, args) =>
        realSpawn(bin, [FAKE_SAY, ...args], { env: { ...process.env, FAKE_SAY_EXIT_CODE: '1' } })
    });

    await expect(
      failing.render({ chunks: ['Hi.'], rate: 1, outPath: join(dir, 'fail.wav') })
    ).rejects.toThrow(/exited with code 1/);
  });
});

describe('probe', () => {
  it('names kokoro as the alternative when say is missing', async () => {
    const missing = createSayRenderer({ sayBin: '/nonexistent/say' });
    await expect(missing.probe()).rejects.toThrow(/--engine kokoro/);
  });

  it('passes when say answers', async () => {
    await expect(renderer().probe()).resolves.toBeUndefined();
  });
});

describe('listVoices', () => {
  it('puts the system default first, then what say reports', async () => {
    const voices = await renderer().listVoices();
    expect(voices[0]).toEqual({ name: 'system-default', lang: '', default: true });
    expect(voices.map((v) => v.name)).toContain('Ava (Premium)');
  });
});
