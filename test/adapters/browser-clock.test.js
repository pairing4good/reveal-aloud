/**
 * The clock. One slot, on purpose: there is only ever one pending start, and a newer one
 * must replace the older rather than both firing.
 */

import { describe, expect, it, vi } from 'vitest';
import { createBrowserClock } from '../../src/adapters/browser-clock.js';

/** Timers the test advances by hand. */
function fakeTimers() {
  const scheduled = new Map();
  let nextId = 1;
  return {
    setTimeout(fn) {
      const id = nextId++;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    runAll() {
      const fns = [...scheduled.values()];
      scheduled.clear();
      for (const fn of fns) fn();
    },
    get count() {
      return scheduled.size;
    }
  };
}

describe('the delayed start', () => {
  it('runs the delayed call', () => {
    const timers = fakeTimers();
    const clock = createBrowserClock(timers);
    const start = vi.fn();

    clock.delay(120, start);
    timers.runAll();

    expect(start).toHaveBeenCalledOnce();
  });

  it('replaces a pending start rather than letting both run', () => {
    const timers = fakeTimers();
    const clock = createBrowserClock(timers);
    const first = vi.fn();
    const second = vi.fn();

    clock.delay(120, first);
    clock.delay(120, second);
    timers.runAll();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('drops a pending start when cancelled', () => {
    const timers = fakeTimers();
    const clock = createBrowserClock(timers);
    const start = vi.fn();

    clock.delay(120, start);
    clock.cancel();
    timers.runAll();

    expect(start).not.toHaveBeenCalled();
  });

  it('leaves no timer behind once it has fired', () => {
    const timers = fakeTimers();
    const clock = createBrowserClock(timers);

    clock.delay(120, () => {});
    timers.runAll();
    clock.cancel();

    expect(timers.count).toBe(0);
  });
});
