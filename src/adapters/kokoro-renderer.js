/**
 * AudioRenderPort over Kokoro running under Node.
 *
 * The browser adapter (src/adapters/kokoro-speech.js) and this one talk to the same model but
 * agree on almost nothing else, and the differences are all load-bearing:
 *
 *   - `device` must be `'cpu'`. Transformers.js only offers `'wasm'` in its browser branch; in
 *     Node on macOS the supported list is literally `['cpu']`, and `'wasm'` throws outright.
 *   - The model cache defaults to a directory *inside* `node_modules`, so `npm ci` or a cleaned
 *     checkout silently discards a 300MB download. It is redirected below, which has to happen
 *     before the model loads.
 *   - `dtype` defaults to `fp32` here rather than `q8`. Export is offline and happens once, so
 *     the download is worth trading for the best audio the model can produce.
 *   - Audio is taken as raw samples rather than through `RawAudio.save()`, which writes 32-bit
 *     float WAVs. Everything the exporter writes is 16-bit PCM so the files share one format
 *     and can be concatenated.
 *
 * kokoro-js is imported lazily. It pulls in onnxruntime and transformers.js — around 400MB of
 * node_modules — and a presenter who exports with `say` should never pay for that.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_KOKORO_VOICE, KOKORO_VOICES, kokoroVoice, suggestVoices } from '../core/kokoro-voices.js';
import { floatToInt16, wavHeader } from '../core/wav.js';

export const DEFAULT_KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Highest quality the model publishes. See ENGINES.md for the size/quality table. */
export const DEFAULT_KOKORO_DTYPE = 'fp32';

/** kokoro-js locates its bundled voice files with `import.meta.dirname`, added in 20.11. */
const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 11;

const INSTALL_HINT =
  'Kokoro export needs the model runtime, a large one-time install (~400MB):\n' +
  '  npm i -D kokoro-js';

/**
 * Resolves transformers.js *as kokoro-js sees it*, and specifically its ESM build.
 *
 * Two traps here, both observed rather than theoretical:
 *
 * 1. kokoro-js depends on `@huggingface/transformers@^3.5.1`. If anything else in the tree pulls
 *    in v4, npm nests a second copy under kokoro-js, and a plain
 *    `import('@huggingface/transformers')` hands back the *other* one.
 * 2. `require.resolve` picks the `require` condition, so it returns the CJS build — while our
 *    `import('kokoro-js')` loads the ESM build, which imports the ESM transformers. Those are
 *    two separate module instances with two separate `env` objects.
 *
 * Get either wrong and `env.cacheDir` is set on an object nobody reads: the model still
 * downloads, just into node_modules, where the next `npm ci` discards 310MB of it.
 */
async function importTransformersAsKokoroSees() {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const { readFile } = await import('node:fs/promises');

  const kokoroEntry = createRequire(import.meta.url).resolve('kokoro-js');
  // The CJS path is only a landmark for finding the package root — `package.json` itself is not
  // in the exports map, so it cannot be resolved directly.
  const cjs = createRequire(kokoroEntry).resolve('@huggingface/transformers');

  let root = dirname(cjs);
  let manifest = null;
  for (let i = 0; i < 5 && root !== dirname(root); i++) {
    try {
      manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (manifest.name === '@huggingface/transformers') break;
      manifest = null;
    } catch {
      // keep walking up
    }
    root = dirname(root);
  }
  if (!manifest) throw new Error('could not locate the transformers.js package root');

  const entry =
    manifest.exports?.node?.import?.default ??
    manifest.exports?.node?.import ??
    manifest.module ??
    manifest.main;
  if (typeof entry !== 'string') throw new Error('transformers.js has no ESM entry point');

  const module = await import(pathToFileURL(join(root, entry)).href);
  // A CJS fallback surfaces its named exports under `default`.
  return module.env ? module : (module.default ?? module);
}

/**
 * @param {object} [options]
 * @param {string} [options.model] HuggingFace repo id
 * @param {'fp32'|'fp16'|'q8'|'q4'|'q4f16'} [options.dtype]
 * @param {string} [options.cacheDir] where the model is kept between runs
 * @param {(update: {file?: string, loaded: number, total: number}) => void} [options.onProgress]
 * @param {(message: string) => void} [options.onWarning] non-fatal problems worth surfacing
 * @param {(path: string, data: Uint8Array) => Promise<void>} [options.write] how the rendered
 *   file reaches disk. Unlike `say`, which writes its own output, Kokoro hands back samples —
 *   so the writer is injected, which is also what makes this testable in memory.
 * @param {() => Promise<any>} [options.importKokoro] injectable for tests
 * @param {() => Promise<any>} [options.importTransformers] injectable for tests
 * @param {string} [options.nodeVersion] injectable for tests
 * @returns {import('../ports.js').AudioRenderPort}
 */
export function createKokoroRenderer(options = {}) {
  const {
    model = DEFAULT_KOKORO_MODEL,
    dtype = DEFAULT_KOKORO_DTYPE,
    cacheDir = join(homedir(), '.cache', 'reveal-aloud', 'models'),
    onProgress = () => {},
    onWarning = (message) => console.warn(`  warning: ${message}`),
    write = async (path, data) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, data);
    },
    importKokoro = () => import('kokoro-js'),
    importTransformers = importTransformersAsKokoroSees,
    nodeVersion = process.versions.node
  } = options;

  let modelPromise = null;

  function checkNode() {
    const [major, minor] = nodeVersion.split('.').map(Number);
    if (major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)) return;
    throw new Error(
      `Kokoro export needs Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer (this is ${nodeVersion}).\n` +
        'Older versions cannot locate kokoro-js’s bundled voice files and fail with a confusing\n' +
        'path error. Upgrade Node, or export with --engine say instead.'
    );
  }

  async function probe() {
    checkNode();
    try {
      await importKokoro();
    } catch (error) {
      throw new Error(`${INSTALL_HINT}\n\n(${error.message})`);
    }
  }

  function load() {
    if (modelPromise) return modelPromise;

    modelPromise = (async () => {
      checkNode();

      // Must happen before from_pretrained: transformers.js reads env.cacheDir when it resolves
      // the model, and its default lives inside node_modules where a reinstall destroys it.
      // kokoro-js@1.2.1's own `env` exposes only wasmPaths, so this reaches past it.
      //
      // Never swallow a failure here. Caching into node_modules still *works*, so the only
      // symptom is a 310MB re-download after every reinstall — silence would make that
      // impossible to diagnose.
      try {
        const { env } = await importTransformers();
        if (!env) throw new Error('transformers.js exposed no env object');
        env.cacheDir = cacheDir;
      } catch (error) {
        onWarning(
          `Could not redirect the model cache to ${cacheDir} (${error.message}).\n` +
            'The model will be cached inside node_modules and lost on the next reinstall.'
        );
      }

      const { KokoroTTS } = await importKokoro();
      return KokoroTTS.from_pretrained(model, {
        dtype,
        device: 'cpu',
        progress_callback: (update) => {
          if (update && typeof update.loaded === 'number' && update.total) {
            onProgress({ file: update.file, loaded: update.loaded, total: update.total });
          }
        }
      });
    })();

    return modelPromise;
  }

  async function listVoices() {
    // Deliberately from our own roster rather than the model's, so `--list-voices` is instant
    // and does not trigger a 300MB download just to print 28 names.
    return KOKORO_VOICES.map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      gender: voice.gender,
      grade: voice.overallGrade,
      traits: voice.traits,
      default: voice.default
    }));
  }

  /**
   * @param {import('../ports.js').RenderJob} job
   * @returns {Promise<import('../ports.js').AudioFormat>}
   */
  async function render(job) {
    if (!job.chunks || job.chunks.length === 0) throw new Error('nothing to render');

    const voice = job.voice || DEFAULT_KOKORO_VOICE;
    if (!kokoroVoice(voice)) {
      // Caught here rather than in kokoro-js, which console.tables all 28 voices and throws.
      throw new Error(
        `"${voice}" is not a Kokoro voice. Did you mean ${suggestVoices(voice).join(', ')}?\n` +
          'Run --list-voices kokoro to see all 28, best first.'
      );
    }

    const tts = await load();
    const speed = Number(job.rate) > 0 ? Number(job.rate) : 1;

    // One generation per chunk. Kokoro truncates past ~510 phoneme tokens *silently* — the audio
    // simply stops mid-sentence — and our chunks are already sentence-sized, so this sidesteps
    // the limit entirely. Combining a slide into one call would risk losing its tail.
    const pieces = [];
    let sampleRate = null;
    for (const text of job.chunks) {
      const audio = await tts.generate(text, { voice, speed });
      sampleRate ??= audio.sampling_rate;
      pieces.push(audio.audio);
    }

    const gapFrames = msToFrames(job.gapSilenceMs, sampleRate);
    const leadFrames = msToFrames(job.leadSilenceMs, sampleRate);
    const tailFrames = msToFrames(job.tailSilenceMs, sampleRate);

    const speechFrames = pieces.reduce((n, piece) => n + piece.length, 0);
    const totalFrames =
      leadFrames + speechFrames + gapFrames * Math.max(0, pieces.length - 1) + tailFrames;

    const samples = new Float32Array(totalFrames);
    let offset = leadFrames;
    pieces.forEach((piece, index) => {
      if (index > 0) offset += gapFrames; // silence is already zeroes
      samples.set(piece, offset);
      offset += piece.length;
    });

    const pcm = floatToInt16(samples);
    const body = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const header = wavHeader({ sampleRate, channels: 1, bitsPerSample: 16, dataBytes: body.length });

    const file = new Uint8Array(header.length + body.length);
    file.set(header, 0);
    file.set(body, header.length);
    await write(job.outPath, file);

    return { sampleRate, channels: 1, bitsPerSample: 16 };
  }

  return { id: 'kokoro', probe, listVoices, render };
}

function msToFrames(ms, sampleRate) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? Math.round((value / 1000) * sampleRate) : 0;
}
