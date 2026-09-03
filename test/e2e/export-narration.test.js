/**
 * End-to-end: the real `bin/export-narration.js` CLI, against the real demo deck, in a real
 * browser.
 *
 * Only the macOS `say` binary is substituted (via `test/fixtures/fake-say.js`, which honours
 * `-o` by writing a genuine WAV), so this sandbox needs no Mac. Everything else is the shipping
 * code path: Playwright loading the deck, the deck's own `RevealAloud.preview()` deciding what
 * gets spoken, real WAVs on a real filesystem, and the manifest and master track built from
 * them.
 *
 * Kokoro is deliberately out of scope here — a 310MB model download does not belong in a test
 * run. It is covered by `test/adapters/kokoro-renderer.test.js` against a stub.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

import { readWavInfo } from '../../src/core/wav.js';

const CLI = fileURLToPath(new URL('../../bin/export-narration.js', import.meta.url));
const FAKE_SAY = fileURLToPath(new URL('../fixtures/fake-say.js', import.meta.url));
const DECK = fileURLToPath(new URL('../../demo/index.html', import.meta.url));

/** Matches the skip behaviour of the other e2e suites: no browser locally means skip, not fail. */
async function browserAvailable() {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch (error) {
    if (process.env.CI) throw error;
    console.warn(
      '\n  Skipping the export end-to-end suite: no browser available.' +
        '\n  Run `npx playwright install chromium`.\n'
    );
    return false;
  }
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      // SAY_BIN both substitutes the binary and waives the macOS platform check, so this
      // suite runs on Linux CI exactly as it does here.
      env: { ...process.env, SAY_BIN: FAKE_SAY }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let dir;
let available = false;
let result;
let manifest;

beforeAll(async () => {
  available = await browserAvailable();
  if (!available) return;

  dir = await mkdtemp(join(tmpdir(), 'reveal-aloud-e2e-'));
  result = await runCli([DECK, '--engine', 'say', '--out', dir]);
  if (result.code === 0) {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  }
}, 180000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.runIf(await browserAvailable())('exporting the demo deck', () => {
  it('succeeds', () => {
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('finds every slide in the deck, and knows which ones speak', () => {
    // The demo deck deliberately includes slides with no notes and notes that are entirely
    // bracketed, so these two numbers being different is the point.
    expect(manifest.totals.slides).toBeGreaterThan(10);
    expect(manifest.totals.narrated).toBeGreaterThan(0);
    expect(manifest.totals.narrated).toBeLessThan(manifest.totals.slides);
  });

  it('writes one readable WAV per narrated slide', async () => {
    const files = (await readdir(dir)).filter(
      (name) => name.endsWith('.wav') && name !== 'narration-full.wav'
    );
    expect(files).toHaveLength(manifest.totals.narrated);

    for (const file of files) {
      const bytes = new Uint8Array(await readFile(join(dir, file)));
      const info = readWavInfo(bytes, bytes.length);
      expect(info, `${file} should be a valid WAV`).not.toBeNull();
      expect(info.durationSec).toBeGreaterThan(0);
    }
  });

  it('names files so a lexical sort is presentation order', async () => {
    const files = (await readdir(dir))
      .filter((name) => /^\d{3}-h\d{2}-v\d{2}\.wav$/.test(name))
      .sort();
    const fromManifest = manifest.slides.filter((s) => s.file).map((s) => s.file);
    expect(files).toEqual(fromManifest);
  });

  it('reports durations matching the files on disk', async () => {
    for (const slide of manifest.slides.filter((s) => s.file)) {
      const bytes = new Uint8Array(await readFile(join(dir, slide.file)));
      const info = readWavInfo(bytes, bytes.length);
      expect(Math.abs(info.durationSec - slide.durationSec)).toBeLessThan(0.001);
    }
  });

  it('never speaks a stage direction', () => {
    // Note this cannot assert "no brackets in the text at all": the deck has a slide
    // demonstrating escaped \[brackets\], which are supposed to survive as literal characters.
    // So assert on the actual stage-direction wording instead.
    const directions = [
      'pause for effect',
      'point at the screen',
      'smile, wait for them to settle',
      'click to reveal the chart',
      'thank them and take questions',
      'hand out the worksheets'
    ];
    const spoken = manifest.slides.map((slide) => slide.text.toLowerCase()).join(' ');

    for (const direction of directions) expect(spoken).not.toContain(direction);
  });

  it('does speak an escaped bracket, which is a different thing entirely', () => {
    const spoken = manifest.slides.map((slide) => slide.text).join(' ');
    expect(spoken).toContain('[optional]');
  });

  it('flags the deck’s deliberately unclosed bracket', () => {
    const flagged = manifest.slides.filter((s) => s.warnings.includes('unclosed-bracket'));
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('lays out a timeline with no overlaps and no drift', () => {
    const clips = manifest.slides.filter((s) => s.file);
    for (let i = 0; i + 1 < clips.length; i++) {
      expect(clips[i + 1].startSec - clips[i].endSec).toBeCloseTo(manifest.padding.slideGapSec, 3);
    }
    expect(clips[0].startSec).toBe(0);
    expect(manifest.totals.timelineSec).toBeCloseTo(clips.at(-1).endSec, 3);
  });

  it('writes a master track whose length matches the manifest timeline', async () => {
    const bytes = new Uint8Array(await readFile(join(dir, 'narration-full.wav')));
    const info = readWavInfo(bytes, bytes.length);

    expect(info).not.toBeNull();
    expect(info.dataOffset + info.dataBytes).toBe(bytes.length);
    expect(Math.abs(info.durationSec - manifest.totals.timelineSec)).toBeLessThan(0.001);
  });

  it('writes a CSV with a row per slide', async () => {
    const csv = await readFile(join(dir, 'narration.csv'), 'utf8');
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(manifest.slides.length + 1);
    expect(rows[0]).toMatch(/^index,h,v,file,startSec/);
  });
});

describe('the CLI on its own', () => {
  it('refuses webspeech, naming the engines that do work', async () => {
    const { code, stderr } = await runCli(['deck.html', '--engine', 'webspeech']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--engine say/);
    expect(stderr).toMatch(/--engine kokoro/);
  });

  it('lists say voices without needing a deck or a browser', async () => {
    const { code, stdout } = await runCli(['--list-voices', 'say']);
    expect(code).toBe(0);
    expect(stdout).toContain('system-default');
  });

  it('lists kokoro voices with grades, without downloading the model', async () => {
    const { code, stdout } = await runCli(['--list-voices', 'kokoro']);
    expect(code).toBe(0);
    expect(stdout).toContain('af_heart');
    expect(stdout).toContain('best overall');
  });

  it('prints usage when given nothing to do', async () => {
    const { stdout } = await runCli([]);
    expect(stdout).toContain('reveal-aloud-export');
  });
});
