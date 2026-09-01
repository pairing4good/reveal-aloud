/**
 * PURE. Turns the plain-data description of a slide's notes into one speakable string.
 *
 * Adapters hand the core `Block`s rather than DOM nodes, so everything below is testable
 * without a browser:
 *
 *   {kind:'text', text:'Welcome. [wait for laughs]'}
 *   {kind:'code', text:'npm install reveal-aloud'}
 *   {kind:'break'}
 */

/** Characters that are punctuation for the eye but noise for the ear. */
const MARKDOWN_NOISE = /[`*]+/g;

/**
 * @param {Array<{kind:string, text?:string}>} blocks
 * @param {{speakCode?: boolean}} [options]
 * @returns {string} note text with newlines marking the places speech should breathe
 */
export function blocksToText(blocks, options = {}) {
  const { speakCode = false } = options;
  if (!Array.isArray(blocks)) return '';

  const lines = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.kind === 'break') {
      lines.push('');
      continue;
    }
    if (block.kind === 'code' && !speakCode) continue;
    if (typeof block.text === 'string') lines.push(block.text);
  }
  return lines.join('\n');
}

/**
 * Repairs the text for speech.
 *
 * Most of this exists because removing a bracketed span leaves debris behind: `Hello [x],
 * world` becomes `Hello , world`, and `Done. [beat] Next.` becomes a double space. Read
 * aloud, that debris turns into odd pauses and stray "comma" beats in some engines.
 *
 * Newlines survive, because they are where {@link module:core/chunk} lets the voice breathe.
 *
 * @param {string} text
 * @returns {string} normalized text, or '' when there is nothing worth saying
 */
export function normalize(text) {
  if (typeof text !== 'string' || text === '') return '';

  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f\u2009]/g, ' ')
    .replace(MARKDOWN_NOISE, '')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line !== '');

  const result = lines.join('\n');

  // A note that is only punctuation — usually all that survives a fully bracketed note —
  // is silence, not a mouthful of symbols.
  return hasSpeakableContent(result) ? result : '';
}

/** @returns {boolean} whether the text contains anything a voice could pronounce */
export function hasSpeakableContent(text) {
  return typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);
}

function normalizeLine(line) {
  return (
    line
      .replace(/[\t ]+/g, ' ')
      // `Hello , world` -> `Hello, world`
      .replace(/ +([,.;:!?…])/g, '$1')
      // `word, ; next` -> `word, next`
      .replace(/([,;:])(?: *[,;:])+/g, '$1')
      // `Done. , Next` -> `Done. Next`
      .replace(/([.!?…]) *[,;:]+/g, '$1')
      // A line that starts on leftover punctuation reads as a stumble.
      .replace(/^[\s,;:.!?…]+/, '')
      .replace(/ {2,}/g, ' ')
      .trim()
  );
}
