/**
 * PURE. Removes the parts of a speaker note that are written for the human, not the voice.
 *
 * The convention is a single one: anything between `[` and `]` is a stage direction and is
 * never spoken. Because that makes brackets markup, an author who genuinely wants a bracket
 * read out escapes it as `\[` or `\]`.
 *
 * Removal happens before sentence chunking, so a stage direction may straddle sentence and
 * line boundaries without changing how the rest of the note is broken up for speech.
 */

const ESCAPABLE = new Set(['[', ']']);

/**
 * @param {string} text raw note text
 * @returns {{text: string, unclosed: boolean}} `text` with every bracketed span removed, and
 *   whether an opening bracket was never closed (everything after it was dropped, which is
 *   worth telling the author about rather than silently swallowing half their note).
 */
export function stripSilent(text) {
  if (typeof text !== 'string' || text === '') return { text: '', unclosed: false };

  let out = '';
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\\' && ESCAPABLE.has(text[i + 1])) {
      // An escaped bracket is ordinary text. Inside a silent span it is still silent.
      if (depth === 0) out += text[i + 1];
      i++;
      continue;
    }

    if (ch === '[') {
      depth++;
      continue;
    }

    if (ch === ']') {
      // A stray closer is a typo, not something to read aloud. Drop it either way.
      if (depth > 0) depth--;
      continue;
    }

    if (depth === 0) out += ch;
  }

  return { text: out, unclosed: depth > 0 };
}
