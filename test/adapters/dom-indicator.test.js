/**
 * The status badge. Its whole job is telling three situations apart that otherwise all look
 * like "nothing is happening": narration is off, this slide has no notes, and the browser is
 * still waiting for a gesture before it will make sound.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createDomIndicator, createNullIndicator } from '../../src/adapters/dom-indicator.js';
import { Status } from '../../src/core/narrator.js';

const badge = () => document.querySelector('.reveal-aloud-indicator');
const text = () => badge().querySelector('.reveal-aloud-indicator__text').textContent;

describe('the status badge', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('appears in the page with its styles', () => {
    createDomIndicator();

    expect(badge()).not.toBeNull();
    expect(document.getElementById('reveal-aloud-style')).not.toBeNull();
  });

  it.each([
    [Status.OFF, /off/i],
    [Status.SPEAKING, /reading/i],
    [Status.NO_NOTES, /no notes/i],
    [Status.WAITING_FOR_GESTURE, /press any key/i],
    [Status.FAILED, /failed/i]
  ])('says something different for %s', (status, expected) => {
    createDomIndicator().show(status);

    expect(text()).toMatch(expected);
  });

  it('warns about an unclosed bracket, which would otherwise silently eat the note', () => {
    createDomIndicator().show(Status.NO_NOTES, { unclosedBracket: true });

    expect(text()).toMatch(/unclosed/i);
  });

  it('stays on screen while the narrator is still talking', () => {
    const timers = { setTimeout: () => 1, clearTimeout: () => {} };
    createDomIndicator({ timers }).show(Status.SPEAKING);

    expect(badge().dataset.visible).toBe('true');
  });

  it('fades away once the narrator has stopped', () => {
    let hide;
    const timers = { setTimeout: (fn) => ((hide = fn), 1), clearTimeout: () => {} };
    createDomIndicator({ timers }).show(Status.IDLE);

    hide();

    expect(badge().dataset.visible).toBe('false');
  });

  it('is hidden from screen readers, because the speech is the content', () => {
    createDomIndicator();

    expect(badge().getAttribute('aria-hidden')).toBe('true');
  });

  it('takes itself out of the page when destroyed', () => {
    const indicator = createDomIndicator();

    indicator.destroy();

    expect(badge()).toBeNull();
  });

  it('adds nothing to the page when the presenter turns it off', () => {
    createNullIndicator().show(Status.SPEAKING);

    expect(badge()).toBeNull();
  });
});
