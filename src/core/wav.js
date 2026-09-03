/**
 * PURE. Just enough RIFF/WAVE to measure, build and join the files the exporter writes.
 *
 * Reading the header ourselves rather than shelling out to `afinfo` or `ffprobe` keeps the
 * exporter dependency-free and exact: a duration is a division, not a parsed string from a tool
 * that may not be installed.
 *
 * Everything here works on plain `Uint8Array`s and returns plain numbers, so it is testable
 * without touching a filesystem or an audio device.
 */

const RIFF = 0x52494646; // 'RIFF'
const WAVE = 0x57415645; // 'WAVE'
const FMT = 0x666d7420; // 'fmt '
const DATA = 0x64617461; // 'data'

/** PCM. The only encoding we write, and the only one `say -o --data-format=LEI16` produces. */
const FORMAT_PCM = 1;
const FORMAT_IEEE_FLOAT = 3;

/**
 * Reads the format and duration out of a WAV file's leading bytes.
 *
 * The chunk walk matters. It is tempting to assume `data` starts at byte 44, and for a
 * hand-written header it does — but CoreAudio's writer, which is what `say -o` uses, emits a
 * `FLLR` (filler) chunk before `data` to page-align the audio. Assuming 44 there reads the
 * filler as samples and reports a wrong duration, or garbage.
 *
 * @param {Uint8Array} head the start of the file. 64KB is far more than enough; the header is
 *   normally under 4KB even with padding.
 * @param {number} [fileSize] total bytes on disk, used only when the `data` size field is
 *   unusable (a streamed writer that never went back to patch it)
 * @returns {{sampleRate: number, channels: number, bitsPerSample: number, audioFormat: number,
 *   byteRate: number, blockAlign: number, dataOffset: number, dataBytes: number,
 *   durationSec: number}|null} null when this is not a WAV at all
 */
export function readWavInfo(head, fileSize) {
  if (!(head instanceof Uint8Array) || head.length < 12) return null;

  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, false) !== RIFF) return null;
  if (view.getUint32(8, false) !== WAVE) return null;

  let fmt = null;
  let dataOffset = -1;
  let dataBytes = 0;

  // Chunks run back to back from byte 12: 4-byte id, 4-byte little-endian size, payload,
  // then a pad byte when the size is odd.
  let offset = 12;
  while (offset + 8 <= head.length) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;

    if (id === FMT && payload + 16 <= head.length) {
      fmt = {
        audioFormat: view.getUint16(payload, true),
        channels: view.getUint16(payload + 2, true),
        sampleRate: view.getUint32(payload + 4, true),
        byteRate: view.getUint32(payload + 8, true),
        blockAlign: view.getUint16(payload + 12, true),
        bitsPerSample: view.getUint16(payload + 14, true)
      };
    } else if (id === DATA) {
      dataOffset = payload;
      dataBytes = size;
      break; // the samples are the rest of the file; nothing after them concerns us
    }

    offset = payload + size + (size % 2); // pad to an even boundary
  }

  if (!fmt || dataOffset === -1) return null;

  if (Number.isFinite(fileSize)) {
    const available = Math.max(0, fileSize - dataOffset);
    // A writer that streamed without patching the size leaves 0 or -1 here.
    if (dataBytes === 0 || dataBytes === 0xffffffff) dataBytes = available;
    // A size larger than the file means the file is truncated — an export interrupted after the
    // header was written, say. Trusting the header there invents audio that is not present, and
    // anything concatenating this clip would place every later one too early.
    else dataBytes = Math.min(dataBytes, available);
  }

  const byteRate = fmt.byteRate || (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8;
  if (!byteRate) return null;

  return { ...fmt, byteRate, dataOffset, dataBytes, durationSec: dataBytes / byteRate };
}

/**
 * Builds the canonical 44-byte header for 16-bit PCM.
 *
 * Every size is known before a byte is written, so there is no seek-back — which is what lets
 * the concatenated master be streamed out rather than assembled in memory.
 *
 * @param {{sampleRate: number, channels?: number, bitsPerSample?: number, dataBytes: number}} spec
 * @returns {Uint8Array} exactly 44 bytes
 */
export function wavHeader({ sampleRate, channels = 1, bitsPerSample = 16, dataBytes }) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  view.setUint32(0, RIFF, false);
  view.setUint32(4, 36 + dataBytes, true); // everything after this field
  view.setUint32(8, WAVE, false);
  view.setUint32(12, FMT, false);
  view.setUint32(16, 16, true); // PCM fmt chunks are 16 bytes
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, DATA, false);
  view.setUint32(40, dataBytes, true);

  return header;
}

/**
 * Converts the float samples a neural model produces into the 16-bit PCM we write.
 *
 * Kokoro hands back a Float32Array, and its own `save()` writes a 32-bit float WAV. We convert
 * instead so every file the exporter produces has one format — which is what makes concatenating
 * them possible, and avoids float WAVs tripping up older editors.
 *
 * The asymmetric scaling is deliberate: int16 runs -32768..32767, so -1.0 and +1.0 both map to
 * full scale without clipping or a DC offset.
 *
 * @param {Float32Array|number[]} samples nominally -1..1; anything outside is clamped
 * @returns {Int16Array}
 */
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Finds where the speech actually starts and stops inside a rendered file.
 *
 * This is the number that makes hand-syncing tolerable. Even with no silence padding requested,
 * a synthesiser emits a little dead air at each end; reporting it means the presenter can trim
 * to the exact frame instead of hunting for the first waveform by eye.
 *
 * @param {Uint8Array} pcm the `data` payload
 * @param {{sampleRate: number, channels: number, bitsPerSample: number}} info
 * @param {{floor?: number, minRunMs?: number}} [opts] `floor` as a fraction of full scale;
 *   `minRunMs` is how long signal must persist to count, so a lone DC blip does not
 * @returns {{leadSec: number, tailSec: number, silent: boolean}} `silent` distinguishes a file
 *   with no signal at all from one that speaks edge to edge — both of which have zero lead and
 *   tail, but only one of which is a problem worth telling the presenter about
 */
export function measureSilence(pcm, info, opts = {}) {
  const { floor = 0.005, minRunMs = 5 } = opts;
  if (info.bitsPerSample !== 16) return { leadSec: 0, tailSec: 0, silent: false };

  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frames = Math.floor(pcm.byteLength / ((info.channels * info.bitsPerSample) / 8));
  const threshold = floor * 0x7fff;
  const minRun = Math.max(1, Math.round((minRunMs / 1000) * info.sampleRate));

  // Peak per frame across channels, so a signal in either one counts.
  const loud = (frame) => {
    for (let c = 0; c < info.channels; c++) {
      const sample = view.getInt16((frame * info.channels + c) * 2, true);
      if (Math.abs(sample) > threshold) return true;
    }
    return false;
  };

  const first = edgeOfSpeech(frames, loud, minRun, 1);
  if (first === -1) return { leadSec: 0, tailSec: 0, silent: true }; // nothing to trim to
  const last = edgeOfSpeech(frames, loud, minRun, -1);

  return {
    leadSec: first / info.sampleRate,
    tailSec: (frames - 1 - last) / info.sampleRate,
    silent: false
  };
}

/**
 * The outermost frame belonging to a sustained run of signal, scanning forwards (`step` 1) or
 * backwards (`step` -1).
 *
 * Requiring a run is what keeps a single DC-offset blip or a dither tick from being mistaken for
 * the start of speech. If no run is long enough — a clip shorter than `minRun`, say — the first
 * loud frame is still better than reporting silence, so that is the fallback.
 *
 * @returns {number} frame index, or -1 when nothing exceeded the threshold at all
 */
function edgeOfSpeech(frames, loud, minRun, step) {
  const start = step === 1 ? 0 : frames - 1;
  let firstLoud = -1;
  let run = 0;

  for (let i = start; i >= 0 && i < frames; i += step) {
    if (!loud(i)) {
      run = 0;
      continue;
    }
    if (run === 0 && firstLoud === -1) firstLoud = i;
    run++;
    if (run >= minRun) return i - step * (run - 1); // where this run began
  }

  return firstLoud;
}

/**
 * Whether two rendered files can be concatenated without resampling or re-encoding.
 * @param {{sampleRate: number, channels: number, bitsPerSample: number}} a
 * @param {{sampleRate: number, channels: number, bitsPerSample: number}} b
 */
export function sameFormat(a, b) {
  return (
    a.sampleRate === b.sampleRate &&
    a.channels === b.channels &&
    a.bitsPerSample === b.bitsPerSample
  );
}

/** @param {number} format */
export function describeFormat(format) {
  if (format === FORMAT_PCM) return 'pcm';
  if (format === FORMAT_IEEE_FLOAT) return 'float';
  return `unknown(${format})`;
}
