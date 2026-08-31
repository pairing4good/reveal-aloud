/**
 * PURE. The whole note-to-speech pipeline in one place, so the order of operations is
 * visible and testable: strip the human-only parts first, tidy up what that leaves behind,
 * then break the result into utterances.
 *
 * Stripping must come before chunking — otherwise a stage direction that spans a sentence
 * boundary would be split across two utterances and half of it would be read aloud.
 */

import { stripSilent } from './brackets.js';
import { blocksToText, normalize } from './text.js';
import { chunk } from './chunk.js';

/**
 * @typedef {{kind: 'text'|'code'|'break', text?: string}} Block
 * @typedef {{chunks: string[], unclosedBracket: boolean}} Speech
 */

/**
 * @param {Block[]} blocks the current slide's notes, as plain data
 * @param {{speakCode?: boolean, maxChars?: number}} [options]
 * @returns {Speech} `chunks` is empty whenever the slide should stay silent — no notes,
 *   whitespace only, or notes that are entirely stage direction.
 */
export function toSpeech(blocks, options = {}) {
  const raw = blocksToText(blocks, options);
  const { text, unclosed } = stripSilent(raw);
  return {
    chunks: chunk(normalize(text), options),
    unclosedBracket: unclosed
  };
}
