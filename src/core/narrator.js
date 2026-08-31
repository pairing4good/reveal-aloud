/**
 * PURE. Every decision reveal-aloud makes lives here, as `reduce(state, event) -> {state, commands}`.
 *
 * Nothing in this file speaks, listens, or waits. Adapters translate the outside world into
 * events and translate the returned commands back into effects. That is what lets the
 * awkward parts of this feature — stopping mid-sentence when the presenter advances early,
 * ignoring a cancelled slide's callbacks, staying silent on a slide with no notes — be
 * tested as arithmetic instead of by ear.
 *
 * The epoch is the load-bearing idea. Every start and every stop bumps it, and every
 * completion event carries the epoch it belongs to. A callback from speech we already
 * cancelled therefore arrives stamped with an old epoch and is ignored, instead of
 * advancing the *new* slide's narration and putting two voices on top of each other.
 */

import { toSpeech } from './notes.js';

/** Events adapters may dispatch. */
export const Event = Object.freeze({
  TOGGLE_PRESSED: 'TOGGLE_PRESSED',
  START_REQUESTED: 'START_REQUESTED',
  STOP_REQUESTED: 'STOP_REQUESTED',
  REPLAY_REQUESTED: 'REPLAY_REQUESTED',
  SLIDE_ENTERED: 'SLIDE_ENTERED',
  SPEECH_FINISHED: 'SPEECH_FINISHED',
  SPEECH_FAILED: 'SPEECH_FAILED',
  OVERVIEW_SHOWN: 'OVERVIEW_SHOWN',
  OVERVIEW_HIDDEN: 'OVERVIEW_HIDDEN',
  DECK_PAUSED: 'DECK_PAUSED',
  DECK_RESUMED: 'DECK_RESUMED',
  PAGE_HIDDEN: 'PAGE_HIDDEN',
  PAGE_VISIBLE: 'PAGE_VISIBLE',
  USER_GESTURE: 'USER_GESTURE',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED'
});

/** Commands the composition root carries out. */
export const Command = Object.freeze({
  SPEAK: 'SPEAK',
  STOP: 'STOP',
  SHOW: 'SHOW'
});

/** What the on-screen indicator should say. */
export const Status = Object.freeze({
  OFF: 'off',
  SPEAKING: 'speaking',
  IDLE: 'idle',
  NO_NOTES: 'no-notes',
  BLOCKED: 'blocked',
  WAITING_FOR_GESTURE: 'waiting-for-gesture',
  FAILED: 'failed'
});

/** Reasons narration is temporarily silenced without being switched off. */
const Suppression = Object.freeze({
  OVERVIEW: 'overview',
  DECK_PAUSED: 'deck-paused',
  PAGE_HIDDEN: 'page-hidden'
});

const SUPPRESSED_BY = Object.freeze({
  [Event.OVERVIEW_SHOWN]: Suppression.OVERVIEW,
  [Event.DECK_PAUSED]: Suppression.DECK_PAUSED,
  [Event.PAGE_HIDDEN]: Suppression.PAGE_HIDDEN
});

const RELEASED_BY = Object.freeze({
  [Event.OVERVIEW_HIDDEN]: Suppression.OVERVIEW,
  [Event.DECK_RESUMED]: Suppression.DECK_PAUSED,
  [Event.PAGE_VISIBLE]: Suppression.PAGE_HIDDEN
});

const EMPTY_SLIDE = Object.freeze({ chunks: Object.freeze([]), unclosedBracket: false });

/**
 * @param {{autoStart?: boolean, requiresGesture?: boolean, settings?: object}} [options]
 * @returns {object} the starting state
 */
export function initialState(options = {}) {
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

/**
 * @param {object} state
 * @param {{type: string}} event
 * @returns {{state: object, commands: Array<object>}} a new state and the effects to run.
 *   Total: an unrecognised event changes nothing.
 */
export function reduce(state, event) {
  const type = event?.type;

  switch (type) {
    case Event.TOGGLE_PRESSED:
      return state.on ? switchOff(state) : switchOn(state);

    case Event.START_REQUESTED:
      // Idempotent: starting an already-running narrator must not restart the slide.
      return state.on ? unchanged(state) : switchOn(state);

    case Event.STOP_REQUESTED:
      return state.on ? switchOff(state) : unchanged(state);

    case Event.REPLAY_REQUESTED:
      return restart({ ...state, on: true, needsGesture: false });

    case Event.SLIDE_ENTERED: {
      const blocks = event.blocks ?? [];
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
      const settings = { ...state.settings, ...(event.settings ?? {}) };
      // Voice and rate cannot change mid-utterance, and chunking depends on the settings,
      // so re-derive the slide and, if we are mid-note, start it again with the new voice.
      const next = { ...state, settings, slide: toSpeech(state.blocks, settings) };
      return state.speaking ? restart(next) : unchanged(next);
    }

    default:
      return unchanged(state);
  }
}

/** @returns {boolean} whether narration is currently switched on */
export function isOn(state) {
  return state.on === true;
}

// ---------------------------------------------------------------------------
// transitions
// ---------------------------------------------------------------------------

function switchOn(state) {
  // The toggle key is itself the user gesture browsers are waiting for.
  return restart({ ...state, on: true, needsGesture: false });
}

function switchOff(state) {
  const { state: halted, commands } = halt({ ...state, on: false });
  return { state: halted, commands: [...commands, show(Status.OFF)] };
}

/**
 * Silences whatever is playing and then begins the current slide, if anything should be
 * spoken at all. This single path is why advancing, going back, jumping, resuming from
 * overview and switching narration on all behave identically.
 */
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
    // No notes is not an error and does not switch narration off — the next slide with
    // notes picks straight back up.
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

/** Stops any speech in flight and invalidates its pending callbacks. */
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
  // Still blocked for another reason: stay quiet rather than half-resuming.
  return suppressedBy.length > 0 ? unchanged(next) : restart(next);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isStale(state, event) {
  return event.epoch !== state.epoch || !state.speaking;
}

function show(status, detail) {
  return detail ? { type: Command.SHOW, status, detail } : { type: Command.SHOW, status };
}

function detailOf(state) {
  return state.slide.unclosedBracket ? { unclosedBracket: true } : undefined;
}

function unchanged(state) {
  return { state, commands: [] };
}
