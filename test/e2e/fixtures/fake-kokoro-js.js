/**
 * A stand-in for the real `kokoro-js` package, used only by the Kokoro end-to-end test.
 *
 * This sandbox has no route to the real CDN, so the actual ~90MB neural model cannot be
 * downloaded here. What this file lets the test prove instead is everything *around* the
 * model: that the adapter's dynamic `import()` of a URL works in a real browser, that the blob
 * it gets back is real audio a real `<audio>` element decodes and plays to a real `ended`
 * event, and that the pipelining and epoch-guard logic behave correctly under real (not
 * simulated) async timing. Only the neural network itself is faked.
 */

window.__kokoro = { generateCalls: [], progressReports: [] };

/** A ~120ms silent, valid 16-bit PCM WAV file — small, decodable, and real. */
function silentWavBlob() {
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * 0.12);
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  // Samples are already zeroed by ArrayBuffer's default initialization — genuine silence.
  return new Blob([buffer], { type: 'audio/wav' });
}

class KokoroTTS {
  static async from_pretrained(modelId, options) {
    for (const loaded of [40, 100]) {
      options?.progress_callback?.({ loaded, total: 100 });
      window.__kokoro.progressReports.push({ loaded, total: 100 });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return new KokoroTTS();
  }

  list_voices() {
    return ['af_heart', 'am_adam'];
  }

  async generate(text, options) {
    window.__kokoro.generateCalls.push({ text, voice: options?.voice });
    await new Promise((resolve) => setTimeout(resolve, 15)); // a stand-in for real inference time
    return { toBlob: () => silentWavBlob() };
  }
}

export { KokoroTTS };
