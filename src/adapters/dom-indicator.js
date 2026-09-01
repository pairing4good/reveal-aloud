/**
 * IndicatorPort: a small badge in the corner telling the presenter what the narrator is doing.
 *
 * Presenting without it is guesswork — you cannot tell "narration is off" from "this slide has
 * no notes" from "the browser is still waiting for a click before it will make sound". Each of
 * those is a different thing to do about it, so each gets its own words.
 *
 * The CSS is injected rather than shipped as a separate file, so adding this plugin stays a
 * one-line change to a deck.
 */

import { Status } from '../core/narrator.js';

const STYLE_ID = 'reveal-aloud-style';

const LABELS = {
  [Status.OFF]: { icon: '🔇', text: 'Narration off' },
  [Status.SPEAKING]: { icon: '🔊', text: 'Reading notes' },
  [Status.IDLE]: { icon: '🔈', text: 'Narration on' },
  [Status.NO_NOTES]: { icon: '🔈', text: 'No notes on this slide' },
  [Status.BLOCKED]: { icon: '⏸', text: 'Narration paused' },
  [Status.WAITING_FOR_GESTURE]: { icon: '👆', text: 'Press any key to start narration' },
  [Status.FAILED]: { icon: '⚠️', text: 'Speech failed' }
};

const CSS = `
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

/**
 * @param {{doc?: Document, hideAfterMs?: number, timers?: object}} [options]
 * @returns {import('../ports.js').IndicatorPort}
 */
export function createDomIndicator(options = {}) {
  const doc = options.doc ?? globalThis.document;
  const timers = options.timers ?? globalThis;
  const hideAfterMs = options.hideAfterMs ?? 2600;
  const warnAfterMs = options.warnAfterMs ?? 12000;

  injectStyle(doc);

  const el = doc.createElement('div');
  el.className = 'reveal-aloud-indicator';
  // Cosmetic: the speech itself is the content, so this must not be announced twice.
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<span class="reveal-aloud-indicator__icon"></span>' +
    '<span class="reveal-aloud-indicator__pulse"></span>' +
    '<span class="reveal-aloud-indicator__text"></span>';
  doc.body.appendChild(el);

  let hideTimer = null;
  let warningEl = null;
  let warningTimer = null;
  let progressEl = null;

  /**
   * Says something is wrong with the setup, separately from the status badge.
   *
   * The badge is overwritten every time a slide changes, so a configuration problem shown
   * there would be gone within seconds — and the console, where this also goes, is somewhere
   * a presenter has no reason to look.
   */
  function warn(message) {
    if (warningEl === null) {
      warningEl = doc.createElement('div');
      warningEl.className = 'reveal-aloud-warning';
      warningEl.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(warningEl);
    }
    warningEl.textContent = message;
    warningEl.dataset.visible = 'true';

    if (warningTimer !== null) timers.clearTimeout(warningTimer);
    // Long enough to read and act on, short enough not to sit over the talk.
    warningTimer = timers.setTimeout(() => {
      warningEl.dataset.visible = 'false';
    }, warnAfterMs);
  }

  /**
   * Reports a one-off, non-error background task — currently only a Kokoro model download.
   * Separate from `warn`: a download in progress is not a problem, and separate from `show`:
   * it must survive slide changes that would otherwise overwrite it.
   *
   * @param {string} text
   * @param {boolean} [done] pass true on the final call to fade it out
   */
  function progress(text, done = false) {
    if (progressEl === null) {
      progressEl = doc.createElement('div');
      progressEl.className = 'reveal-aloud-progress';
      progressEl.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(progressEl);
    }
    progressEl.textContent = text;
    progressEl.dataset.visible = done ? 'false' : 'true';
  }

  function show(status, detail = {}) {
    const label = LABELS[status] ?? LABELS[Status.IDLE];
    const suffix = detail.unclosedBracket ? ' · unclosed “[” in notes' : '';

    el.dataset.status = status;
    el.dataset.visible = 'true';
    el.querySelector('.reveal-aloud-indicator__icon').textContent = label.icon;
    el.querySelector('.reveal-aloud-indicator__text').textContent = label.text + suffix;

    if (hideTimer !== null) timers.clearTimeout(hideTimer);
    // While speaking, leave it up: it is the only sign the narrator is still going.
    if (status === Status.SPEAKING || status === Status.WAITING_FOR_GESTURE) return;
    hideTimer = timers.setTimeout(() => {
      el.dataset.visible = 'false';
    }, hideAfterMs);
  }

  function destroy() {
    if (hideTimer !== null) timers.clearTimeout(hideTimer);
    if (warningTimer !== null) timers.clearTimeout(warningTimer);
    warningEl?.remove();
    progressEl?.remove();
    el.remove();
  }

  return { show, warn, progress, destroy };
}

/** An indicator that does nothing, for `indicator: false`. */
export function createNullIndicator() {
  return { show() {}, warn() {}, progress() {}, destroy() {} };
}

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
