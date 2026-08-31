/**
 * Properties of the narration state machine, driven by random sequences of events.
 *
 * This is the test that earns its keep. The failure mode this plugin has to avoid — two
 * voices talking over each other because a cancelled slide's callback advanced the new
 * slide's queue — only shows up under navigation that is faster and more erratic than anyone
 * would think to write by hand. Generating thousands of such sequences and asserting the
 * invariants after every single event covers it in a way examples cannot.
 *
 * Turn the dial up with `npm run test:soak`.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Command, Event, initialState, reduce } from '../../src/core/narrator.js';
import { RUNS, blocks, params } from './arbitraries.js';

/** Every event an adapter can dispatch, including ones that arrive at absurd moments. */
const anyEvent = fc.oneof(
  fc.constant({ type: Event.TOGGLE_PRESSED }),
  fc.constant({ type: Event.START_REQUESTED }),
  fc.constant({ type: Event.STOP_REQUESTED }),
  fc.constant({ type: Event.REPLAY_REQUESTED }),
  blocks.map((b) => ({ type: Event.SLIDE_ENTERED, blocks: b })),
  fc.constant({ type: Event.OVERVIEW_SHOWN }),
  fc.constant({ type: Event.OVERVIEW_HIDDEN }),
  fc.constant({ type: Event.DECK_PAUSED }),
  fc.constant({ type: Event.DECK_RESUMED }),
  fc.constant({ type: Event.PAGE_HIDDEN }),
  fc.constant({ type: Event.PAGE_VISIBLE }),
  fc.constant({ type: Event.USER_GESTURE }),
  fc.record({ type: fc.constant(Event.SETTINGS_CHANGED), settings: fc.constant({ rate: 1.5 }) }),
  // Completion callbacks, including stale ones from slides already left behind.
  fc.record({ type: fc.constant(Event.SPEECH_FINISHED), epoch: fc.integer({ min: 0, max: 30 }) }),
  fc.record({
    type: fc.constant(Event.SPEECH_FAILED),
    epoch: fc.integer({ min: 0, max: 30 }),
    error: fc.constantFrom('interrupted', 'canceled', 'synthesis-failed', 'audio-busy')
  })
);

const sequences = fc.array(anyEvent, { minLength: 1, maxLength: 40 });

const startOptions = fc.record({
  autoStart: fc.boolean(),
  requiresGesture: fc.boolean()
});

/** Replays a sequence, checking the invariants after every event. */
function run(events, options, check) {
  let state = initialState(options);
  for (const event of events) {
    const before = state;
    const result = reduce(state, event);
    check(before, event, result);
    state = result.state;
  }
  return state;
}

describe(`reduce, over ${RUNS} generated event sequences`, () => {
  it('never starts a new utterance without first silencing the one in flight', () => {
    // This is the whole ballgame: a SPEAK issued while speech is live, with no STOP in
    // front of it, is two voices at once.
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (before, _event, { commands }) => {
          const speakAt = commands.findIndex((c) => c.type === Command.SPEAK);
          if (speakAt === -1 || !before.speaking) return;

          const stopAt = commands.findIndex((c) => c.type === Command.STOP);
          expect(stopAt).toBeGreaterThanOrEqual(0);
          expect(stopAt).toBeLessThan(speakAt);
        });
      }),
      params
    );
  });

  it('never issues more than one utterance queue for a single event', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (_before, _event, { commands }) => {
          expect(commands.filter((c) => c.type === Command.SPEAK).length).toBeLessThanOrEqual(1);
        });
      }),
      params
    );
  });

  it('always agrees with itself about whether speech is in flight', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (_before, _event, { state, commands }) => {
          const speak = commands.find((c) => c.type === Command.SPEAK);
          if (speak) {
            expect(state.speaking).toBe(true);
            expect(speak.epoch).toBe(state.epoch);
          }
        });
      }),
      params
    );
  });

  it('stamps every utterance with a fresh epoch, so old callbacks can be recognised', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        let highest = -1;
        run(events, options, (before, _event, { state, commands }) => {
          expect(state.epoch).toBeGreaterThanOrEqual(before.epoch);
          for (const command of commands) {
            if (command.type !== Command.SPEAK) continue;
            expect(command.epoch).toBeGreaterThan(highest);
            highest = command.epoch;
          }
        });
      }),
      params
    );
  });

  it('never speaks while narration is switched off', () => {
    fc.assert(
      fc.property(sequences, (events) => {
        // Narration starts off and is never switched on.
        const quiet = events.filter(
          (event) =>
            ![Event.TOGGLE_PRESSED, Event.START_REQUESTED, Event.REPLAY_REQUESTED].includes(
              event.type
            )
        );

        run(quiet, { autoStart: false }, (_before, _event, { commands }) => {
          expect(commands.some((c) => c.type === Command.SPEAK)).toBe(false);
        });
      }),
      params
    );
  });

  it('never speaks while the overview, a blackout or a hidden tab is in force', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (_before, _event, { state, commands }) => {
          if (state.suppressedBy.length === 0) return;
          expect(commands.some((c) => c.type === Command.SPEAK)).toBe(false);
        });
      }),
      params
    );
  });

  it('never speaks a slide that has nothing to say', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (_before, _event, { commands }) => {
          for (const command of commands) {
            if (command.type !== Command.SPEAK) continue;
            expect(command.chunks.length).toBeGreaterThan(0);
            for (const piece of command.chunks) expect(piece.trim()).not.toBe('');
          }
        });
      }),
      params
    );
  });

  it('never acts on a callback belonging to a slide already left behind', () => {
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        run(events, options, (before, event, { state, commands }) => {
          const isCallback =
            event.type === Event.SPEECH_FINISHED || event.type === Event.SPEECH_FAILED;
          if (!isCallback || event.epoch === before.epoch) return;

          expect(commands).toEqual([]);
          expect(state).toBe(before);
        });
      }),
      params
    );
  });

  it('never mutates the state it was handed', () => {
    // Purity is not decoration here: the behaviour tests, the property tests above and any
    // future undo or replay all rely on an old state still being the state it was.
    fc.assert(
      fc.property(sequences, startOptions, (events, options) => {
        let state = initialState(options);
        for (const event of events) {
          const snapshot = structuredClone(state);
          const result = reduce(state, event);

          expect(state).toEqual(snapshot);
          state = result.state;
        }
      }),
      params
    );
  });
});
