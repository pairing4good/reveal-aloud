/**
 * ClockPort over setTimeout.
 *
 * Single-slot on purpose. Routing every start through it gives two things at once: holding
 * the arrow key down no longer stutters out the first syllable of ten slides in a row, and
 * the gap after a cancel sidesteps Chrome's habit of dropping an utterance queued in the
 * same tick as `speechSynthesis.cancel()`.
 *
 * @param {{setTimeout: Function, clearTimeout: Function}} [timers] injectable for tests
 * @returns {import('../ports.js').ClockPort}
 */
export function createBrowserClock(timers = globalThis) {
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
