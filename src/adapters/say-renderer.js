/**
 * AudioRenderPort over the macOS `say` command's file output.
 *
 * This renders rather than records, which is the important distinction. `say -o` writes the
 * complete sample buffer through CoreAudio's file writer and closes it — no output device is
 * ever opened. That makes it lossless, repeatable, and roughly ten to twenty times faster than
 * listening to the deck.
 *
 * It also means the silence padding the live engine needs is actively unwanted here. That
 * padding exists because `say` exits before an idle audio device has drained, clipping the first
 * and last word (see src/adapters/say-speech.js). With no device in the picture there is nothing
 * to clip, and baked-in leading silence would just force the presenter to trim every clip by
 * hand. So lead and tail default to zero, and the exporter reports where the speech actually
 * starts instead.
 */

import { spawn } from 'node:child_process';

import { joinForSay, toWordsPerMinute } from '../core/say-format.js';
import { isNamedVoice, toVoiceCatalog } from '../core/say-voices.js';

/** 48kHz is what screen recorders capture, so an editor never has to resample. */
export const DEFAULT_SAMPLE_RATE = 48000;

/**
 * @param {object} [options]
 * @param {string} [options.sayBin] overridable via SAY_BIN, which is also how the test suite
 *   points at a fake on a machine with no `say`
 * @param {number} [options.sampleRate]
 * @param {typeof spawn} [options.spawnImpl] injectable for tests
 * @returns {import('../ports.js').AudioRenderPort}
 */
export function createSayRenderer(options = {}) {
  const {
    sayBin = process.env.SAY_BIN || 'say',
    sampleRate = DEFAULT_SAMPLE_RATE,
    spawnImpl = spawn
  } = options;

  function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(sayBin, args);
      let out = '';
      let err = '';
      child.stdout?.on('data', (chunk) => (out += chunk));
      child.stderr?.on('data', (chunk) => (err += chunk));

      child.on('error', (error) =>
        reject(
          error.code === 'ENOENT'
            ? new Error(
                `Could not run "${sayBin}". Exporting with --engine say needs the macOS \`say\`\n` +
                  'command. On another platform, use --engine kokoro instead.'
              )
            : error
        )
      );

      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `say exited with code ${code}`));
        resolve(out);
      });
    });
  }

  async function probe() {
    // SAY_BIN set means a deliberate override — a fake in tests, or a wrapper — so the platform
    // check would only get in the way. Same convention as bin/say-server.js.
    if (process.platform !== 'darwin' && !process.env.SAY_BIN) {
      throw new Error(
        'The `say` engine renders with the macOS `say` command, so it only runs on macOS.\n' +
          'Use --engine kokoro instead — it runs anywhere and needs no system voices.'
      );
    }
    await run(['-v', '?']);
  }

  async function listVoices() {
    return toVoiceCatalog(await run(['-v', '?']));
  }

  /**
   * @param {import('../ports.js').RenderJob} job
   * @returns {Promise<import('../ports.js').AudioFormat>}
   */
  async function render(job) {
    const text = joinForSay(job.chunks, {
      leadSilenceMs: job.leadSilenceMs ?? 0,
      gapSilenceMs: job.gapSilenceMs ?? 0,
      tailSilenceMs: job.tailSilenceMs ?? 0
    });
    if (text === '') throw new Error('nothing to render');

    const args = ['-r', String(toWordsPerMinute(job.rate))];
    if (isNamedVoice(job.voice)) args.push('-v', job.voice);
    args.push(
      '-o',
      job.outPath,
      '--file-format=WAVE',
      `--data-format=LEI16@${sampleRate}`,
      '--channels=1'
    );
    // Text last, as a positional argument. Never via `-f`/stdin: the man page warns that TTY
    // input yields only the last line, and `-f` does not guarantee UTF-8 — whereas argv through
    // spawn() is UTF-8 clean, which is what makes accented voices work.
    args.push(text);

    try {
      await run(args);
    } catch (error) {
      // An exotic third-party voice may not support the requested PCM format.
      if (/format|data-format/i.test(error.message)) {
        throw new Error(
          `${error.message}\nThis voice may not support ${sampleRate}Hz. ` +
            'Try --sample-rate 22050, the synthesiser’s native rate.'
        );
      }
      throw error;
    }

    return { sampleRate, channels: 1, bitsPerSample: 16 };
  }

  return { id: 'say', probe, listVoices, render };
}
