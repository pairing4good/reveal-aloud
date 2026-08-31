/**
 * One test per sentence of the specification.
 *
 * These drive the real state machine, so they are the executable version of "the voice should
 * read the current slide's speaker notes and stop once they come to the end of the slide".
 */

import { describe, expect, it } from 'vitest';
import { Command, Event, Status, initialState, reduce } from '../../src/core/narrator.js';

/** A presenter at the keyboard: dispatch events, look at what was said. */
function presenter(options = {}) {
  let state = initialState(options);
  let lastCommands = [];

  const api = {
    dispatch(event) {
      const result = reduce(state, event);
      state = result.state;
      lastCommands = result.commands;
      return api;
    },
    pressKey: () => api.dispatch({ type: Event.TOGGLE_PRESSED }),
    enterSlide: (notes) =>
      api.dispatch({ type: Event.SLIDE_ENTERED, blocks: notesToBlocks(notes) }),
    finishSpeaking: () =>
      api.dispatch({ type: Event.SPEECH_FINISHED, epoch: state.epoch }),

    get state() {
      return state;
    },
    get commands() {
      return lastCommands;
    },
    /** What the narrator was asked to say, in order. */
    get spoken() {
      return lastCommands.filter((c) => c.type === Command.SPEAK).flatMap((c) => c.chunks);
    },
    get stopped() {
      return lastCommands.some((c) => c.type === Command.STOP);
    },
    get status() {
      return lastCommands.filter((c) => c.type === Command.SHOW).at(-1)?.status;
    }
  };
  return api;
}

function notesToBlocks(notes) {
  return notes === null || notes === undefined ? [] : [{ kind: 'text', text: notes }];
}

describe('turning narration on and off', () => {
  it('reads the current slide when the shortcut key is pressed', () => {
    const deck = presenter().enterSlide('Welcome to the talk.').pressKey();

    expect(deck.spoken).toEqual(['Welcome to the talk.']);
    expect(deck.status).toBe(Status.SPEAKING);
  });

  it('stops reading immediately when the key is pressed again', () => {
    const deck = presenter().enterSlide('A long note that is still being read.').pressKey();

    deck.pressKey();

    expect(deck.stopped).toBe(true);
    expect(deck.spoken).toEqual([]);
    expect(deck.status).toBe(Status.OFF);
    expect(deck.state.on).toBe(false);
  });

  it('says nothing while narration is off, however the presenter navigates', () => {
    const deck = presenter();

    deck.enterSlide('First slide notes.');
    expect(deck.spoken).toEqual([]);

    deck.enterSlide('Second slide notes.');
    expect(deck.spoken).toEqual([]);
    expect(deck.status).toBe(Status.OFF);
  });
});

describe('following the presenter through the deck', () => {
  it('starts reading the next slide when the deck is advanced', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();

    deck.enterSlide('Slide two.');

    expect(deck.spoken).toEqual(['Slide two.']);
  });

  it('stops the current slide the moment the presenter advances mid-sentence', () => {
    const deck = presenter().enterSlide('One. Two. Three.').pressKey();
    expect(deck.state.speaking).toBe(true);

    deck.enterSlide('A brand new slide.');

    expect(deck.stopped).toBe(true);
    expect(deck.spoken).toEqual(['A brand new slide.']);
  });

  it('treats going back to the previous slide exactly like advancing', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();
    deck.enterSlide('Slide two.');

    deck.enterSlide('Slide one.'); // navigating backwards

    expect(deck.stopped).toBe(true);
    expect(deck.spoken).toEqual(['Slide one.']);
  });

  it('re-reads a slide from the beginning when it is returned to', () => {
    const deck = presenter().enterSlide('First. Second.').pressKey();
    deck.finishSpeaking();

    deck.enterSlide('First. Second.');

    expect(deck.spoken).toEqual(['First.', 'Second.']);
  });
});

describe('slides that should stay silent', () => {
  it('says nothing when a slide has no speaker notes', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();

    deck.enterSlide(null);

    expect(deck.spoken).toEqual([]);
    expect(deck.status).toBe(Status.NO_NOTES);
  });

  it('leaves narration switched on so the next slide with notes still reads', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();

    deck.enterSlide(null);
    expect(deck.state.on).toBe(true);

    deck.enterSlide('Slide three has notes again.');
    expect(deck.spoken).toEqual(['Slide three has notes again.']);
  });

  it('says nothing when the notes are entirely stage direction', () => {
    const deck = presenter().enterSlide('[wait for the demo to load]').pressKey();

    expect(deck.spoken).toEqual([]);
    expect(deck.status).toBe(Status.NO_NOTES);
  });

  it('says nothing when the notes are only whitespace', () => {
    const deck = presenter().enterSlide('   \n\t  ').pressKey();

    expect(deck.spoken).toEqual([]);
  });
});

describe('stage directions in brackets', () => {
  it('never speaks the text between brackets', () => {
    const deck = presenter()
      .enterSlide('Welcome. [wait for laughs] Now the agenda.')
      .pressKey();

    expect(deck.spoken).toEqual(['Welcome.', 'Now the agenda.']);
  });

  it('speaks a bracket the author escaped', () => {
    const deck = presenter().enterSlide('Type \\[enter\\] to continue.').pressKey();

    expect(deck.spoken).toEqual(['Type [enter] to continue.']);
  });

  it('flags an unclosed bracket instead of silently swallowing the rest', () => {
    const deck = presenter().enterSlide('Say this. [oops I forgot to close').pressKey();

    expect(deck.spoken).toEqual(['Say this.']);
    expect(deck.commands.at(-1).detail).toEqual({ unclosedBracket: true });
  });
});

describe('interrupted speech never bleeds into the next slide', () => {
  it('ignores the finish callback of a slide the presenter already left', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();
    const staleEpoch = deck.state.epoch;

    deck.enterSlide('Slide two.');
    const liveEpoch = deck.state.epoch;

    deck.dispatch({ type: Event.SPEECH_FINISHED, epoch: staleEpoch });

    expect(deck.commands).toEqual([]); // the stale callback changed nothing
    expect(deck.state.speaking).toBe(true); // slide two is still being read
    expect(deck.state.epoch).toBe(liveEpoch);
  });

  it('ignores the error callback raised by our own cancellation', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();
    const staleEpoch = deck.state.epoch;

    deck.enterSlide('Slide two.');
    deck.dispatch({ type: Event.SPEECH_FAILED, epoch: staleEpoch, error: 'interrupted' });

    expect(deck.commands).toEqual([]);
    expect(deck.state.speaking).toBe(true);
  });

  it('reports a genuine failure of the slide currently being read', () => {
    const deck = presenter().enterSlide('Slide one.').pressKey();

    deck.dispatch({
      type: Event.SPEECH_FAILED,
      epoch: deck.state.epoch,
      error: 'synthesis-failed'
    });

    expect(deck.status).toBe(Status.FAILED);
    expect(deck.state.speaking).toBe(false);
  });
});

describe('going quiet without switching off', () => {
  const interruptions = [
    ['the slide overview is opened', Event.OVERVIEW_SHOWN, Event.OVERVIEW_HIDDEN],
    ['the deck is blacked out', Event.DECK_PAUSED, Event.DECK_RESUMED],
    ['the tab goes into the background', Event.PAGE_HIDDEN, Event.PAGE_VISIBLE]
  ];

  it.each(interruptions)('stops speaking when %s', (_name, interrupt) => {
    const deck = presenter().enterSlide('Some notes here.').pressKey();

    deck.dispatch({ type: interrupt });

    expect(deck.stopped).toBe(true);
    expect(deck.status).toBe(Status.BLOCKED);
    expect(deck.state.on).toBe(true); // still armed, just quiet
  });

  it.each(interruptions)('resumes the current slide when %s ends', (_name, interrupt, resume) => {
    const deck = presenter().enterSlide('Some notes here.').pressKey();
    deck.dispatch({ type: interrupt });

    deck.dispatch({ type: resume });

    expect(deck.spoken).toEqual(['Some notes here.']);
  });

  it('stays quiet while any one interruption is still in force', () => {
    const deck = presenter().enterSlide('Some notes here.').pressKey();
    deck.dispatch({ type: Event.OVERVIEW_SHOWN });
    deck.dispatch({ type: Event.PAGE_HIDDEN });

    deck.dispatch({ type: Event.PAGE_VISIBLE });

    expect(deck.spoken).toEqual([]); // overview is still open
  });
});

describe('long notes', () => {
  it('splits notes into utterances short enough that the engine cannot truncate them', () => {
    const sentence = 'This sentence is here to make the note long. ';
    const deck = presenter().enterSlide(sentence.repeat(12)).pressKey();

    expect(deck.spoken.length).toBe(12);
    for (const utterance of deck.spoken) expect(utterance.length).toBeLessThanOrEqual(180);
  });
});

describe('changing the voice or speed', () => {
  it('restarts the current note, because a voice cannot change mid-sentence', () => {
    const deck = presenter().enterSlide('Read this in a new voice.').pressKey();

    deck.dispatch({ type: Event.SETTINGS_CHANGED, settings: { rate: 1.5 } });

    expect(deck.stopped).toBe(true);
    expect(deck.spoken).toEqual(['Read this in a new voice.']);
    expect(deck.commands.find((c) => c.type === Command.SPEAK).settings.rate).toBe(1.5);
  });

  it('does not start talking when the settings change while narration is off', () => {
    const deck = presenter().enterSlide('Some notes.');

    deck.dispatch({ type: Event.SETTINGS_CHANGED, settings: { rate: 2 } });

    expect(deck.spoken).toEqual([]);
  });
});

describe('starting automatically', () => {
  it('waits for the first keypress, because browsers refuse to speak before one', () => {
    const deck = presenter({ autoStart: true, requiresGesture: true });

    deck.enterSlide('Opening slide notes.');
    expect(deck.spoken).toEqual([]);
    expect(deck.status).toBe(Status.WAITING_FOR_GESTURE);

    deck.dispatch({ type: Event.USER_GESTURE });
    expect(deck.spoken).toEqual(['Opening slide notes.']);
  });
});

describe('the public API', () => {
  it('does not restart the slide when start() is called on an already-running narrator', () => {
    const deck = presenter().enterSlide('Half-read notes.').pressKey();

    deck.dispatch({ type: Event.START_REQUESTED });

    expect(deck.commands).toEqual([]);
  });

  it('re-reads the current slide from the top when replay() is called', () => {
    const deck = presenter().enterSlide('First. Second.').pressKey();
    deck.finishSpeaking();

    deck.dispatch({ type: Event.REPLAY_REQUESTED });

    expect(deck.spoken).toEqual(['First.', 'Second.']);
  });
});

describe('unknown events', () => {
  it('changes nothing, so a future reveal.js event cannot break narration', () => {
    const before = initialState();

    const { state, commands } = reduce(before, { type: 'SOMETHING_NEW' });

    expect(state).toBe(before);
    expect(commands).toEqual([]);
  });
});
