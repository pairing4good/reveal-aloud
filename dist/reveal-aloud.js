/*! reveal-aloud 0.1.0 | MIT | https://github.com/pairing4good/reveal-aloud#readme */
var RevealAloud = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    DEFAULTS: () => DEFAULTS,
    createPlugin: () => createPlugin,
    default: () => index_default
  });

  // src/core/brackets.js
  var ESCAPABLE = /* @__PURE__ */ new Set(["[", "]"]);
  function stripSilent(text) {
    if (typeof text !== "string" || text === "") return { text: "", unclosed: false };
    let out = "";
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\" && ESCAPABLE.has(text[i + 1])) {
        if (depth === 0) out += text[i + 1];
        i++;
        continue;
      }
      if (ch === "[") {
        depth++;
        continue;
      }
      if (ch === "]") {
        if (depth > 0) depth--;
        continue;
      }
      if (depth === 0) out += ch;
    }
    return { text: out, unclosed: depth > 0 };
  }

  // src/core/text.js
  var MARKDOWN_NOISE = /[`*]+/g;
  function blocksToText(blocks, options = {}) {
    const { speakCode = false } = options;
    if (!Array.isArray(blocks)) return "";
    const lines = [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.kind === "break") {
        lines.push("");
        continue;
      }
      if (block.kind === "code" && !speakCode) continue;
      if (typeof block.text === "string") lines.push(block.text);
    }
    return lines.join("\n");
  }
  function normalize(text) {
    if (typeof text !== "string" || text === "") return "";
    const lines = text.replace(/\r\n?/g, "\n").replace(/[\u00a0\u2007\u202f\u2009]/g, " ").replace(MARKDOWN_NOISE, "").split("\n").map(normalizeLine).filter((line) => line !== "");
    const result = lines.join("\n");
    return hasSpeakableContent(result) ? result : "";
  }
  function hasSpeakableContent(text) {
    return typeof text === "string" && /[\p{L}\p{N}]/u.test(text);
  }
  function normalizeLine(line) {
    return line.replace(/[\t ]+/g, " ").replace(/ +([,.;:!?…])/g, "$1").replace(/([,;:])(?: *[,;:])+/g, "$1").replace(/([.!?…]) *[,;:]+/g, "$1").replace(/^[\s,;:.!?…]+/, "").replace(/ {2,}/g, " ").trim();
  }

  // src/core/chunk.js
  var DEFAULT_MAX_CHARS = 180;
  var ABBREVIATIONS = /* @__PURE__ */ new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "sr",
    "jr",
    "st",
    "vs",
    "etc",
    "e.g",
    "i.e",
    "fig",
    "no",
    "inc",
    "ltd",
    "approx",
    "al",
    "ca"
  ]);
  function chunk(text, options = {}) {
    var _a;
    const maxChars = Math.max(1, (_a = options.maxChars) != null ? _a : DEFAULT_MAX_CHARS);
    if (typeof text !== "string" || text.trim() === "") return [];
    const chunks = [];
    for (const line of text.split("\n")) {
      for (const sentence of splitSentences(line)) {
        for (const piece of wrap(sentence, maxChars)) chunks.push(piece);
      }
    }
    return chunks;
  }
  function splitSentences(line) {
    const sentences = [];
    const terminator = /[.!?…]+(?=\s|$)/g;
    let start = 0;
    let match;
    while ((match = terminator.exec(line)) !== null) {
      const end = match.index + match[0].length;
      const candidate = line.slice(start, end);
      if (endsWithAbbreviation(candidate)) continue;
      sentences.push(candidate);
      start = end;
    }
    if (start < line.length) sentences.push(line.slice(start));
    return sentences.map((s) => s.trim()).filter((s) => s !== "");
  }
  function endsWithAbbreviation(candidate) {
    const trimmed = candidate.trimEnd();
    if (!trimmed.endsWith(".")) return false;
    const lastWord = trimmed.slice(0, -1).split(/\s/).pop().toLowerCase();
    return ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord);
  }
  function wrap(sentence, maxChars) {
    if (sentence.length <= maxChars) return [sentence];
    const pieces = [];
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars + 1);
      let cut = window.lastIndexOf(", ");
      if (cut > 0) {
        cut += 1;
      } else {
        cut = window.lastIndexOf(" ");
      }
      if (cut <= 0) cut = maxChars;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest !== "") pieces.push(rest);
    return pieces.filter((piece) => piece !== "");
  }

  // src/core/notes.js
  function toSpeech(blocks, options = {}) {
    const raw = blocksToText(blocks, options);
    const { text, unclosed } = stripSilent(raw);
    return {
      chunks: chunk(normalize(text), options),
      unclosedBracket: unclosed
    };
  }

  // src/core/narrator.js
  var Event = Object.freeze({
    TOGGLE_PRESSED: "TOGGLE_PRESSED",
    START_REQUESTED: "START_REQUESTED",
    STOP_REQUESTED: "STOP_REQUESTED",
    REPLAY_REQUESTED: "REPLAY_REQUESTED",
    SLIDE_ENTERED: "SLIDE_ENTERED",
    SPEECH_FINISHED: "SPEECH_FINISHED",
    SPEECH_FAILED: "SPEECH_FAILED",
    OVERVIEW_SHOWN: "OVERVIEW_SHOWN",
    OVERVIEW_HIDDEN: "OVERVIEW_HIDDEN",
    DECK_PAUSED: "DECK_PAUSED",
    DECK_RESUMED: "DECK_RESUMED",
    PAGE_HIDDEN: "PAGE_HIDDEN",
    PAGE_VISIBLE: "PAGE_VISIBLE",
    USER_GESTURE: "USER_GESTURE",
    SETTINGS_CHANGED: "SETTINGS_CHANGED"
  });
  var Command = Object.freeze({
    SPEAK: "SPEAK",
    STOP: "STOP",
    SHOW: "SHOW"
  });
  var Status = Object.freeze({
    OFF: "off",
    SPEAKING: "speaking",
    IDLE: "idle",
    NO_NOTES: "no-notes",
    BLOCKED: "blocked",
    WAITING_FOR_GESTURE: "waiting-for-gesture",
    FAILED: "failed"
  });
  var Suppression = Object.freeze({
    OVERVIEW: "overview",
    DECK_PAUSED: "deck-paused",
    PAGE_HIDDEN: "page-hidden"
  });
  var SUPPRESSED_BY = Object.freeze({
    [Event.OVERVIEW_SHOWN]: Suppression.OVERVIEW,
    [Event.DECK_PAUSED]: Suppression.DECK_PAUSED,
    [Event.PAGE_HIDDEN]: Suppression.PAGE_HIDDEN
  });
  var RELEASED_BY = Object.freeze({
    [Event.OVERVIEW_HIDDEN]: Suppression.OVERVIEW,
    [Event.DECK_RESUMED]: Suppression.DECK_PAUSED,
    [Event.PAGE_VISIBLE]: Suppression.PAGE_HIDDEN
  });
  var EMPTY_SLIDE = Object.freeze({ chunks: Object.freeze([]), unclosedBracket: false });
  function initialState(options = {}) {
    const { autoStart = false, requiresGesture = false, settings = {} } = options;
    return {
      on: Boolean(autoStart),
      speaking: false,
      epoch: 0,
      suppressedBy: [],
      // Browsers refuse to speak before the page has been interacted with, so an auto-started
      // deck waits for the first keypress or click rather than appearing broken.
      needsGesture: Boolean(autoStart && requiresGesture),
      blocks: [],
      slide: EMPTY_SLIDE,
      settings: { ...settings }
    };
  }
  function reduce(state, event) {
    var _a, _b;
    const type = event == null ? void 0 : event.type;
    switch (type) {
      case Event.TOGGLE_PRESSED:
        return state.on ? switchOff(state) : switchOn(state);
      case Event.START_REQUESTED:
        return state.on ? unchanged(state) : switchOn(state);
      case Event.STOP_REQUESTED:
        return state.on ? switchOff(state) : unchanged(state);
      case Event.REPLAY_REQUESTED:
        return restart({ ...state, on: true, needsGesture: false });
      case Event.SLIDE_ENTERED: {
        const blocks = (_a = event.blocks) != null ? _a : [];
        return restart({
          ...state,
          blocks,
          slide: toSpeech(blocks, state.settings)
        });
      }
      case Event.SPEECH_FINISHED:
        if (isStale(state, event)) return unchanged(state);
        return {
          state: { ...state, speaking: false, epoch: state.epoch + 1 },
          commands: [show(Status.IDLE)]
        };
      case Event.SPEECH_FAILED:
        if (isStale(state, event)) return unchanged(state);
        return {
          state: { ...state, speaking: false, epoch: state.epoch + 1 },
          commands: [show(Status.FAILED, { error: event.error })]
        };
      case Event.OVERVIEW_SHOWN:
      case Event.DECK_PAUSED:
      case Event.PAGE_HIDDEN:
        return suppress(state, SUPPRESSED_BY[type]);
      case Event.OVERVIEW_HIDDEN:
      case Event.DECK_RESUMED:
      case Event.PAGE_VISIBLE:
        return release(state, RELEASED_BY[type]);
      case Event.USER_GESTURE:
        if (!state.needsGesture) return unchanged(state);
        return restart({ ...state, needsGesture: false });
      case Event.SETTINGS_CHANGED: {
        const settings = { ...state.settings, ...(_b = event.settings) != null ? _b : {} };
        const next = { ...state, settings, slide: toSpeech(state.blocks, settings) };
        return state.speaking ? restart(next) : unchanged(next);
      }
      default:
        return unchanged(state);
    }
  }
  function isOn(state) {
    return state.on === true;
  }
  function switchOn(state) {
    return restart({ ...state, on: true, needsGesture: false });
  }
  function switchOff(state) {
    const { state: halted, commands } = halt({ ...state, on: false });
    return { state: halted, commands: [...commands, show(Status.OFF)] };
  }
  function restart(state) {
    const { state: quiet, commands } = halt(state);
    if (!quiet.on) return { state: quiet, commands: [...commands, show(Status.OFF)] };
    if (quiet.needsGesture) {
      return { state: quiet, commands: [...commands, show(Status.WAITING_FOR_GESTURE)] };
    }
    if (quiet.suppressedBy.length > 0) {
      return { state: quiet, commands: [...commands, show(Status.BLOCKED)] };
    }
    if (quiet.slide.chunks.length === 0) {
      return {
        state: quiet,
        commands: [...commands, show(Status.NO_NOTES, detailOf(quiet))]
      };
    }
    const epoch = quiet.epoch + 1;
    return {
      state: { ...quiet, epoch, speaking: true },
      commands: [
        ...commands,
        { type: Command.SPEAK, epoch, chunks: quiet.slide.chunks, settings: quiet.settings },
        show(Status.SPEAKING, detailOf(quiet))
      ]
    };
  }
  function halt(state) {
    if (!state.speaking) return { state, commands: [] };
    return {
      state: { ...state, speaking: false, epoch: state.epoch + 1 },
      commands: [{ type: Command.STOP }]
    };
  }
  function suppress(state, reason) {
    if (state.suppressedBy.includes(reason)) return unchanged(state);
    const suppressedBy = [...state.suppressedBy, reason];
    const { state: quiet, commands } = halt({ ...state, suppressedBy });
    return {
      state: quiet,
      commands: quiet.on ? [...commands, show(Status.BLOCKED)] : commands
    };
  }
  function release(state, reason) {
    if (!state.suppressedBy.includes(reason)) return unchanged(state);
    const suppressedBy = state.suppressedBy.filter((r) => r !== reason);
    const next = { ...state, suppressedBy };
    return suppressedBy.length > 0 ? unchanged(next) : restart(next);
  }
  function isStale(state, event) {
    return event.epoch !== state.epoch || !state.speaking;
  }
  function show(status, detail) {
    return detail ? { type: Command.SHOW, status, detail } : { type: Command.SHOW, status };
  }
  function detailOf(state) {
    return state.slide.unclosedBracket ? { unclosedBracket: true } : void 0;
  }
  function unchanged(state) {
    return { state, commands: [] };
  }

  // src/core/voice.js
  function pickVoice(voices, preference = {}) {
    var _a;
    const available = Array.isArray(voices) ? voices.filter(isVoice) : [];
    if (available.length === 0) return { voice: null, warning: "no-voices" };
    const { name, lang } = preference;
    if (typeof name === "string" && name.trim() !== "") {
      const wanted = name.trim().toLowerCase();
      const exact = available.filter((v) => v.name.toLowerCase() === wanted);
      const partial = available.filter((v) => v.name.toLowerCase().includes(wanted));
      const match = (_a = preferLanguage(exact, lang)) != null ? _a : preferLanguage(partial, lang);
      if (match) return { voice: match, warning: null };
      return { voice: fallback(available, lang), warning: "voice-not-found" };
    }
    return { voice: fallback(available, lang), warning: null };
  }
  function fallback(available, lang) {
    var _a, _b;
    return (_b = (_a = preferLanguage(available, lang)) != null ? _a : available.find((v) => v.default === true)) != null ? _b : available[0];
  }
  function preferLanguage(candidates, lang) {
    var _a, _b;
    if (candidates.length === 0) return null;
    if (typeof lang !== "string" || lang === "") return candidates[0];
    const wanted = lang.toLowerCase();
    const base = wanted.split("-")[0];
    return (_b = (_a = candidates.find((v) => {
      var _a2;
      return ((_a2 = v.lang) != null ? _a2 : "").toLowerCase() === wanted;
    })) != null ? _a : candidates.find((v) => {
      var _a2;
      return ((_a2 = v.lang) != null ? _a2 : "").toLowerCase().split("-")[0] === base;
    })) != null ? _b : candidates[0];
  }
  function isVoice(voice) {
    return Boolean(voice) && typeof voice.name === "string";
  }

  // src/adapters/web-speech.js
  function createWebSpeech(options = {}) {
    var _a, _b;
    const synth = (_a = options.synth) != null ? _a : globalThis.speechSynthesis;
    const Utterance = (_b = options.Utterance) != null ? _b : globalThis.SpeechSynthesisUtterance;
    let liveEpoch = null;
    function speak(request, handlers) {
      const { chunks, epoch, settings = {} } = request;
      liveEpoch = epoch;
      if (synth.paused) synth.resume();
      const { voice } = resolveVoice(settings);
      let index = 0;
      const next = () => {
        if (liveEpoch !== epoch) return;
        if (index >= chunks.length) {
          liveEpoch = null;
          handlers.onFinished(epoch);
          return;
        }
        const utterance = new Utterance(chunks[index++]);
        if (voice) utterance.voice = voice;
        if (settings.lang) utterance.lang = settings.lang;
        if (typeof settings.rate === "number") utterance.rate = settings.rate;
        if (typeof settings.pitch === "number") utterance.pitch = settings.pitch;
        if (typeof settings.volume === "number") utterance.volume = settings.volume;
        utterance.onend = () => next();
        utterance.onerror = (event) => {
          var _a2;
          if (liveEpoch !== epoch) return;
          if (isExpectedInterruption(event)) return;
          liveEpoch = null;
          handlers.onFailed(epoch, (_a2 = event == null ? void 0 : event.error) != null ? _a2 : "speech-failed");
        };
        synth.speak(utterance);
      };
      next();
    }
    function stop() {
      liveEpoch = null;
      synth.cancel();
    }
    function listVoices2() {
      var _a2, _b2;
      const voices = (_b2 = (_a2 = synth.getVoices) == null ? void 0 : _a2.call(synth)) != null ? _b2 : [];
      return Array.from(voices);
    }
    function resolveVoice(settings = {}) {
      return pickVoice(listVoices2(), { name: settings.voice, lang: settings.lang });
    }
    function onVoicesChanged(listener) {
      if (typeof synth.addEventListener !== "function") return () => {
      };
      synth.addEventListener("voiceschanged", listener);
      return () => synth.removeEventListener("voiceschanged", listener);
    }
    return { speak, stop, listVoices: listVoices2, resolveVoice, onVoicesChanged };
  }
  function isSpeechSupported(scope = globalThis) {
    return Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
  }
  function isExpectedInterruption(event) {
    return (event == null ? void 0 : event.error) === "interrupted" || (event == null ? void 0 : event.error) === "canceled";
  }

  // src/adapters/kokoro-speech.js
  var DEFAULT_MODULE_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
  var DEFAULT_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
  var KNOWN_VOICES = [
    ["af_heart", "en-US"],
    ["af_bella", "en-US"],
    ["af_nicole", "en-US"],
    ["af_aoede", "en-US"],
    ["af_kore", "en-US"],
    ["af_sarah", "en-US"],
    ["af_nova", "en-US"],
    ["af_sky", "en-US"],
    ["af_alloy", "en-US"],
    ["af_jessica", "en-US"],
    ["af_river", "en-US"],
    ["am_adam", "en-US"],
    ["am_echo", "en-US"],
    ["am_eric", "en-US"],
    ["am_fenrir", "en-US"],
    ["am_liam", "en-US"],
    ["am_michael", "en-US"],
    ["am_onyx", "en-US"],
    ["am_puck", "en-US"],
    ["bf_alice", "en-GB"],
    ["bf_emma", "en-GB"],
    ["bf_isabella", "en-GB"],
    ["bf_lily", "en-GB"],
    ["bm_daniel", "en-GB"],
    ["bm_fable", "en-GB"],
    ["bm_george", "en-GB"],
    ["bm_lewis", "en-GB"]
  ].map(([name, lang]) => ({ name, lang, default: name === "af_heart" }));
  function createKokoroSpeech(options = {}) {
    const {
      moduleUrl = DEFAULT_MODULE_URL,
      modelId = DEFAULT_MODEL_ID,
      dtype = "q8",
      device = "wasm",
      onProgress = () => {
      },
      importModule = (url) => import(
        /* webpackIgnore: true */
        url
      ),
      audioFactory = () => new Audio()
    } = options;
    let modelPromise = null;
    let liveVoices = null;
    let liveEpoch = null;
    let activePlayback = null;
    function loadModel() {
      if (modelPromise) return modelPromise;
      modelPromise = importModule(moduleUrl).then(
        ({ KokoroTTS }) => KokoroTTS.from_pretrained(modelId, {
          dtype,
          device,
          progress_callback: (update) => {
            if (update && typeof update.loaded === "number" && update.total) {
              onProgress({ loaded: update.loaded, total: update.total });
            }
          }
        })
      ).then((tts) => {
        if (typeof tts.list_voices === "function") {
          const names = tts.list_voices();
          if (Array.isArray(names) && names.length > 0) {
            liveVoices = names.map((name) => voiceMetaFor(name));
          }
        }
        return tts;
      });
      return modelPromise;
    }
    async function speak(request, handlers) {
      const { chunks, epoch, settings = {} } = request;
      liveEpoch = epoch;
      let tts;
      try {
        tts = await loadModel();
      } catch (error) {
        if (liveEpoch !== epoch) return;
        liveEpoch = null;
        handlers.onFailed(epoch, describeError(error, "kokoro-load-failed"));
        return;
      }
      if (liveEpoch !== epoch) return;
      const { voice } = resolveVoice(settings);
      const voiceId = voice ? voice.name : void 0;
      try {
        let pending = generate(tts, chunks[0], voiceId);
        for (let i = 0; i < chunks.length; i++) {
          const blob = await pending;
          if (liveEpoch !== epoch) return;
          pending = i + 1 < chunks.length ? generate(tts, chunks[i + 1], voiceId) : null;
          await play(blob, epoch, settings);
          if (liveEpoch !== epoch) return;
        }
      } catch (error) {
        if (liveEpoch !== epoch) return;
        liveEpoch = null;
        handlers.onFailed(epoch, describeError(error, "kokoro-speech-failed"));
        return;
      }
      if (liveEpoch === epoch) {
        liveEpoch = null;
        handlers.onFinished(epoch);
      }
    }
    async function generate(tts, text, voiceId) {
      const audio = await tts.generate(text, voiceId ? { voice: voiceId } : void 0);
      return audio.toBlob();
    }
    function play(blob, epoch, settings) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const el = audioFactory();
        el.src = url;
        if (typeof settings.rate === "number") el.playbackRate = settings.rate;
        if (typeof settings.volume === "number") el.volume = settings.volume;
        const finish = (fn, value) => {
          if ((activePlayback == null ? void 0 : activePlayback.el) === el) activePlayback = null;
          URL.revokeObjectURL(url);
          el.onended = null;
          el.onerror = null;
          fn(value);
        };
        el.onended = () => finish(resolve);
        el.onerror = () => finish(reject, new Error("kokoro-audio-playback-failed"));
        activePlayback = { el, settle: () => finish(resolve) };
        const played = el.play();
        if (played == null ? void 0 : played.catch) played.catch((error) => finish(reject, error));
        if (liveEpoch !== epoch) activePlayback == null ? void 0 : activePlayback.settle();
      });
    }
    function stop() {
      liveEpoch = null;
      if (activePlayback) {
        activePlayback.el.pause();
        activePlayback.settle();
      }
    }
    function listVoices2() {
      return liveVoices != null ? liveVoices : KNOWN_VOICES;
    }
    function resolveVoice(settings = {}) {
      return pickVoice(listVoices2(), { name: settings.voice, lang: settings.lang });
    }
    function onVoicesChanged(_listener) {
      return () => {
      };
    }
    return {
      speak,
      stop,
      listVoices: listVoices2,
      resolveVoice,
      onVoicesChanged,
      /** Starts the model download ahead of the first `speak()`, e.g. from a "load now" button. */
      preload: loadModel
    };
  }
  function voiceMetaFor(name) {
    const known = KNOWN_VOICES.find((v) => v.name === name);
    if (known) return known;
    const lang = { a: "en-US", b: "en-GB", j: "ja-JP", z: "zh-CN", e: "es-ES", f: "fr-FR", h: "hi-IN", i: "it-IT", p: "pt-BR" }[name[0]];
    return { name, lang };
  }
  function describeError(error, fallback2) {
    return error instanceof Error ? error.message : fallback2;
  }
  function isKokoroSupported(scope = globalThis) {
    return typeof scope.WebAssembly === "object" && typeof scope.Audio === "function";
  }

  // src/adapters/say-speech.js
  var DEFAULT_SERVER_URL = "http://127.0.0.1:5757";
  var DEFAULT_LEAD_SILENCE_MS = 700;
  var DEFAULT_TAIL_SILENCE_MS = 700;
  var DEFAULT_GAP_SILENCE_MS = 300;
  function createSaySpeech(options = {}) {
    const {
      serverUrl = DEFAULT_SERVER_URL,
      fetchImpl = fetch,
      leadSilenceMs = DEFAULT_LEAD_SILENCE_MS,
      tailSilenceMs = DEFAULT_TAIL_SILENCE_MS,
      gapSilenceMs = DEFAULT_GAP_SILENCE_MS
    } = options;
    let liveVoices = null;
    const voicesListeners = /* @__PURE__ */ new Set();
    fetchImpl(`${serverUrl}/voices`).then((res) => res.ok ? res.json() : null).then((voices) => {
      if (!Array.isArray(voices)) return;
      liveVoices = voices;
      for (const listener of voicesListeners) listener();
    }).catch(() => {
    });
    let liveEpoch = null;
    let abortController = null;
    async function speak(request, handlers) {
      const { chunks, epoch, settings = {} } = request;
      liveEpoch = epoch;
      if (chunks.length === 0) {
        liveEpoch = null;
        handlers.onFinished(epoch);
        return;
      }
      const { voice } = resolveVoice(settings);
      const voiceName = voice ? voice.name : "";
      const joined = `[[slnc ${leadSilenceMs}]] ` + chunks.join(` [[slnc ${gapSilenceMs}]] `) + ` [[slnc ${tailSilenceMs}]]`;
      abortController = new AbortController();
      let response;
      try {
        response = await fetchImpl(`${serverUrl}/speak`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: joined, voice: voiceName, rate: settings.rate }),
          signal: abortController.signal
        });
      } catch (error) {
        if ((error == null ? void 0 : error.name) === "AbortError") return;
        if (liveEpoch !== epoch) return;
        liveEpoch = null;
        handlers.onFailed(epoch, unreachableMessage(serverUrl));
        return;
      }
      if (liveEpoch !== epoch) return;
      if (!response.ok) {
        liveEpoch = null;
        handlers.onFailed(epoch, await describeFailure(response));
        return;
      }
      if (liveEpoch === epoch) {
        liveEpoch = null;
        handlers.onFinished(epoch);
      }
    }
    function stop() {
      liveEpoch = null;
      abortController == null ? void 0 : abortController.abort();
      fetchImpl(`${serverUrl}/stop`, { method: "POST" }).catch(() => {
      });
    }
    function listVoices2() {
      return liveVoices != null ? liveVoices : [{ name: "system-default", lang: "", default: true }];
    }
    function resolveVoice(settings = {}) {
      return pickVoice(listVoices2(), { name: settings.voice, lang: settings.lang });
    }
    function onVoicesChanged(listener) {
      voicesListeners.add(listener);
      return () => voicesListeners.delete(listener);
    }
    return { speak, stop, listVoices: listVoices2, resolveVoice, onVoicesChanged };
  }
  async function describeFailure(response) {
    try {
      const body = await response.json();
      if (body == null ? void 0 : body.error) return body.error;
    } catch {
    }
    return `say-server responded with ${response.status}`;
  }
  function unreachableMessage(serverUrl) {
    return `Could not reach the say-server at ${serverUrl}. Run "node bin/say-server.js" first.`;
  }

  // src/adapters/reveal-deck.js
  var TEXT_NODE = 3;
  var ELEMENT_NODE = 1;
  var CODE_TAGS = /* @__PURE__ */ new Set(["PRE", "CODE", "SAMP", "KBD", "VAR"]);
  var BLOCK_TAGS = /* @__PURE__ */ new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "BLOCKQUOTE",
    "FIGURE",
    "FIGCAPTION",
    "UL",
    "OL",
    "LI",
    "DL",
    "DT",
    "DD",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR"
  ]);
  function slideToBlocks(slide) {
    if (!slide || slide.nodeType !== ELEMENT_NODE) return [];
    if (slide.hasAttribute("data-notes")) {
      return tidy([{ kind: "text", text: unwrap(slide.getAttribute("data-notes")) }]);
    }
    const asides = Array.from(slide.querySelectorAll("aside.notes")).filter(
      // A vertical stack must not inherit its children's notes, and fragment notes wait.
      (aside) => aside.closest("section") === slide && !aside.closest(".fragment")
    );
    const blocks = [];
    asides.forEach((aside, index) => {
      if (index > 0) pushBreak(blocks);
      appendChildren(aside, blocks);
    });
    return tidy(blocks);
  }
  function appendChildren(node, blocks) {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        pushText(blocks, child.nodeValue);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();
      if (CODE_TAGS.has(tag)) {
        pushBreak(blocks);
        blocks.push({ kind: "code", text: child.textContent });
        pushBreak(blocks);
        continue;
      }
      if (tag === "BR") {
        pushBreak(blocks);
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        pushBreak(blocks);
        appendChildren(child, blocks);
        pushBreak(blocks);
        continue;
      }
      appendChildren(child, blocks);
    }
  }
  function pushText(blocks, text) {
    const unwrapped = unwrap(text);
    if (!unwrapped) return;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "text") last.text += unwrapped;
    else blocks.push({ kind: "text", text: unwrapped });
  }
  function unwrap(text) {
    return typeof text === "string" ? text.replace(/\s*\n\s*/g, " ") : "";
  }
  function pushBreak(blocks) {
    const last = blocks[blocks.length - 1];
    if (!last || last.kind === "break") return;
    blocks.push({ kind: "break" });
  }
  function tidy(blocks) {
    const kept = blocks.filter(
      (block) => block.kind !== "text" || block.text.trim() !== ""
    );
    while (kept.length > 0 && kept[kept.length - 1].kind === "break") kept.pop();
    return kept;
  }
  function createDeckAdapter({ deck, dispatch, config, onUnload, scope = globalThis }) {
    const teardown = [];
    const currentBlocks = () => {
      var _a, _b;
      return slideToBlocks((_b = (_a = deck.getCurrentSlide) == null ? void 0 : _a.call(deck)) != null ? _b : null);
    };
    const enter = () => dispatch({ type: Event.SLIDE_ENTERED, blocks: currentBlocks() });
    function on(target, name, handler) {
      target.addEventListener(name, handler);
      teardown.push(() => target.removeEventListener(name, handler));
    }
    function listen() {
      deck.on("ready", enter);
      deck.on("slidechanged", enter);
      deck.on("overviewshown", () => dispatch({ type: Event.OVERVIEW_SHOWN }));
      deck.on("overviewhidden", () => dispatch({ type: Event.OVERVIEW_HIDDEN }));
      deck.on("paused", () => dispatch({ type: Event.DECK_PAUSED }));
      deck.on("resumed", () => dispatch({ type: Event.DECK_RESUMED }));
      deck.addKeyBinding(
        {
          keyCode: config.key.toUpperCase().charCodeAt(0),
          key: config.key.toUpperCase(),
          description: "Toggle narration (read speaker notes aloud)"
        },
        () => dispatch({ type: Event.TOGGLE_PRESSED })
      );
      if (config.pauseWhenHidden && scope.document) {
        on(scope.document, "visibilitychange", () => {
          dispatch({
            type: scope.document.hidden ? Event.PAGE_HIDDEN : Event.PAGE_VISIBLE
          });
        });
      }
      on(scope, "beforeunload", onUnload);
      on(scope, "pagehide", onUnload);
    }
    function armGesture() {
      const fire = () => {
        release2();
        dispatch({ type: Event.USER_GESTURE });
      };
      const release2 = () => {
        scope.removeEventListener("keydown", fire);
        scope.removeEventListener("pointerdown", fire);
      };
      scope.addEventListener("keydown", fire, { once: true });
      scope.addEventListener("pointerdown", fire, { once: true });
      teardown.push(release2);
    }
    function destroy() {
      while (teardown.length > 0) teardown.pop()();
    }
    return { listen, currentBlocks, armGesture, destroy };
  }
  function isPrintView(deck, scope = globalThis) {
    var _a, _b;
    if (typeof (deck == null ? void 0 : deck.isPrintingPDF) === "function" && deck.isPrintingPDF()) return true;
    return /print-pdf/gi.test((_b = (_a = scope.location) == null ? void 0 : _a.search) != null ? _b : "");
  }

  // src/adapters/dom-indicator.js
  var STYLE_ID = "reveal-aloud-style";
  var LABELS = {
    [Status.OFF]: { icon: "\u{1F507}", text: "Narration off" },
    [Status.SPEAKING]: { icon: "\u{1F50A}", text: "Reading notes" },
    [Status.IDLE]: { icon: "\u{1F508}", text: "Narration on" },
    [Status.NO_NOTES]: { icon: "\u{1F508}", text: "No notes on this slide" },
    [Status.BLOCKED]: { icon: "\u23F8", text: "Narration paused" },
    [Status.WAITING_FOR_GESTURE]: { icon: "\u{1F446}", text: "Press any key to start narration" },
    [Status.FAILED]: { icon: "\u26A0\uFE0F", text: "Speech failed" }
  };
  var CSS = `
.reveal-aloud-indicator {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 60;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(20, 20, 20, 0.82);
  color: #fff;
  font: 500 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  pointer-events: none;
  opacity: 0;
  transition: opacity 220ms ease;
}
.reveal-aloud-indicator[data-visible="true"] { opacity: 0.9; }
.reveal-aloud-indicator[data-status="failed"] { background: rgba(150, 30, 30, 0.9); }
.reveal-aloud-indicator__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #7ee787;
  animation: reveal-aloud-pulse 1.4s ease-in-out infinite;
}
.reveal-aloud-indicator:not([data-status="speaking"]) .reveal-aloud-indicator__pulse {
  display: none;
}
@keyframes reveal-aloud-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  .reveal-aloud-indicator__pulse { animation: none; opacity: 1; }
  .reveal-aloud-indicator { transition: none; }
}
@media print { .reveal-aloud-indicator { display: none !important; } }
.reveal-aloud-indicator[data-fullscreen="true"] { opacity: 0 !important; }

.reveal-aloud-warning {
  position: fixed;
  right: 12px;
  bottom: 52px;
  z-index: 60;
  max-width: min(460px, calc(100vw - 24px));
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(146, 64, 14, 0.94);
  color: #fff;
  font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  pointer-events: none;
  opacity: 0;
  transition: opacity 220ms ease;
}
.reveal-aloud-warning[data-visible="true"] { opacity: 0.95; }
@media (prefers-reduced-motion: reduce) { .reveal-aloud-warning { transition: none; } }
@media print { .reveal-aloud-warning { display: none !important; } }

.reveal-aloud-progress {
  position: fixed;
  right: 12px;
  bottom: 52px;
  z-index: 60;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(30, 58, 138, 0.94);
  color: #fff;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  pointer-events: none;
  opacity: 0;
  transition: opacity 220ms ease;
}
.reveal-aloud-progress[data-visible="true"] { opacity: 0.95; }
@media (prefers-reduced-motion: reduce) { .reveal-aloud-progress { transition: none; } }
@media print { .reveal-aloud-progress { display: none !important; } }
`;
  function createDomIndicator(options = {}) {
    var _a, _b, _c, _d;
    const doc = (_a = options.doc) != null ? _a : globalThis.document;
    const timers = (_b = options.timers) != null ? _b : globalThis;
    const hideAfterMs = (_c = options.hideAfterMs) != null ? _c : 2600;
    const warnAfterMs = (_d = options.warnAfterMs) != null ? _d : 12e3;
    injectStyle(doc);
    const el = doc.createElement("div");
    el.className = "reveal-aloud-indicator";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<span class="reveal-aloud-indicator__icon"></span><span class="reveal-aloud-indicator__pulse"></span><span class="reveal-aloud-indicator__text"></span>';
    doc.body.appendChild(el);
    const onFullscreenChange = () => {
      el.dataset.fullscreen = doc.fullscreenElement || doc.webkitFullscreenElement ? "true" : "false";
    };
    doc.addEventListener("fullscreenchange", onFullscreenChange);
    doc.addEventListener("webkitfullscreenchange", onFullscreenChange);
    let hideTimer = null;
    let warningEl = null;
    let warningTimer = null;
    let progressEl = null;
    function warn(message) {
      if (warningEl === null) {
        warningEl = doc.createElement("div");
        warningEl.className = "reveal-aloud-warning";
        warningEl.setAttribute("aria-hidden", "true");
        doc.body.appendChild(warningEl);
      }
      warningEl.textContent = message;
      warningEl.dataset.visible = "true";
      if (warningTimer !== null) timers.clearTimeout(warningTimer);
      warningTimer = timers.setTimeout(() => {
        warningEl.dataset.visible = "false";
      }, warnAfterMs);
    }
    function progress(text, done = false) {
      if (progressEl === null) {
        progressEl = doc.createElement("div");
        progressEl.className = "reveal-aloud-progress";
        progressEl.setAttribute("aria-hidden", "true");
        doc.body.appendChild(progressEl);
      }
      progressEl.textContent = text;
      progressEl.dataset.visible = done ? "false" : "true";
    }
    function show2(status, detail = {}) {
      var _a2;
      const label = (_a2 = LABELS[status]) != null ? _a2 : LABELS[Status.IDLE];
      const suffix = detail.unclosedBracket ? " \xB7 unclosed \u201C[\u201D in notes" : "";
      el.dataset.status = status;
      el.dataset.visible = "true";
      el.querySelector(".reveal-aloud-indicator__icon").textContent = label.icon;
      el.querySelector(".reveal-aloud-indicator__text").textContent = label.text + suffix;
      if (hideTimer !== null) timers.clearTimeout(hideTimer);
      if (status === Status.SPEAKING || status === Status.WAITING_FOR_GESTURE) return;
      hideTimer = timers.setTimeout(() => {
        el.dataset.visible = "false";
      }, hideAfterMs);
    }
    function destroy() {
      if (hideTimer !== null) timers.clearTimeout(hideTimer);
      if (warningTimer !== null) timers.clearTimeout(warningTimer);
      warningEl == null ? void 0 : warningEl.remove();
      progressEl == null ? void 0 : progressEl.remove();
      el.remove();
    }
    return { show: show2, warn, progress, destroy };
  }
  function createNullIndicator() {
    return { show() {
    }, warn() {
    }, progress() {
    }, destroy() {
    } };
  }
  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  // src/adapters/browser-clock.js
  function createBrowserClock(timers = globalThis) {
    let pending = null;
    return {
      delay(ms, fn) {
        if (pending !== null) timers.clearTimeout(pending);
        pending = timers.setTimeout(() => {
          pending = null;
          fn();
        }, ms);
      },
      cancel() {
        if (pending === null) return;
        timers.clearTimeout(pending);
        pending = null;
      }
    };
  }

  // src/app/plugin.js
  var DEFAULTS = Object.freeze({
    /**
     * Which engine speaks the notes.
     *   'webspeech' — the operating system's built-in voices. Free, instant, no download.
     *   'kokoro'    — an open-weights model that runs in the browser, sounds far less robotic,
     *                 and is also free — at the cost of a one-time model download (tens of MB)
     *                 and a short per-sentence generation delay. See demo/voices.html to compare.
     *   'say'       — a voice already installed on the presenter's Mac, including a Siri voice
     *                 that no browser can ever reach on its own. Needs `node bin/say-server.js`
     *                 running alongside the deck. See the README.
     */
    engine: "webspeech",
    /** Voice name. For 'webspeech' this is whatever the OS reports; for 'kokoro' it is an id
     *  like 'af_bella' — run RevealAloud.listVoices() after switching engines to see the list. */
    voice: "",
    lang: "",
    /** Speaking speed: 1 is normal, 0.5 half speed, 2 double. */
    rate: 1,
    pitch: 1,
    volume: 1,
    /** kokoro only: where to load the `kokoro-js` library from. */
    kokoroModuleUrl: "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm",
    /** kokoro only: which model to fetch. */
    kokoroModel: "onnx-community/Kokoro-82M-v1.0-ONNX",
    /** kokoro only: smaller downloads faster with no noticeable quality loss at 'q8'. */
    kokoroDtype: "q8",
    /** kokoro only: 'webgpu' is faster where supported; 'wasm' works everywhere. */
    kokoroDevice: "wasm",
    /** say only: where `bin/say-server.js` is listening. */
    sayServerUrl: "http://127.0.0.1:5757",
    /** Start narrating as soon as the deck loads (after the first keypress or click). */
    autoStart: false,
    /** The shortcut that turns narration on and off. */
    key: "R",
    /** Stop narrating while the tab is in the background. */
    pauseWhenHidden: true,
    /** Read `<code>` and `<pre>` inside notes. Off: symbols rarely read well. */
    speakCode: false,
    /** Longest utterance handed to the engine; Chrome truncates long ones. */
    maxChars: 180,
    /** Show the status badge in the corner. */
    indicator: true,
    /** Wait this long before starting, so holding an arrow key does not stutter. */
    startDelayMs: 120
  });
  function createPlugin(overrides = {}) {
    var _a;
    const scope = (_a = overrides.scope) != null ? _a : globalThis;
    let state;
    let speech;
    let clock;
    let indicator;
    let deckAdapter;
    let config = { ...DEFAULTS };
    function dispatch(event) {
      const result = reduce(state, event);
      state = result.state;
      for (const command of result.commands) run(command);
    }
    function run(command) {
      switch (command.type) {
        case Command.STOP:
          clock.cancel();
          speech.stop();
          break;
        case Command.SPEAK:
          clock.delay(config.startDelayMs, () => speech.speak(command, handlers));
          break;
        case Command.SHOW:
          indicator.show(command.status, command.detail);
          break;
      }
    }
    function applySettings(settings) {
      config = { ...config, ...settings };
      dispatch({ type: Event.SETTINGS_CHANGED, settings });
      if ("voice" in settings || "lang" in settings) warnIfVoiceMissing();
    }
    const handlers = {
      onFinished: (epoch) => dispatch({ type: Event.SPEECH_FINISHED, epoch }),
      onFailed: (epoch, error) => dispatch({ type: Event.SPEECH_FAILED, epoch, error })
    };
    function settingsFrom(cfg) {
      return {
        voice: cfg.voice,
        lang: cfg.lang,
        rate: cfg.rate,
        pitch: cfg.pitch,
        volume: cfg.volume,
        speakCode: cfg.speakCode,
        maxChars: cfg.maxChars
      };
    }
    function createSpeech() {
      var _a2, _b;
      if (config.engine === "say") {
        return createSaySpeech({ serverUrl: config.sayServerUrl });
      }
      if (config.engine === "kokoro") {
        if (!isKokoroSupported(scope)) {
          (_a2 = scope.console) == null ? void 0 : _a2.warn(
            "[reveal-aloud] This browser cannot run Kokoro (no WebAssembly); narration is off."
          );
          return null;
        }
        return createKokoroSpeech({
          moduleUrl: config.kokoroModuleUrl,
          modelId: config.kokoroModel,
          dtype: config.kokoroDtype,
          device: config.kokoroDevice,
          onProgress: ({ loaded, total }) => {
            const pct = Math.round(loaded / total * 100);
            indicator == null ? void 0 : indicator.progress(`Downloading voice model\u2026 ${pct}%`, pct >= 100);
          }
        });
      }
      if (!isSpeechSupported(scope)) {
        (_b = scope.console) == null ? void 0 : _b.warn("[reveal-aloud] This browser has no speech synthesis; narration is off.");
        return null;
      }
      return createWebSpeech();
    }
    function warnIfVoiceMissing() {
      var _a2;
      if (!speech || !indicator || !config.voice) return;
      const { voice, warning } = speech.resolveVoice(settingsFrom(config));
      if (warning !== "voice-not-found") return;
      const using = voice ? `using \u201C${voice.name}\u201D instead` : "no voice available";
      indicator.warn(`Voice \u201C${config.voice}\u201D is not available \u2014 ${using}`);
      (_a2 = scope.console) == null ? void 0 : _a2.warn(
        `[reveal-aloud] Voice "${config.voice}" is not available to this browser \u2014 ${using}. Run RevealAloud.listVoices() for the exact names you can use. Note that macOS Siri voices are reserved by Apple and never appear in that list.`
      );
    }
    const plugin = {
      id: "aloud",
      init(deck) {
        var _a2, _b, _c, _d, _e, _f;
        config = { ...DEFAULTS, ...(_b = (_a2 = deck.getConfig) == null ? void 0 : _a2.call(deck).aloud) != null ? _b : {}, ...(_c = overrides.config) != null ? _c : {} };
        speech = (_d = overrides.speech) != null ? _d : createSpeech();
        if (!speech || isPrintView(deck, scope)) {
          return;
        }
        clock = (_e = overrides.clock) != null ? _e : createBrowserClock(scope);
        indicator = (_f = overrides.indicator) != null ? _f : config.indicator ? createDomIndicator({ doc: scope.document }) : createNullIndicator();
        state = initialState({
          autoStart: config.autoStart,
          requiresGesture: true,
          settings: settingsFrom(config)
        });
        deckAdapter = createDeckAdapter({
          deck,
          dispatch,
          config,
          scope,
          onUnload: () => speech.stop()
        });
        deckAdapter.listen();
        if (config.autoStart) deckAdapter.armGesture();
        let unsubscribe = () => {
        };
        unsubscribe = speech.onVoicesChanged(() => {
          warnIfVoiceMissing();
          unsubscribe();
        });
        if (speech.listVoices().length > 0) warnIfVoiceMissing();
      },
      // ---- public API: Reveal.getPlugin('aloud') ----
      toggle: () => dispatch({ type: Event.TOGGLE_PRESSED }),
      start: () => dispatch({ type: Event.START_REQUESTED }),
      stop: () => dispatch({ type: Event.STOP_REQUESTED }),
      replay: () => dispatch({ type: Event.REPLAY_REQUESTED }),
      isOn: () => Boolean(state && isOn(state)),
      listVoices: () => speech ? speech.listVoices().map(describeVoice) : [],
      setVoice: (voice) => applySettings({ voice }),
      setRate: (rate) => applySettings({ rate }),
      configure: (settings) => applySettings(settings),
      getState: () => state,
      destroy: () => {
        deckAdapter == null ? void 0 : deckAdapter.destroy();
        clock == null ? void 0 : clock.cancel();
        speech == null ? void 0 : speech.stop();
        indicator == null ? void 0 : indicator.destroy();
      }
    };
    return plugin;
  }
  function describeVoice(voice) {
    return { name: voice.name, lang: voice.lang, default: Boolean(voice.default) };
  }

  // src/index.js
  function RevealAloud() {
    return createPlugin();
  }
  RevealAloud.listVoices = function listVoices() {
    if (!isSpeechSupported()) return [];
    return createWebSpeech().listVoices().map((voice) => ({ name: voice.name, lang: voice.lang, default: Boolean(voice.default) }));
  };
  RevealAloud.preview = function preview(slide, options = {}) {
    return toSpeech(slideToBlocks(slide), { ...DEFAULTS, ...options });
  };
  RevealAloud.defaults = DEFAULTS;
  var index_default = RevealAloud;
  return __toCommonJS(index_exports);
})();
RevealAloud = RevealAloud.default;
