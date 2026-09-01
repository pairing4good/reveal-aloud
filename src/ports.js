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

export {};
