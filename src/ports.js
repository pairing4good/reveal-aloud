/**
 * The contracts between the pure core and the outside world.
 *
 * Dependencies point inward: adapters implement these, the core never imports them. Swapping
 * the macOS `say` command in for the browser's speech engine later means writing one more
 * SpeechPort — no change to any decision-making code.
 *
 * This file is documentation with teeth: the JSDoc types below are what the adapter tests
 * and the fakes in the test suite are written against.
 */

/**
 * @typedef {object} SpeechPort
 * @property {(request: SpeakRequest, handlers: SpeechHandlers) => void} speak
 *   Speaks `chunks` in order. Reports completion exactly once, stamped with `request.epoch`.
 * @property {() => void} stop
 *   Silences immediately. Callbacks for anything already in flight must not be reported.
 * @property {() => Array<{name: string, lang?: string, default?: boolean}>} listVoices
 * @property {(settings: object) => {voice: object|null, warning: string|null}} resolveVoice
 * @property {(listener: () => void) => () => void} onVoicesChanged
 *   Subscribes to late-arriving voice lists; returns an unsubscribe function.
 */

/**
 * @typedef {object} SpeakRequest
 * @property {string[]} chunks
 * @property {number} epoch
 * @property {object} settings voice, lang, rate, pitch, volume
 */

/**
 * @typedef {object} SpeechHandlers
 * @property {(epoch: number) => void} onFinished
 * @property {(epoch: number, error: string) => void} onFailed
 */

/**
 * @typedef {object} ClockPort
 * @property {(ms: number, fn: () => void) => void} delay
 *   Runs `fn` after `ms`, replacing any previously delayed call. One slot is all this
 *   plugin needs: there is only ever one pending start.
 * @property {() => void} cancel
 */

/**
 * @typedef {object} IndicatorPort
 * @property {(status: string, detail?: object) => void} show
 * @property {() => void} destroy
 */

/* -------------------------------------------------------------------------------------------
 * Offline export (bin/export-narration.js).
 *
 * These are only used by the exporter, never by the browser plugin — nothing here is reachable
 * from src/index.js, so none of it ships in dist/.
 * ---------------------------------------------------------------------------------------- */

/**
 * @typedef {object} NarrationSourcePort
 * @property {(target: string) => Promise<{config: object, slides: SlideNarration[]}>} readDeck
 *   Reads every slide's narration out of a deck, in presentation order. `config` is the deck's
 *   own `aloud` block, so the exporter honours the same settings the deck speaks with.
 * @property {() => Promise<void>} [close] releases a browser or server the source opened
 */

/**
 * One slide's worth of narration, exactly as the live plugin would speak it.
 *
 * @typedef {object} SlideNarration
 * @property {number} index position among all leaf slides, 0-based
 * @property {number} h horizontal reveal.js index
 * @property {number} v vertical reveal.js index
 * @property {string|null} id the slide's `id` attribute, when it has one
 * @property {string|null} title first heading, for the manifest and CSV
 * @property {boolean} hasNotes whether the slide had speaker notes at all — distinct from
 *   whether anything survived bracket stripping
 * @property {string[]} chunks what will actually be spoken, already stripped and chunked
 * @property {boolean} unclosedBracket a `[` was never closed, so more was silenced than meant
 */

/**
 * Renders narration to an audio file. The seam that lets `say` and Kokoro coexist: the two
 * combine chunks quite differently, so the port takes chunks rather than joined text.
 *
 * @typedef {object} AudioRenderPort
 * @property {string} id `'say'` or `'kokoro'`
 * @property {() => Promise<void>} probe
 *   Rejects with a message a human can act on when this renderer cannot run here — wrong
 *   platform, missing package, unsupported Node. Called once before any rendering.
 * @property {() => Promise<Array<{name: string, lang?: string, gender?: string,
 *   grade?: string, traits?: string, default?: boolean}>>} listVoices
 * @property {(job: RenderJob) => Promise<AudioFormat>} render
 *   Writes `job.outPath` and returns the format written, so the caller can refuse to
 *   concatenate files that do not match.
 */

/**
 * @typedef {object} RenderJob
 * @property {string[]} chunks non-empty; callers skip silent slides rather than passing []
 * @property {string} [voice]
 * @property {number} rate
 * @property {string} outPath
 * @property {number} [gapSilenceMs] silence between chunks
 * @property {number} [leadSilenceMs]
 * @property {number} [tailSilenceMs]
 */

/**
 * @typedef {object} AudioFormat
 * @property {number} sampleRate
 * @property {number} channels
 * @property {number} bitsPerSample
 */

/**
 * The filesystem, injected so the whole export flow is testable in memory.
 *
 * @typedef {object} FilesPort
 * @property {(dir: string) => Promise<void>} mkdir
 * @property {(path: string, data: string|Uint8Array) => Promise<void>} write
 * @property {(path: string, bytes?: number) => Promise<Uint8Array>} readHead
 *   The first `bytes` of a file — enough to parse a WAV header without loading the samples.
 * @property {(path: string) => Promise<number>} size
 * @property {(path: string, from: number, to: number) => Promise<Uint8Array>} readRange
 * @property {(path: string) => Promise<boolean>} exists
 */

export {};
